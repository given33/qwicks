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
import { RetrievalPipeline, RETRIEVAL_EXCLUDED_STATUSES, recencyScore, bm25Score, tokenize } from './pipeline.js'

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

  it('recency channel: more-recently-created memory outscores older (B5: recency reads createdAt)', async () => {
    // B5:recency 改读 lastUsedAt ?? createdAt(不再读被每次 upsert 刷新的 updatedAt)。
    // 所以"更新"信号 = 创建/使用时间。这里给两条记忆不同的 createdAt:
    // b 创建于 2024(老),a 创建于 2026(新) → a 的 recency 高 → 得分高。
    const b = item({ id: 'b', userId: 'alice', content: 'shared memory content xyz', importance: 0.5, createdAt: '2024-01-01T00:00:00Z' })
    const a = item({ id: 'a', userId: 'alice', content: 'shared memory content xyz', importance: 0.5, createdAt: '2026-06-22T00:00:00Z' })
    repo.upsert(b)
    repo.upsert(a)
    pipe.onIndexChanged(b)
    pipe.onIndexChanged(a)

    const hits = await pipe.retrieve({ userId: 'alice', query: 'shared memory content', topK: 5 })
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

describe('RetrievalPipeline — reinforcement on retrieve (B2+B3)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let pipe: RetrievalPipeline

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-reinf-retr-'))
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

  it('B2: retrieving a hit raises its importance (capped) via reinforceUsed', async () => {
    const a = item({ id: 'a', userId: 'alice', content: 'postgres replication lag tuning', importance: 0.5 })
    repo.upsert(a)
    pipe.onIndexChanged(a)
    await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 5 })
    const after = repo.get('a')!
    expect(after.importance).toBeGreaterThan(0.5) // 强化生效
    // 连续 retrieve 不超过 1.0
    for (let i = 0; i < 20; i++) {
      await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 5 })
    }
    expect(repo.get('a')!.importance).toBeLessThanOrEqual(1.0)
  })

  it('B3: retrieving a hit sets last_used_at (null -> non-null)', async () => {
    const a = item({ id: 'a', userId: 'alice', content: 'postgres replication lag tuning' })
    repo.upsert(a)
    pipe.onIndexChanged(a)
    expect(repo.get('a')!.lastUsedAt).toBeNull()
    await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 5 })
    expect(repo.get('a')!.lastUsedAt).not.toBeNull()
  })
})

describe('bm25Score length normalization (B6)', () => {
  it('punishes long documents given the same match: shorter doc scores higher with corpus avgdl', () => {
    // 同一个查询 token 命中,但一个文档短、一个长(填充无关 token)。
    const query = tokenize('python')
    const shortDoc = tokenize('python')
    const longDoc = tokenize('python ' + 'filler '.repeat(200))
    const avgdl = (shortDoc.length + longDoc.length) / 2 // 语料平均长度
    const shortScore = bm25Score(query, shortDoc, avgdl)
    const longScore = bm25Score(query, longDoc, avgdl)
    expect(shortScore).toBeGreaterThan(longScore) // 短文档得分更高
  })

  it('regression guard: without avgdl (legacy single-doc call) still returns sane value', () => {
    const q = tokenize('python rocks')
    const d = tokenize('python rocks rocks')
    const s = bm25Score(q, d)
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThanOrEqual(1)
  })
})

describe('RetrievalPipeline — boost gating (B15)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let pipe: RetrievalPipeline

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-b15-'))
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

  it('B15: a top-of-mind memory with ZERO semantic relevance gets NO boost (score == baseScore)', async () => {
    // B15 核心:boost 只能放大已有相关性,不能凭空加成。一条 top-of-mind 但与查询
    // 零相关的记忆,vector/bm25/exact 全为 0 → hasRelevance=false → topOfMindBoost=0。
    // (它仍可能因 importance/recency 被召回 —— 那是既有契约,不在 B15 范围;B15 只保证
    // 不被 +0.12 凭空拔高。)断言:score == baseScore(boost 没生效)。
    const tom = item({
      id: 'tom',
      userId: 'alice',
      content: 'completely unrelated filler content zzz',
      updatedAt: '2026-06-20T00:00:00Z'
    })
    tom.isTopOfMind = true
    repo.upsert(tom)
    pipe.onIndexChanged(tom)
    const hits = await pipe.retrieve({ userId: 'alice', query: 'postgres replication tuning', topK: 5 })
    const hit = hits.find((h) => h.item.id === 'tom')
    expect(hit).toBeTruthy()
    expect(hit!.score).toBe(hit!.baseScore) // 零相关 → 没有 +0.12 boost
  })

  it('B15: a top-of-mind memory WITH relevance is still boosted (score > baseScore)', async () => {
    const tom = item({
      id: 'tom',
      userId: 'alice',
      content: 'postgres replication lag tuning guide',
      updatedAt: '2026-06-20T00:00:00Z'
    })
    tom.isTopOfMind = true
    repo.upsert(tom)
    pipe.onIndexChanged(tom)
    const hits = await pipe.retrieve({ userId: 'alice', query: 'postgres replication lag', topK: 5 })
    const hit = hits.find((h) => h.item.id === 'tom')
    expect(hit).toBeTruthy()
    expect(hit!.score).toBeGreaterThan(hit!.baseScore) // boost 生效
  })
})
