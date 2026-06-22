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

      // Verify the signature via injected callback (which looks up issuer's public key)
      if (!this.deps.verifyGrantToken) throw ERR_INVALID_GRANT
      const valid = await this.deps.verifyGrantToken(token)
      if (!valid) throw ERR_INVALID_GRANT
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

  constructor(
    private readonly send: Send,
    opts?: { ttlMs?: number }
  ) {
    this.ttlMs = opts?.ttlMs ?? 600_000
  }

  async query(req: MemoryQueryRequest): Promise<MemoryQueryResult> {
    const key = this.cacheKey(req)
    const cached = this.cache.get(key)
    if (cached && Date.now() < cached.expiresAt) return cached.result

    const result = (await this.send('memory/query', req)) as MemoryQueryResult
    if (result.cacheable) {
      this.cache.set(key, { result, expiresAt: Date.now() + this.ttlMs })
    }
    return result
  }

  invalidate(deviceId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(deviceId + '|')) this.cache.delete(key)
    }
  }

  private cacheKey(req: MemoryQueryRequest): string {
    const hash = toHex(sha256(new TextEncoder().encode(req.query)))
    return `${req.ownerDeviceId}|${hash}|${req.scopes.join(',')}`
  }
}
