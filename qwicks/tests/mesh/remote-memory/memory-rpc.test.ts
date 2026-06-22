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

function deps(over: Partial<MemoryRpcServerDeps> = {}): MemoryRpcServerDeps {
  return {
    isPeerAuthorized: () => true,
    queryLocal: vi.fn(async () => [pub('public note')]),
    maxTopK: 10,
    audit: new AuditLog(join(mkdtempSync(join(tmpdir(), 'mem-')), 'audit.db')),
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
    const result = await server.handleMemoryQuery(req({ scopes: ['public', 'private'], grantToken: 'g' }), 'd-aaa')
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
    await client.query(req({ scopes: ['private'], grantToken: 'g' }))
    await client.query(req({ scopes: ['private'], grantToken: 'g' }))
    expect(send).toHaveBeenCalledTimes(2)
  })
})
