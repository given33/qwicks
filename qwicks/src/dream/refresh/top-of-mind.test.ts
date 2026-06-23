import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryProvenance,
  MemoryType
} from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { TopOfMindBalancer, topOfMindScore } from './top-of-mind.js'

function mkMemory(
  id: string,
  userId: string,
  opts: {
    salience?: number
    importance?: number
    updatedAt?: string
    lastUsedAt?: string | null
    isTopOfMind?: boolean
  } = {}
): MemoryItem {
  const m = new MemoryItem(
    id,
    userId,
    MemoryType.FACT,
    `content-${id}`,
    undefined,
    [],
    opts.importance ?? 0.5,
    0.7,
    undefined,
    opts.updatedAt ?? '2026-06-01T00:00:00Z',
    null,
    new MemoryProvenance('chat')
  )
  m.salience = opts.salience ?? 0.5
  m.lastUsedAt = opts.lastUsedAt ?? null
  if (opts.isTopOfMind !== undefined) m.isTopOfMind = opts.isTopOfMind
  m.schemaVersion = 3
  return m
}

describe('topOfMindScore', () => {
  it('is higher for high salience + high importance + fresh + recently used', () => {
    const hot = mkMemory('hot', 'u', {
      salience: 0.95,
      importance: 0.9,
      updatedAt: '2026-06-22T00:00:00Z',
      lastUsedAt: '2026-06-22T00:00:00Z'
    })
    const cold = mkMemory('cold', 'u', {
      salience: 0.1,
      importance: 0.1,
      updatedAt: '2020-01-01T00:00:00Z',
      lastUsedAt: '2020-01-01T00:00:00Z'
    })
    const now = new Date('2026-06-23T00:00:00Z')
    expect(topOfMindScore(hot, { now })).toBeGreaterThan(topOfMindScore(cold, { now }))
  })
})

describe('TopOfMindBalancer', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-tom-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('promotes high-score memories to top-of-mind', () => {
    repo.upsert(
      mkMemory('hot', 'alice', {
        salience: 0.95,
        importance: 0.95,
        updatedAt: '2026-06-22T00:00:00Z',
        lastUsedAt: '2026-06-22T00:00:00Z'
      })
    )
    const balancer = new TopOfMindBalancer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = balancer.apply({ userId: 'alice' })
    expect(result.promoted).toBe(1)
    expect(repo.get('hot')!.isTopOfMind).toBe(true)
  })

  it('demotes low-score memories from top-of-mind', () => {
    repo.upsert(
      mkMemory('cold', 'alice', {
        salience: 0.05,
        importance: 0.05,
        updatedAt: '2020-01-01T00:00:00Z',
        isTopOfMind: true // currently top but now stale
      })
    )
    const balancer = new TopOfMindBalancer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = balancer.apply({ userId: 'alice' })
    expect(result.demoted).toBe(1)
    expect(repo.get('cold')!.isTopOfMind).toBe(false)
  })

  it('respects the maxTopOfMind cap (only top N promoted)', () => {
    // 5 hot memories, but cap = 2
    for (let i = 0; i < 5; i++) {
      repo.upsert(
        mkMemory(`hot_${i}`, 'alice', {
          salience: 0.9 - i * 0.01, // slightly decreasing
          importance: 0.9,
          updatedAt: '2026-06-22T00:00:00Z',
          lastUsedAt: '2026-06-22T00:00:00Z'
        })
      )
    }
    const balancer = new TopOfMindBalancer({
      repository: repo,
      maxTopOfMind: 2,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    balancer.apply({ userId: 'alice' })
    const topCount = repo.list('alice', { onlyTopOfMind: true }).length
    expect(topCount).toBeLessThanOrEqual(2)
  })

  it('is a no-op when no memories cross thresholds', () => {
    // All mid-range — neither promote nor demote
    repo.upsert(
      mkMemory('mid', 'alice', {
        salience: 0.5,
        importance: 0.5,
        updatedAt: '2026-06-01T00:00:00Z'
      })
    )
    const balancer = new TopOfMindBalancer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = balancer.apply({ userId: 'alice' })
    expect(result.promoted).toBe(0)
    expect(result.demoted).toBe(0)
  })

  it('writes top_of_mind_rebalance event when changes occur', () => {
    repo.upsert(
      mkMemory('hot', 'alice', {
        salience: 0.95,
        importance: 0.95,
        updatedAt: '2026-06-22T00:00:00Z',
        lastUsedAt: '2026-06-22T00:00:00Z'
      })
    )
    const balancer = new TopOfMindBalancer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    balancer.apply({ userId: 'alice' })
    const events = repo.recentEvents('top_of_mind_rebalance')
    expect(events).toHaveLength(1)
  })
})
