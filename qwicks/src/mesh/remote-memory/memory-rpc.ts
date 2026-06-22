import { sha256 } from '@noble/hashes/sha256'
import { toHex } from '../identity/device-identity.js'
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
 * `MemoryRpcClient` sends `memory/query` and keeps a short-TTL local cache of
 * cacheable results.
 */

const ERR_UNAUTHORIZED = { code: -32002, message: 'unauthorized' }
const ERR_PRIVATE_NO_GRANT = { code: -32002, message: 'private_scope_requires_grant' }

type Send = (method: string, params: unknown) => Promise<unknown>

export interface MemoryRpcServerDeps {
  isPeerAuthorized: (peerDeviceId: string) => boolean
  queryLocal: (req: MemoryQueryRequest) => Promise<MemoryChunk[]>
  maxTopK: number
  audit: AuditLog
}

export class MemoryRpcServer {
  constructor(private readonly deps: MemoryRpcServerDeps) {}

  async handleMemoryQuery(req: MemoryQueryRequest, callerDeviceId: string): Promise<MemoryQueryResult> {
    if (!this.deps.isPeerAuthorized(callerDeviceId)) throw ERR_UNAUTHORIZED
    if (req.scopes.includes('private') && !req.grantToken) throw ERR_PRIVATE_NO_GRANT

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
