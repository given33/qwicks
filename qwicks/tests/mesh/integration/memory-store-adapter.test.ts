import { describe, it, expect, vi } from 'vitest'
import { createMemoryStoreQueryAdapter } from '@qwicks/mesh/integration/memory-store-adapter.js'
import type { MemoryStore } from '@qwicks/memory/memory-store.js'
import type { MemoryQueryRequest } from '@qwicks/mesh/contracts.js'

function fakeStore(records: Array<{ id: string; content: string; scope: 'workspace' | 'project' | 'user'; workspace?: string; tags: string[]; confidence: number; deletedAt?: string }>): MemoryStore {
  return {
    retrieve: vi.fn(async (input: { query: string; limit: number }) => records.slice(0, input.limit)),
    create: vi.fn(async () => { throw new Error('not used') }),
    update: vi.fn(async () => { throw new Error('not used') }),
    delete: vi.fn(async () => { throw new Error('not used') }),
    list: vi.fn(async () => records),
    diagnostics: vi.fn(async () => ({})),
    setLastInjected: vi.fn()
  } as unknown as MemoryStore
}

const req = (over: Partial<MemoryQueryRequest> = {}): MemoryQueryRequest => ({
  queryId: 'q', ownerDeviceId: 'd-bbb', query: 'deploy', topK: 5, scopes: ['public'], ...over
})

describe('createMemoryStoreQueryAdapter (RFC 004 §6, owner-authoritative)', () => {
  it('returns only public-scope records when public is requested', async () => {
    const store = fakeStore([
      { id: '1', content: 'workspace note', scope: 'workspace', tags: [], confidence: 0.9 },
      { id: '2', content: 'personal note', scope: 'user', tags: [], confidence: 0.8 }
    ])
    const queryLocal = createMemoryStoreQueryAdapter(store, 'd-bbb')
    const chunks = await queryLocal(req({ scopes: ['public'] }))
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('workspace note')
    expect(chunks[0].scope).toBe('public')
    expect(chunks[0].provenance).toBe('d-bbb')
  })

  it('includes private (user-scope) records only when private is in the requested scopes', async () => {
    const store = fakeStore([
      { id: '1', content: 'workspace note', scope: 'workspace', tags: [], confidence: 0.9 },
      { id: '2', content: 'personal note', scope: 'user', tags: [], confidence: 0.8 }
    ])
    const queryLocal = createMemoryStoreQueryAdapter(store, 'd-bbb')
    const chunks = await queryLocal(req({ scopes: ['public', 'private'], grantToken: 'g' }))
    expect(chunks.map((c) => c.scope).sort()).toEqual(['private', 'public'])
  })

  it('drops soft-deleted records', async () => {
    const store = fakeStore([
      { id: '1', content: 'gone', scope: 'workspace', tags: [], confidence: 0.9, deletedAt: '2026-06-22T00:00:00.000Z' },
      { id: '2', content: 'kept', scope: 'workspace', tags: [], confidence: 0.9 }
    ])
    const queryLocal = createMemoryStoreQueryAdapter(store, 'd-bbb')
    const chunks = await queryLocal(req())
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('kept')
  })

  it('caps at topK from the request', async () => {
    const store = fakeStore([
      { id: '1', content: 'a', scope: 'workspace', tags: [], confidence: 0.9 },
      { id: '2', content: 'b', scope: 'workspace', tags: [], confidence: 0.9 },
      { id: '3', content: 'c', scope: 'workspace', tags: [], confidence: 0.9 }
    ])
    const queryLocal = createMemoryStoreQueryAdapter(store, 'd-bbb')
    const chunks = await queryLocal(req({ topK: 2 }))
    expect(chunks).toHaveLength(2)
    expect(store.retrieve).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }))
  })
})
