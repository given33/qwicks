import { sha256 } from '@noble/hashes/sha256'
import { toHex } from '../identity/device-identity.js'
import { parseGrantToken, verifyGrantToken, type GrantToken, type GrantTokenPayload } from '../security/grant-token.js'
import type { MemoryQueryRequest, MemoryQueryResult, MemoryChunk } from '../contracts.js'
import type { AuditLog } from '../audit/audit-log.js'

/**
 * Remote memory query (RFC 004 §6, §7).
 *
 * `MemoryRpcServer` runs on the memory-owning device: it authorizes the caller,
 * enforces the permission tiers (private requires a grantToken), clamps topK to
 * the configured max, and queries via the injected `queryLocal` (which wraps the
 * existing `memory-store` in production). The result is `cacheable` only when
 * every returned chunk is public — low-sensitivity results may be cached by the
 * requester; private ones never are.
 *
 * When the caller requests `private` scope and provides a grant token, the
 * server parses it, looks up the issuer's public key via the injected callback,
 * and verifies the Ed25519 signature. If the token is invalid, expired, or the
 * subject doesn't match the caller, the query is rejected.
 *
 * `MemoryRpcClient` sends `memory/query` and keeps a short-TTL local cache of
 * cacheable results.
 */

const ERR_UNAUTHORIZED = { code: -32002, message: 'unauthorized' }
const ERR_PRIVATE_NO_GRANT = { code: -32002, message: 'private_scope_requires_grant' }
const ERR_INVALID_GRANT = { code: -32002, message: 'invalid_grant_token' }
const ERR_PRIVATE_DISABLED = { code: -32002, message: 'private_scope_not_allowed' }

type Send = (method: string, params: unknown) => Promise<unknown>

export interface MemoryRpcServerDeps {
  isPeerAuthorized: (peerDeviceId: string) => boolean
  queryLocal: (req: MemoryQueryRequest) => Promise<MemoryChunk[]>
  maxTopK: number
  audit: AuditLog
  /** Verify a grant token presented by the caller. The implementation looks up
   *  the issuer's public key from the trust store and validates the signature.
   *  Absent → all private-scope queries are denied. */
  verifyGrantToken?: (token: GrantToken) => Promise<boolean>
  /** Global toggle: if false, all private-scope queries are denied regardless
   *  of grant token validity. Default false. */
  allowPrivateGrants?: boolean
}

export class MemoryRpcServer {
  constructor(private readonly deps: MemoryRpcServerDeps) {}

  async handleMemoryQuery(req: MemoryQueryRequest, callerDeviceId: string): Promise<MemoryQueryResult> {
    if (!this.deps.isPeerAuthorized(callerDeviceId)) throw ERR_UNAUTHORIZED

    if (req.scopes.includes('private')) {
      // Global toggle — reject all private queries if the owner hasn't enabled them
      if (!this.deps.allowPrivateGrants) throw ERR_PRIVATE_DISABLED

      // Must present a grant token signed by the memory owner
      if (!req.grantToken) throw ERR_PRIVATE_NO_GRANT

      // Parse and verify the token
      const token = parseGrantToken(req.grantToken)
      if (!token) throw ERR_INVALID_GRANT

      // The subject must match the caller
      if (token.subject !== callerDeviceId) throw ERR_INVALID_GRANT

      // The issuer must match the owner being queried
      if (token.issuer !== req.ownerDeviceId) throw ERR_INVALID_GRANT

      // RFC 004 §8: if the token is bound to a taskId, the request's taskId must match
      if (token.taskId && req.taskId && token.taskId !== req.taskId) throw ERR_INVALID_GRANT

      // Verify the signature via injected callback (which looks up issuer's public key)
      if (!this.deps.verifyGrantToken) throw ERR_INVALID_GRANT
      const valid = await this.deps.verifyGrantToken(token)
      if (!valid) throw ERR_INVALID_GRANT

      // RFC 004 §10: audit private grant usage separately, linked to tokenId
      await this.deps.audit.record({
        kind: 'memory_private_grant_used',
        from: callerDeviceId,
        to: req.ownerDeviceId,
        outcome: 'success',
        traceId: req.queryId,
        taskId: req.taskId,
        timestamp: new Date().toISOString(),
        detail: { grantId: token.tokenId, scopes: req.scopes }
      })
    }

    const clamped: MemoryQueryRequest = { ...req, topK: Math.min(req.topK, this.deps.maxTopK) }
    const chunks = await this.deps.queryLocal(clamped)
    const cacheable = chunks.length > 0 && chunks.every((c) => c.scope === 'public')

    await this.deps.audit.record({
      kind: 'memory_queried',
      from: callerDeviceId,
      to: req.ownerDeviceId,
      outcome: 'success',
      traceId: req.queryId,
      taskId: req.taskId,
      timestamp: new Date().toISOString(),
      detail: { topK: clamped.topK, returned: chunks.length, scopes: req.scopes, cacheable }
    })

    return {
      queryId: req.queryId,
      chunks,
      truncated: chunks.length >= clamped.topK,
      cacheable
    }
  }
}

