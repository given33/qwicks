import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType,
  newMemoryId
} from '../types.js'
import { HashEmbedder } from '../embeddings/hash-provider.js'
import { FlatVectorIndex } from '../vectordb/flat-index.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { RetrievalPipeline, RETRIEVAL_EXCLUDED_STATUSES, recencyScore } from './pipeline.js'

function item(overrides: Partial<MemoryItem> & { id: string; content: string }): MemoryItem {
  return new MemoryItem(
    overrides.id,
    overrides.userId ?? 'alice',
    overrides.type ?? MemoryType.FACT,
    overrides.content,
    overrides.scope ?? MemoryScope.USER,
    overrides.tags ?? [],
    overrides.importance ?? 0.5,
    overrides.confidence ?? 0.7,
    overrides.createdAt ?? '2026-06-01T00:00:00Z',
    overrides.updatedAt ?? '2026-06-01T00:00:00Z',
    overrides.expiresAt ?? null,
    overrides.provenance ?? new MemoryProvenance(),
    overrides.embedding ?? null,
    overrides.embeddingModel ?? null,
    overrides.related ?? [],
    overrides.metadata ?? {},
    overrides.status ?? MemoryLifecycleStatus.ACTIVE,
    overrides.statusHistory ?? [],
    overrides.schemaVersion ?? 2
  )
}

describe('RetrievalPipeline — 4 hard gates', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let pipe: RetrievalPipeline

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-retr-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    const embedder = new HashEmbedder({ dim: 128 })
    const vectordb = new FlatVectorIndex({ dim: 128, persistDir: join(dir, 'vec') })
    pipe = new RetrievalPipeline({ repository: repo, embedder, vectorDb: vectordb })
    pipe.warmup()
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  function seed(overrides: Partial<MemoryItem> & { id: string; content: string }) {
    const it = item(overrides)
    repo.upsert(it)
    return it
  }

  it('excludes DELETED/SUPPRESSED/EXPIRED/SUPERSEDED/CONNECTOR_REVOKED/ARCHIVED items', async () => {
    const active = seed({ id: 'a', content: 'postgres replication setup details', status: MemoryLifecycleStatus.ACTIVE })
    const excluded = RETRIEVAL_EXCLUDED_STATUSES
    for (const status of excluded) {
      seed({
        id: `x-${status}`,
        content: 'postgres replication setup details',
        status
      })
    }
    const hits = await pipe.retrieve({ userId: 'alice', query: 'postgres replication', topK: 10 })
    const ids = hits.map((h) => h.item.id)
    expect(ids).toContain('a')
    for (const status of excluded) {
      expect(ids).not.toContain(`x-${status}`)
    }
  })

  it('expiresAt in the past is excluded even if status is ACTIVE', async () => {
    seed({ id: 'fresh', content: 'travel plan tokyo trip', status: MemoryLifecycleStatus.ACTIVE })
    seed({
      id: 'stale',
      content: 'travel plan tokyo trip',
      status: MemoryLifecycleStatus.ACTIVE,
      expiresAt: '2020-01-01T00:00:00Z'
    })
    const hits = await pipe.retrieve({ userId: 'alice', query: 'tokyo travel', topK: 10 })
    expect(hits.map((h) => h.item.id)).toContain('fresh')
    expect(hits.map((h) => h.item.id)).not.toContain('stale')
  })

  it('isolates users (bob cannot retrieve alice memories)', async () => {
    seed({ id: 'a', content: 'alice private secret', userId: 'alice' })
    seed({ id: 'b', content: 'alice private secret', userId: 'bob' })
    const hits = await pipe.retrieve({ userId: 'bob', query: 'alice private secret', topK: 10 })
    expect(hits.map((h) => h.item.userId)).toEqual(['bob'])
  })

  it('includeSuppressed lets SUPPRESSED through', async () => {
    seed({ id: 'a', content: 'postgres replication setup details', status: MemoryLifecycleStatus.SUPPRESSED })
    const hits = await pipe.retrieve({
      userId: 'alice',
      query: 'postgres replication',
      topK: 10,
      includeSuppressed: true
    })
    expect(hits.map((h) => h.item.id)).toContain('a')
  })
})

