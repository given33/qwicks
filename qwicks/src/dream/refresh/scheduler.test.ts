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
import { MemoryDecay, DreamingScheduler } from './scheduler.js'

// B2/B3/B5 的强化路径已收口到 repository.reinforceUsed(检索侧),此处覆盖它的契约。
describe('repository.reinforceUsed (B2+B3+B5 combined write side)', () => {
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

  it('B2: raises importance (capped at 1.0) for reinforced ids', () => {
    const it = mk('a', MemoryType.FACT, 'fact', 0.5, '2024-01-01T00:00:00Z')
    repo.upsert(it)
    repo.reinforceUsed(['a'], { boost: 0.2 })
    expect(repo.get('a')!.importance).toBeCloseTo(0.7, 5)
    // 连续强化不会超过 1.0(MIN 封顶)
    repo.reinforceUsed(['a'], { boost: 0.5 })
    repo.reinforceUsed(['a'], { boost: 0.5 })
    expect(repo.get('a')!.importance).toBeLessThanOrEqual(1.0)
    expect(repo.get('a')!.importance).toBeCloseTo(1.0, 5)
  })

  it('B3: sets last_used_at to the given timestamp (null → non-null)', () => {
    const it = mk('a', MemoryType.FACT, 'fact', 0.5, '2024-01-01T00:00:00Z')
    repo.upsert(it)
    expect(repo.get('a')!.lastUsedAt).toBeNull()
    repo.reinforceUsed(['a'], { at: '2026-06-25T00:00:00Z' })
    expect(repo.get('a')!.lastUsedAt).toBe('2026-06-25T00:00:00Z')
  })

  it('B5: does NOT touch updated_at (preserve stable temporal semantics)', () => {
    // 用可控时钟把 updatedAt 冻结在 2024-01-01,强化后 updatedAt 必须不变。
    const clockRepo = new SqliteMemoryRepository({
      sqlitePath: join(dir, 'clock.db'),
      nowIso: () => '2024-01-01T00:00:00Z'
    })
    const it = mk('a', MemoryType.FACT, 'fact', 0.5, '2024-01-01T00:00:00Z')
    clockRepo.upsert(it)
    const updatedAtBefore = clockRepo.get('a')!.updatedAt
    clockRepo.reinforceUsed(['a'], { at: '2026-06-25T00:00:00Z' })
    expect(clockRepo.get('a')!.updatedAt).toBe(updatedAtBefore) // 不污染时效
    expect(clockRepo.get('a')!.lastUsedAt).toBe('2026-06-25T00:00:00Z')
    clockRepo.close()
  })

  it('is a no-op on empty id list (does not throw)', () => {
    expect(() => repo.reinforceUsed([], { boost: 0.1 })).not.toThrow()
  })

  it('optionally boosts salience (capped at 1.0)', () => {
    const it = mk('a', MemoryType.FACT, 'fact', 0.5, '2024-01-01T00:00:00Z')
    repo.upsert(it)
    repo.reinforceUsed(['a'], { salienceBoost: 0.3 })
    expect(repo.get('a')!.salience).toBeCloseTo(0.8, 5) // 0.5 + 0.3
  })
})

function mk(id: string, type: MemoryType, content: string, importance: number, updatedAt: string, createdAt?: string): MemoryItem {
  // B5:recency 读 lastUsedAt ?? createdAt(不读 updatedAt)。所以"老/新"语义现在取决于
  // createdAt —— 默认把 createdAt 对齐到 updatedAt,让调用方传的 updatedAt 直接表达新度。
  // 需要显式控制 createdAt(如测 decay 读老 createdAt)时传第 6 参。
  const ct = createdAt ?? updatedAt
  return new MemoryItem(id, 'alice', type, content, MemoryScope.USER, [], importance, 0.7, ct, updatedAt, null, new MemoryProvenance())
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

  it('B5: decay uses createdAt/lastUsedAt, NOT updatedAt — editing a 2yr-old memory keeps it stale', () => {
    // 用可控时钟:createdAt 冻结在 2024-01-01(老),upsert 时 updatedAt 也被设到 2024-01-01。
    // 若 decay 误读 updatedAt,upsert 后它=now → 永远 fresh → 不 demote(B5 的 bug)。
    const clockRepo = new SqliteMemoryRepository({
      sqlitePath: join(dir, 'clock3.db'),
      nowIso: () => '2024-01-01T00:00:00Z'
    })
    const old = mk('a', MemoryType.FACT, 'old fact no phrase', 0.9, '2024-01-01T00:00:00Z')
    clockRepo.upsert(old) // createdAt = updatedAt = 2024-01-01
    // decay 阈值高(staleThreshold=0.9),2024 的记忆在 2026 已远低于 → 应 demote
    const decay = new MemoryDecay({ repository: clockRepo, staleThreshold: 0.9, demoteStep: 0.2 })
    decay.apply({ now: new Date('2026-06-23T00:00:00Z') })
    const after = clockRepo.get('a')!
    clockRepo.close()
    expect(after.importance).toBeLessThan(0.9) // 真的被降级了(读的是老 createdAt)
    expect(after.status).toBe(MemoryLifecycleStatus.ACTIVE)
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
    const sched = new DreamingScheduler({ decay })
    const ran = sched.tick({ userId: 'alice' })
    expect(ran.ran).toBe(false)
  })

  it('markDirty + tick runs decay for that user and clears dirty', () => {
    const stale = mk('a', MemoryType.FACT, 'old', 0.9, '2024-01-01T00:00:00Z')
    stale.expiresAt = '2020-01-01T00:00:00Z'
    repo.upsert(stale)
    const decay = new MemoryDecay({ repository: repo })
    const sched = new DreamingScheduler({ decay })
    sched.markDirty('alice')
    expect(sched.isDirty('alice')).toBe(true)
    const ran = sched.tick({ userId: 'alice' })
    expect(ran.ran).toBe(true)
    expect(sched.isDirty('alice')).toBe(false)
    expect(repo.get('a')!.status).toBe(MemoryLifecycleStatus.EXPIRED)
  })

  it('tick with no userId processes all dirty users', () => {
    repo.upsert(mk('a', MemoryType.FACT, 'a', 0.5, '2026-06-22T00:00:00Z'))
    const decay = new MemoryDecay({ repository: repo })
    const sched = new DreamingScheduler({ decay })
    sched.markDirty('alice')
    sched.markDirty('bob')
    expect(sched.tick().ran).toBe(true)
    expect(sched.dirtyCount()).toBe(0)
  })
})