export class MemoryRpcClient {
  private readonly cache = new Map<string, { result: MemoryQueryResult; expiresAt: number }>()
  private readonly ttlMs: number
  /** Upper bound on cached entries. When exceeded, the oldest entries are
   *  evicted (the Map preserves insertion order, so the first entries are the
   *  oldest). Prevents unbounded growth under high query churn (F12). */
  private readonly maxEntries: number

  constructor(
    private readonly send: Send,
    opts?: { ttlMs?: number; maxEntries?: number }
  ) {
    this.ttlMs = opts?.ttlMs ?? 600_000
    this.maxEntries = opts?.maxEntries ?? 1024
  }

  async query(req: MemoryQueryRequest): Promise<MemoryQueryResult> {
    const key = this.cacheKey(req)
    const cached = this.cache.get(key)
    if (cached && Date.now() < cached.expiresAt) return cached.result

    const result = (await this.send('memory/query', req)) as MemoryQueryResult
    if (result.cacheable) {
      // Evict expired + overflow entries before inserting (F12).
      this.evictIfNeeded()
      this.cache.set(key, { result, expiresAt: Date.now() + this.ttlMs })
    }
    return result
  }

  /** Drop expired entries and, if still over the limit, the oldest live ones. */
  private evictIfNeeded(): void {
    const now = Date.now()
    // First pass: drop expired.
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key)
    }
    // Second pass: if still over the cap, evict oldest (insertion-order first).
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) break
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Invalidate cached results. Mirrors `memory/invalidated` (RFC 004 §7.2):
   *   - Always: drop every cache entry for the named ownerDeviceId (whole-device
   *     fallback when no chunkIds/scopes are supplied).
   *   - With chunkIds: also drop entries whose cached chunks intersect the list.
   *   - With scopes: also drop entries whose request scopes intersect the list.
   */
  invalidate(deviceId: string, opts?: { chunkIds?: string[]; scopes?: string[] }): void {
    const chunkSet = opts?.chunkIds ? new Set(opts.chunkIds) : undefined
    const scopeSet = opts?.scopes ? new Set(opts.scopes) : undefined

    for (const [key, entry] of this.cache) {
      // Whole-device fallback (preserves the original contract).
      if (key.startsWith(deviceId + '|')) {
        // If no finer filter, drop the whole device.
        if (!chunkSet && !scopeSet) {
          this.cache.delete(key)
          continue
        }

        let match = false
        if (scopeSet) {
          // key shape: `${owner}|${hash}|${scopesCsv}` — last segment is the CSV.
          const parts = key.split('|')
          const reqScopes = parts[parts.length - 1].split(',')
          if (reqScopes.some((s) => scopeSet.has(s))) match = true
        }
        if (chunkSet && !match) {
          if (entry.result.chunks.some((c) => chunkSet.has(c.chunkId))) match = true
        }
        if (match) this.cache.delete(key)
      }
    }
  }

  private cacheKey(req: MemoryQueryRequest): string {
    const hash = toHex(sha256(new TextEncoder().encode(req.query)))
    // Sort scopes so ['public','private'] and ['private','public'] hit the
    // same cache entry (F12: order-sensitivity caused wasted RPCs).
    const scopes = req.scopes.slice().sort().join(',')
    return `${req.ownerDeviceId}|${hash}|${scopes}`
  }
}
