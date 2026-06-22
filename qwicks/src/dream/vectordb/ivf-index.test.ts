import { describe, expect, it } from 'vitest'
import { IvfVectorIndex } from './ivf-index.js'

function vec(...xs: number[]): number[] {
  const norm = Math.sqrt(xs.reduce((s, v) => s + v * v, 0))
  return xs.map((v) => (norm === 0 ? 0 : v / norm))
}

describe('IvfVectorIndex (coarse-quantized IVF)', () => {
  it('reports name, dim, empty count', () => {
    const idx = new IvfVectorIndex({ dim: 4, nlist: 4 })
    expect(idx.name()).toBe('dream.ivf-vector.v1')
    expect(idx.dim()).toBe(4)
    expect(idx.count()).toBe(0)
    idx.close()
  })

  it('trains buckets when enough vectors are added and still returns correct top-1', () => {
    const idx = new IvfVectorIndex({ dim: 3, nlist: 2 })
    // two well-separated clusters
    idx.add(
      ['a1', 'a2', 'a3', 'a4'],
      [vec(1, 0, 0), vec(0.99, 0.01, 0), vec(0.98, 0.02, 0), vec(0.97, 0.03, 0)]
    )
    idx.add(
      ['b1', 'b2', 'b3', 'b4'],
      [vec(0, 1, 0), vec(0.01, 0.99, 0), vec(0.02, 0.98, 0), vec(0.03, 0.97, 0)]
    )
    expect(idx.count()).toBe(8)
    const hits = idx.search(vec(1, 0, 0), { topK: 1 })
    expect(hits[0]!.id).toBe('a1')
    idx.close()
  })

  it('falls back to flat scan when fewer vectors than buckets (no training yet)', () => {
    const idx = new IvfVectorIndex({ dim: 2, nlist: 8 })
    idx.add(['a', 'b'], [vec(1, 0), vec(0, 1)])
    // not enough to train 8 buckets -> brute-force fallback path
    const hits = idx.search(vec(1, 0), { topK: 2 })
    expect(hits[0]!.id).toBe('a')
    idx.close()
  })

  it('honors minScore and topK', () => {
    const idx = new IvfVectorIndex({ dim: 2, nlist: 2 })
    idx.add(['a', 'b', 'c'], [vec(1, 0), vec(0.9, 0.1), vec(0, 1)])
    const hits = idx.search(vec(1, 0), { topK: 1, minScore: 0.95 })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.id).toBe('a')
    idx.close()
  })

  it('remove drops vectors', () => {
    const idx = new IvfVectorIndex({ dim: 2, nlist: 2 })
    idx.add(['a', 'b', 'c'], [vec(1, 0), vec(1, 0), vec(0, 1)])
    idx.remove(['a'])
    expect(idx.count()).toBe(2)
    const hits = idx.search(vec(1, 0), { topK: 5, minScore: 0.9 })
    expect(hits.map((h) => h.id)).toEqual(['b'])
    idx.close()
  })

  it('upserts on duplicate id', () => {
    const idx = new IvfVectorIndex({ dim: 2, nlist: 2 })
    idx.add(['a'], [vec(1, 0)])
    idx.add(['a'], [vec(0, 1)])
    expect(idx.count()).toBe(1)
    expect(idx.search(vec(0, 1), { topK: 1 })[0]!.id).toBe('a')
    idx.close()
  })

  it('healthCheck reports ok with dim + doc_count', () => {
    const idx = new IvfVectorIndex({ dim: 2, nlist: 2 })
    idx.add(['a'], [vec(1, 0)])
    const h = idx.healthCheck()
    expect(h.status).toBe('ok')
    expect(h.docCount).toBe(1)
    idx.close()
  })
})
