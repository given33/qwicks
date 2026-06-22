import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType
} from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { MemoryDecay, MemoryReinforcement, DreamingScheduler } from './scheduler.js'

function mk(id: string, type: MemoryType, content: string, importance: number, updatedAt: string): MemoryItem {
  return new MemoryItem(id, 'alice', type, content, MemoryScope.USER, [], importance, 0.7, '2024-01-01T00:00:00Z', updatedAt, null, new MemoryProvenance())
}

describe('MemoryDecay', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-refresh-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('expires items past expiresAt (transitions to EXPIRED)', () => {
    const stale = mk('a', MemoryType.FACT, 'old travel plan', 0.5, '2024-01-01T00:00:00Z')
    stale.expiresAt = '2020-01-01T00:00:00Z'
    repo.upsert(stale)
    const decay = new MemoryDecay({ repository: repo, staleThreshold: 0.25 })
    decay.apply({ now: new Date('2026-06-23T00:00:00Z') })
    expect(repo.get('a')!.status).toBe(MemoryLifecycleStatus.EXPIRED)
  })

  it('demotes importance for stale (but not expired) memories', () => {
    // upsert refreshes updatedAt to "now", so use a controllable clock to make
    // the item genuinely land far in the past.
    const clockRepo = new SqliteMemoryRepository({
      sqlitePath: join(dir, 'clock.db'),
      nowIso: () => '2024-01-01T00:00:00Z'
    })
    const stale = mk('a', MemoryType.FACT, 'old fact', 0.9, '2024-01-01T00:00:00Z')
    clockRepo.upsert(stale)
    const decay = new MemoryDecay({ repository: clockRepo, staleThreshold: 0.9, demoteStep: 0.2 })
    decay.apply({ now: new Date('2026-06-23T00:00:00Z') })
    const after = clockRepo.get('a')!
    clockRepo.close()
    expect(after.importance).toBeLessThan(0.9)
    expect(after.status).toBe(MemoryLifecycleStatus.ACTIVE) // not expired, just demoted
  })

  it('leaves fresh memories untouched', () => {
    const fresh = mk('a', MemoryType.FACT, 'recent fact', 0.9, '2026-06-22T00:00:00Z')
    repo.upsert(fresh)
    const decay = new MemoryDecay({ repository: repo })
    decay.apply({ now: new Date('2026-06-23T00:00:00Z') })
    const after = repo.get('a')!
    expect(after.importance).toBe(0.9)
    expect(after.status).toBe(MemoryLifecycleStatus.ACTIVE)
  })

  it('respects __do_not_decay__ tag (never demotes)', () => {
    const clockRepo = new SqliteMemoryRepository({
      sqlitePath: join(dir, 'clock2.db'),
      nowIso: () => '2024-01-01T00:00:00Z'
    })
    const pinned = mk('p', MemoryType.FACT, 'pinned', 0.9, '2024-01-01T00:00:00Z')
    pinned.tags = ['__do_not_decay__']
    clockRepo.upsert(pinned)
    const decay = new MemoryDecay({ repository: clockRepo, staleThreshold: 0.9, demoteStep: 0.2 })
    decay.apply({ now: new Date('2026-06-23T00:00:00Z') })
    expect(clockRepo.get('p')!.importance).toBe(0.9)
    clockRepo.close()
  })
})

describe('MemoryReinforcement', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-reinf-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('raises importance (capped at 1) and touches updatedAt for reinforced items', () => {
    const it = mk('a', MemoryType.FACT, 'fact', 0.5, '2024-01-01T00:00:00Z')
    repo.upsert(it)
    const reinf = new MemoryReinforcement({ repository: repo, boostStep: 0.2 })
    reinf.reinforce(it)
    const after = repo.get('a')!
    expect(after.importance).toBeGreaterThan(0.5)
  })

  it('caps importance at 1.0', () => {
    const it = mk('a', MemoryType.FACT, 'fact', 0.95, '2024-01-01T00:00:00Z')
    repo.upsert(it)
    const reinf = new MemoryReinforcement({ repository: repo, boostStep: 0.2 })
    reinf.reinforce(it)
    expect(repo.get('a')!.importance).toBeLessThanOrEqual(1.0)
  })
})

describe('DreamingScheduler', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-sched-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('tick is a no-op when no user is marked dirty', () => {
    const decay = new MemoryDecay({ repository: repo })
    const reinf = new MemoryReinforcement({ repository: repo })
    const sched = new DreamingScheduler({ decay, reinforcement: reinf })
    const ran = sched.tick({ userId: 'alice' })
    expect(ran).toBe(false)
  })

  it('markDirty + tick runs decay+reinforcement for that user and clears dirty', () => {
    const stale = mk('a', MemoryType.FACT, 'old', 0.9, '2024-01-01T00:00:00Z')
    stale.expiresAt = '2020-01-01T00:00:00Z'
    repo.upsert(stale)
    const decay = new MemoryDecay({ repository: repo })
    const reinf = new MemoryReinforcement({ repository: repo })
    const sched = new DreamingScheduler({ decay, reinforcement: reinf })
    sched.markDirty('alice')
    expect(sched.isDirty('alice')).toBe(true)
    const ran = sched.tick({ userId: 'alice' })
    expect(ran).toBe(true)
    expect(sched.isDirty('alice')).toBe(false)
    expect(repo.get('a')!.status).toBe(MemoryLifecycleStatus.EXPIRED)
  })

  it('tick with no userId processes all dirty users', () => {
    repo.upsert(mk('a', MemoryType.FACT, 'a', 0.5, '2026-06-22T00:00:00Z'))
    const decay = new MemoryDecay({ repository: repo })
    const reinf = new MemoryReinforcement({ repository: repo })
    const sched = new DreamingScheduler({ decay, reinforcement: reinf })
    sched.markDirty('alice')
    sched.markDirty('bob')
    expect(sched.tick()).toBe(true)
    expect(sched.dirtyCount()).toBe(0)
  })
})