describe('RetrievalPipeline — 5-channel hybrid scoring', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let pipe: RetrievalPipeline

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-retr2-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    const embedder = new HashEmbedder({ dim: 128 })
    const vectordb = new FlatVectorIndex({ dim: 128, persistDir: join(dir, 'vec') })
    pipe = new RetrievalPipeline({ repository: repo, embedder, vectorDb: vectordb })
    pipe.warmup()
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('returns hits sorted by descending composite score', async () => {
    const a = item({ id: 'a', userId: 'alice', content: 'postgres replication lag tuning', importance: 0.8, updatedAt: '2026-06-20T00:00:00Z' })
    const b = item({ id: 'b', userId: 'alice', content: 'postgres replication lag tuning', importance: 0.3, updatedAt: '2026-05-01T00:00:00Z' })
    repo.upsert(a)
    repo.upsert(b)
    pipe.onIndexChanged(a)
    pipe.onIndexChanged(b)
    const hits = await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 5 })
    expect(hits.length).toBeGreaterThan(0)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score)
    }
  })

  it('higher importance raises the score (importance channel)', async () => {
    const a = item({ id: 'a', userId: 'alice', content: 'identical content here now', importance: 0.9, updatedAt: '2026-06-20T00:00:00Z' })
    const b = item({ id: 'b', userId: 'alice', content: 'identical content here now', importance: 0.1, updatedAt: '2026-06-20T00:00:00Z' })
    repo.upsert(a)
    repo.upsert(b)
    pipe.onIndexChanged(a)
    pipe.onIndexChanged(b)
    const hits = await pipe.retrieve({ userId: 'alice', query: 'identical content here now', topK: 5 })
    const scoreA = hits.find((h) => h.item.id === 'a')!.score
    const scoreB = hits.find((h) => h.item.id === 'b')!.score
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  it('recency channel: more-recently-touched memory outscores older (upsert refreshes updatedAt)', async () => {
    // upsert refreshes updatedAt to "now" (faithful to Python). Use a controllable
    // clock so the two items genuinely land at different times.
    let clock = new Date('2024-01-01T00:00:00Z').getTime()
    const clockRepo = new SqliteMemoryRepository({
      sqlitePath: join(dir, 'clock.db'),
      nowIso: () => new Date(clock).toISOString()
    })
    const clockPipe = new RetrievalPipeline({
      repository: clockRepo,
      embedder: new HashEmbedder({ dim: 128 }),
      vectorDb: new FlatVectorIndex({ dim: 128, persistDir: join(dir, 'vec-clock') })
    })
    clockPipe.warmup()

    const b = item({ id: 'b', userId: 'alice', content: 'shared memory content xyz', importance: 0.5 })
    clockRepo.upsert(b) // touched at 2024-01-01
    clockPipe.onIndexChanged(b)
    clock = new Date('2026-06-22T00:00:00Z').getTime() // advance clock
    const a = item({ id: 'a', userId: 'alice', content: 'shared memory content xyz', importance: 0.5 })
    clockRepo.upsert(a) // touched at 2026-06-22
    clockPipe.onIndexChanged(a)

    const hits = await clockPipe.retrieve({ userId: 'alice', query: 'shared memory content', topK: 5 })
    clockRepo.close()
    const scoreA = hits.find((h) => h.item.id === 'a')!.score
    const scoreB = hits.find((h) => h.item.id === 'b')!.score
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  it('recencyScore unit: binary half-life decay (authoritative, matches Python temporal.engine)', () => {
    const now = new Date('2026-06-23T00:00:00Z')
    expect(recencyScore('2026-06-23T00:00:00Z', 60, now)).toBeCloseTo(1, 6)
    // 60 days ago (one half-life) → 0.5 (binary half-life, matches Python)
    const sixtyDaysAgo = new Date('2026-06-23T00:00:00Z').getTime() - 60 * 86_400_000
    expect(recencyScore(new Date(sixtyDaysAgo).toISOString(), 60, now)).toBeCloseTo(0.5, 6)
    // very old → ~0
    expect(recencyScore('2020-01-01T00:00:00Z', 60, now)).toBeLessThan(0.01)
  })

  it('honors topK', async () => {
    for (let i = 0; i < 10; i++) {
      const it = item({ id: `m${i}`, userId: 'alice', content: 'postgres replication tuning guide' })
      repo.upsert(it)
      pipe.onIndexChanged(it)
    }
    const hits = await pipe.retrieve({ userId: 'alice', query: 'postgres replication', topK: 3 })
    expect(hits).toHaveLength(3)
  })

  it('filters by types and scopes', async () => {
    const fact = item({ id: 'f1', userId: 'alice', content: 'postgres replication guide', type: MemoryType.FACT, scope: MemoryScope.USER })
    const goal = item({ id: 'g1', userId: 'alice', content: 'postgres replication guide', type: MemoryType.GOAL, scope: MemoryScope.PROJECT })
    repo.upsert(fact)
    repo.upsert(goal)
    pipe.onIndexChanged(fact)
    pipe.onIndexChanged(goal)
    const onlyFacts = await pipe.retrieve({
      userId: 'alice',
      query: 'postgres replication',
      topK: 10,
      types: [MemoryType.FACT]
    })
    expect(onlyFacts.map((h) => h.item.id)).toEqual(['f1'])
  })

  it('records per-channel sub-scores on each hit', async () => {
    const a = item({ id: 'a', userId: 'alice', content: 'postgres replication lag tuning', importance: 0.7 })
    repo.upsert(a)
    pipe.onIndexChanged(a)
    const [hit] = await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 1 })
    expect(hit).toBeTruthy()
    expect(typeof hit.vectorScore).toBe('number')
    expect(typeof hit.recencyScore).toBe('number')
    expect(typeof hit.importanceScore).toBe('number')
    expect(hit.score).toBeGreaterThanOrEqual(0)
  })

  it('returns empty when the user has no memories', async () => {
    const hits = await pipe.retrieve({ userId: 'nobody', query: 'anything', topK: 5 })
    expect(hits).toEqual([])
  })
})
