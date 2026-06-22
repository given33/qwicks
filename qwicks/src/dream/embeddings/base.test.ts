import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HashEmbedder } from './hash-provider.js'
import type { Embedder, EmbeddingHealth } from './base.js'

describe('HashEmbedder (BoW fallback)', () => {
  it('reports name, dim, and degraded=true (not a real model)', () => {
    const e = new HashEmbedder({ dim: 384 })
    expect(e.name()).toBe('dream.hash-bow.v1')
    expect(e.dim()).toBe(384)
    expect(e.isDegraded()).toBe(true)
    expect(e.strict()).toBe(false)
  })

  it('clamps dim to a minimum of 64', () => {
    expect(new HashEmbedder({ dim: 8 }).dim()).toBe(64)
  })

  it('produces a deterministic, L2-normalized vector for the same text', () => {
    const e = new HashEmbedder({ dim: 256 })
    const a = e.embed('the quick brown fox')
    const b = e.embed('the quick brown fox')
    expect(a).toEqual(b)
    expect(a).toHaveLength(256)
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
    expect(norm).toBeCloseTo(1, 6)
  })

  it('different texts produce different vectors', () => {
    const e = new HashEmbedder({ dim: 256 })
    const a = e.embed('postgres replication')
    const b = e.embed('redis caching layer')
    expect(a).not.toEqual(b)
  })

  it('embedBatch equals per-text embed (and reuses cache)', () => {
    const e = new HashEmbedder({ dim: 256 })
    const batch = e.embedBatch(['alpha', 'beta', 'alpha'])
    expect(batch[0]).toEqual(e.embed('alpha'))
    expect(batch[2]).toEqual(batch[0])
    const stats = e.cacheStats()
    expect(stats.size).toBeGreaterThan(0)
    expect(stats.hits).toBeGreaterThan(0)
  })

  it('clears the cache when it exceeds max entries (bounded RAM)', () => {
    const e = new HashEmbedder({ dim: 64, cacheMax: 3 })
    for (let i = 0; i < 5; i++) e.embed(`unique-text-${i}`)
    // After exceeding 3 the cache was cleared; next miss repopulates.
    const stats = e.cacheStats()
    expect(stats.size).toBeLessThanOrEqual(3)
  })

  it('tokenizes mixed CJK + ASCII so shared terms raise overlap', () => {
    const e = new HashEmbedder({ dim: 512 })
    // "teamflow 智能体" and "teamflow 项目" share the "teamflow" token,
    // so their vectors must overlap (dot product > 0).
    const a = e.embed('teamflow 智能体')
    const b = e.embed('teamflow 项目')
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
    expect(dot).toBeGreaterThan(0)
  })
})

// A minimal fake embedder used to test the router's failover + cache.
class FakeEmbedder implements Embedder {
  calls = 0
  constructor(
    public dimValue: number,
    public nameValue: string,
    private behavior: 'ok' | 'fail' = 'ok',
    public degradedFlag = false
  ) {}
  name(): string {
    return this.nameValue
  }
  dim(): number {
    return this.dimValue
  }
  isDegraded(): boolean {
    return this.degradedFlag
  }
  strict(): boolean {
    return true
  }
  allowCpuFallback(): boolean {
    return false
  }
  embed(_text: string): number[] {
    this.calls++
    if (this.behavior === 'fail') throw new Error('embed failed')
    return [1, 0, 0]
  }
  embedBatch(texts: string[]): number[][] {
    return texts.map(() => this.embed(''))
  }
  healthCheck(): EmbeddingHealth {
    return {
      backend: this.nameValue,
      device: 'cpu',
      dim: this.dimValue,
      degraded: this.degradedFlag,
      loadAttempted: true,
      probeOk: this.behavior === 'ok',
      status: this.behavior === 'ok' ? 'ok' : 'error',
      strict: true,
      allowCpuFallback: false
    }
  }
}

describe('EmbeddingHealth', () => {
  it('builds an "ok" health snapshot from a working embedder', () => {
    const e = new HashEmbedder({ dim: 128 })
    const h = e.healthCheck()
    expect(h.backend).toBe('hash-bow')
    expect(h.degraded).toBe(true) // hash is always degraded by definition
    expect(h.dim).toBe(128)
  })
})
