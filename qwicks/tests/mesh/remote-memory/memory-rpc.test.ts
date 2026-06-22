import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryRpcServer, MemoryRpcClient, type MemoryRpcServerDeps } from '@qwicks/mesh/remote-memory/memory-rpc.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import type { MemoryQueryRequest, MemoryChunk } from '@qwicks/mesh/contracts.js'

const pub = (text: string): MemoryChunk => ({ chunkId: text, text, score: 0.9, scope: 'public', metadata: {}, provenance: 'd-bbb' })
const priv = (text: string): MemoryChunk => ({ chunkId: text, text, score: 0.9, scope: 'private', metadata: {}, provenance: 'd-bbb' })

const req = (over: Partial<MemoryQueryRequest> = {}): MemoryQueryRequest => ({
  queryId: 'q1',
  ownerDeviceId: 'd-bbb',
  query: 'how to deploy',
  topK: 5,
  scopes: ['public'],
  ...over
})

/** Minimal parseable grant token JSON string (expiry far in the future). */
function fakeGrantToken(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    version: '1',
    tokenId: 't-001',
    issuer: 'd-bbb',
    subject: 'd-aaa',
    scopes: ['private'],
    issuedAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    nonce: 'abc123',
    sig: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    ...over
  })
}

function deps(over: Partial<MemoryRpcServerDeps> = {}): MemoryRpcServerDeps {
  return {
    isPeerAuthorized: () => true,
    queryLocal: vi.fn(async () => [pub('public note')]),
    maxTopK: 10,
    audit: new AuditLog(join(mkdtempSync(join(tmpdir(), 'mem-')), 'audit.db')),
    allowPrivateGrants: true,
    verifyGrantToken: async () => true,
    ...over
  }
}

describe('MemoryRpcServer (RFC 004 §6)', () => {
  let dir: string
  const audits: AuditLog[] = []
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mem-'))
  })
  afterEach(() => {
    for (const a of audits.splice(0)) a.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a public-scope query and marks the result cacheable', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    const result = await server.handleMemoryQuery(req(), 'd-aaa')
    expect(result.chunks).toHaveLength(1)
    expect(result.cacheable).toBe(true)
  })

  it('marks results non-cacheable when any private chunk is returned', async () => {
    const d = deps({ queryLocal: vi.fn(async () => [pub('p'), priv('secret')]) })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    const result = await server.handleMemoryQuery(req({ scopes: ['public', 'private'], grantToken: fakeGrantToken() }), 'd-aaa')
    expect(result.cacheable).toBe(false)
  })

  it('rejects a private-scope query without a grantToken', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req({ scopes: ['private'] }), 'd-aaa')).rejects.toMatchObject({ code: -32002 })
    expect(d.queryLocal).not.toHaveBeenCalled()
  })

  it('rejects an unauthorized caller', async () => {
    const d = deps({ isPeerAuthorized: (id) => id === 'd-aaa' })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req(), 'd-evil')).rejects.toMatchObject({ code: -32002 })
  })

  it('clamps topK to the configured max', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await server.handleMemoryQuery(req({ topK: 999 }), 'd-aaa')
    expect((d.queryLocal as ReturnType<typeof vi.fn>).mock.calls[0][0].topK).toBe(10)
  })

  /* ---- Grant token verification (Phase 3 / RFC 004 §6.4) ---- */

  it('rejects a private-scope query with an unparseable grant token', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: 'not-json' }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'invalid_grant_token' })
  })

  it('rejects a grant token whose subject does not match the caller', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    const token = fakeGrantToken({ subject: 'd-evil' })
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: token }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'invalid_grant_token' })
  })

  it('rejects a grant token whose issuer does not match the owner', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    const token = fakeGrantToken({ issuer: 'd-other' })
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: token }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'invalid_grant_token' })
  })

  it('rejects a private query when allowPrivateGrants is false', async () => {
    const d = deps({ allowPrivateGrants: false })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: fakeGrantToken() }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'private_scope_not_allowed' })
  })

  it('rejects when verifyGrantToken returns false', async () => {
    const d = deps({ verifyGrantToken: async () => false })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: fakeGrantToken() }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'invalid_grant_token' })
  })

  it('rejects when verifyGrantToken is not provided (absent callback)', async () => {
    const d = deps({ verifyGrantToken: undefined })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    await expect(server.handleMemoryQuery(req({ scopes: ['private'], grantToken: fakeGrantToken() }), 'd-aaa'))
      .rejects.toMatchObject({ code: -32002, message: 'invalid_grant_token' })
  })

  it('accepts a private-scope query with a valid grant token', async () => {
    const d = deps({ queryLocal: vi.fn(async () => [priv('secret')]) })
    audits.push(d.audit)
    const server = new MemoryRpcServer(d)
    const result = await server.handleMemoryQuery(req({ scopes: ['private'], grantToken: fakeGrantToken() }), 'd-aaa')
    expect(result.chunks).toHaveLength(1)
    expect(result.cacheable).toBe(false)
  })
})

describe('MemoryRpcClient + cache (RFC 004 §7)', () => {
  it('round-trips a query and caches only cacheable results', async () => {
    let call = 0
    const send = vi.fn(async () => {
      call++
      return { queryId: 'q1', chunks: [pub('cached-note')], truncated: false, cacheable: true }
    })
    const client = new MemoryRpcClient(send as never, { ttlMs: 60_000 })
    const r1 = await client.query(req())
    const r2 = await client.query(req())
    expect(r1.chunks[0].text).toBe('cached-note')
    expect(send).toHaveBeenCalledTimes(1) // second served from cache
    expect(call).toBe(1)
  })

  it('does not cache non-cacheable results', async () => {
    const send = vi.fn(async () => ({ queryId: 'q1', chunks: [priv('secret')], truncated: false, cacheable: false }))
    const client = new MemoryRpcClient(send as never, { ttlMs: 60_000 })
    await client.query(req({ scopes: ['private'], grantToken: fakeGrantToken() }))
    await client.query(req({ scopes: ['private'], grantToken: fakeGrantToken() }))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('invalidates cached results for a device', async () => {
    const send = vi.fn(async () => ({ queryId: 'q1', chunks: [pub('note')], truncated: false, cacheable: true }))
    const client = new MemoryRpcClient(send as never, { ttlMs: 60_000 })
    await client.query(req())
    expect(send).toHaveBeenCalledTimes(1)
    client.invalidate('d-bbb')
    await client.query(req())
    expect(send).toHaveBeenCalledTimes(2)
  })
})
