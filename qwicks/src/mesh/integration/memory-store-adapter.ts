import type { MemoryStore } from '../../memory/memory-store.js'
import type { MemoryQueryRequest, MemoryChunk } from '../contracts.js'

/**
 * Owner-side adapter: exposes the existing `MemoryStore` to `MemoryRpcServer`
 * as the `queryLocal` callback (RFC 004 §6).
 *
 * `MemoryStore.retrieve` returns `MemoryRecord[]` scored by its own retrieval;
 * there is no cross-device relevance score, so `confidence` is used as a proxy.
 * The adapter maps the store's scopes to the mesh permission tiers and FILTERS
 * by the requested scopes so a public-only query can never receive user-scoped
 * (private) records — the `MemoryRpcServer` separately enforces that `private`
 * requires a grantToken, but this adapter is the hard boundary that actually
 * withholds private records from the result set.
 */

type StoreScope = 'workspace' | 'project' | 'user'

function mapScope(scope: StoreScope): 'public' | 'private' {
  // workspace + project memory are shareable to paired peers; user-scoped
  // personal memory is private (requires a grantToken to surface).
  return scope === 'user' ? 'private' : 'public'
}

export function createMemoryStoreQueryAdapter(
  store: MemoryStore,
  ownerDeviceId: string
): (req: MemoryQueryRequest) => Promise<MemoryChunk[]> {
  return async (req) => {
    const workspace = req.metadataFilter && typeof req.metadataFilter.workspace === 'string' ? req.metadataFilter.workspace : undefined
    const records = await store.retrieve({
      query: req.query,
      ...(workspace ? { workspace } : {}),
      limit: req.topK
    })
    const allowedScopes = new Set(req.scopes)
    return records
      .filter((r) => !r.deletedAt)
      .filter((r) => allowedScopes.has(mapScope(r.scope as StoreScope)))
      .map((r) => ({
        chunkId: r.id,
        text: r.content,
        score: r.confidence,
        scope: mapScope(r.scope as StoreScope),
        metadata: { ...(r.workspace ? { workspace: r.workspace } : {}), tags: r.tags },
        provenance: ownerDeviceId
      }))
  }
}
