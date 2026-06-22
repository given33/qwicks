import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FlatVectorIndex } from './flat-index.js'

function vec(...xs: number[]): number[] {
  const norm = Math.sqrt(xs.reduce((s, v) => s + v * v, 0))
  return xs.map((v) => (norm === 0 ? 0 : v / norm))
}

describe('FlatVectorIndex (self-built brute-force cosine)', () => {
  let dir: string
  let index: FlatVectorIndex

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-vec-'))
    index = new FlatVectorIndex({ dim: 3, persistDir: dir })
  })
  afterEach(async () => {
    index.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports name, dim, and empty count', () => {
    expect(index.name()).toBe('dream.flat-vector.v1')
    expect(index.dim()).toBe(3)
    expect(index.count()).toBe(0)
  })

  it('adds vectors and counts them', () => {
    index.add(['a', 'b'], [vec(1, 0, 0), vec(0, 1, 0)])
    expect(index.count()).toBe(2)
  })

  it('upserts on duplicate id (replaces the vector)', () => {
    index.add(['a'], [vec(1, 0, 0)])
    index.add(['a'], [vec(0, 0, 1)])
    expect(index.count()).toBe(1)
    const hits = index.search(vec(0, 0, 1), { topK: 1 })
    expect(hits[0]!.id).toBe('a')
  })

  it('rejects vectors of the wrong dimension', () => {
    expect(() => index.add(['a'], [vec(1, 0)])).toThrow(/dim/i)
  })

  it('search returns ids ranked by cosine similarity with scores', () => {
    index.add(['a', 'b', 'c'], [vec(1, 0, 0), vec(0, 1, 0), vec(1, 1, 0)])
    const hits = index.search(vec(1, 0, 0), { topK: 3 })
    expect(hits[0]!.id).toBe('a')
    expect(hits[1]!.id).toBe('c') // partially similar
    expect(hits[2]!.id).toBe('b')
    expect(hits[0]!.score).toBeCloseTo(1, 6)
  })

  it('search honors topK', () => {
    index.add(['a', 'b', 'c'], [vec(1, 0, 0), vec(1, 0.01, 0), vec(0, 1, 0)])
    const hits = index.search(vec(1, 0, 0), { topK: 2 })
    expect(hits).toHaveLength(2)
  })

  it('search honors minScore (filters low-similarity results)', () => {
    index.add(['a', 'b'], [vec(1, 0, 0), vec(0, 1, 0)])
    const hits = index.search(vec(1, 0, 0), { topK: 5, minScore: 0.9 })
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('search honors filterIds (restricts the candidate set)', () => {
    index.add(['a', 'b', 'c'], [vec(1, 0, 0), vec(1, 0, 0), vec(0, 1, 0)])
    const hits = index.search(vec(1, 0, 0), { topK: 5, minScore: 0.5, filterIds: new Set(['b', 'c']) })
    expect(hits.map((h) => h.id)).toEqual(['b'])
  })

  it('remove drops vectors and they no longer appear in search', () => {
    index.add(['a', 'b'], [vec(1, 0, 0), vec(0, 1, 0)])
    index.remove(['a'])
    expect(index.count()).toBe(1)
    expect(index.search(vec(1, 0, 0), { topK: 5 }).map((h) => h.id)).toEqual(['b'])
  })

  it('save() persists and load() restores across instances', async () => {
    index.add(['a', 'b'], [vec(1, 0, 0), vec(0, 1, 0)])
    await index.save()
    const reloaded = new FlatVectorIndex({ dim: 3, persistDir: dir })
    expect(reloaded.count()).toBe(2)
    const hits = reloaded.search(vec(1, 0, 0), { topK: 1 })
    expect(hits[0]!.id).toBe('a')
    reloaded.close()
  })

  it('getVectorsByIds returns the stored vectors', () => {
    index.add(['a', 'b'], [vec(1, 0, 0), vec(0, 1, 0)])
    const got = index.getVectorsByIds(['a', 'missing'])
    expect(got.get('a')).toEqual(vec(1, 0, 0))
    expect(got.has('missing')).toBe(false)
  })

  it('healthCheck reports ok with dim + doc_count', () => {
    index.add(['a'], [vec(1, 0, 0)])
    const h = index.healthCheck()
    expect(h.status).toBe('ok')
    expect(h.dim).toBe(3)
    expect(h.docCount).toBe(1)
  })

  it('handles un-normalized input vectors (normalizes internally for cosine)', () => {
    index.add(['a'], [[3, 0, 0]]) // un-normalized
    const hits = index.search([1, 0, 0], { topK: 1 })
    expect(hits[0]!.id).toBe('a')
    expect(hits[0]!.score).toBeCloseTo(1, 6)
  })
})
