import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { ageDays, assess, detectTemporalHint, filterActive, recencyScore, sortbyRecency } from './engine.js'

const NOW = () => new Date('2026-06-23T00:00:00Z')

function mk(overrides: Partial<MemoryItem> & { id: string }): MemoryItem {
  // B5:stale/recency 现在读 lastUsedAt ?? createdAt(不再读被每次 upsert 刷新的 updatedAt)。
  // 所以"老记忆"必须在 createdAt 上老 —— 当只给了 updatedAt 而没给 createdAt 时,
  // 把 createdAt 对齐到 updatedAt(现实中老记忆两者都老),让 stale 测试语义成立。
  const updatedAt = overrides.updatedAt ?? '2026-06-01T00:00:00Z'
  const createdAt = overrides.createdAt ?? updatedAt
  return new MemoryItem(
    overrides.id,
    'alice',
    overrides.type ?? MemoryType.FACT,
    overrides.content ?? 'x',
    overrides.scope ?? MemoryScope.USER,
    [],
    0.5,
    0.7,
    createdAt,
    updatedAt,
    overrides.expiresAt ?? null,
    new MemoryProvenance()
  )
}

describe('temporal.engine', () => {
  it('recency_score is 1.0 now and 0.5 at one half-life (binary half-life formula)', () => {
    expect(recencyScore('2026-06-23T00:00:00Z', 60, NOW())).toBeCloseTo(1.0, 6)
    const oneHalfAgo = new Date('2026-06-23T00:00:00Z').getTime() - 60 * 86_400_000
    expect(recencyScore(new Date(oneHalfAgo).toISOString(), 60, NOW())).toBeCloseTo(0.5, 6)
  })

  it('recency_score is 0.5 for unparseable timestamp', () => {
    expect(recencyScore('not-a-date', 60, NOW())).toBe(0.5)
  })

  it('ageDays returns days since updatedAt (0 for future)', () => {
    expect(ageDays('2026-06-23T00:00:00Z', NOW())).toBeCloseTo(0, 5)
    const tenDaysAgo = new Date('2026-06-23T00:00:00Z').getTime() - 10 * 86_400_000
    expect(ageDays(new Date(tenDaysAgo).toISOString(), NOW())).toBeCloseTo(10, 5)
  })

  it('detectTemporalHint reads time phrases into a freshness signal', () => {
    expect(detectTemporalHint('I currently live in Tokyo')).toBe(1.0)
    expect(detectTemporalHint('long ago I used to')).toBeLessThan(0.3)
    expect(detectTemporalHint('no time phrase here')).toBeNull()
  })

  it('assess flags expired when expiresAt is in the past', () => {
    const item = mk({ id: 'a', content: 'trip', expiresAt: '2020-01-01T00:00:00Z' })
    const a = assess(item, { now: NOW(), halfLifeDays: 60 })
    expect(a.isExpired).toBe(true)
    expect(a.reason).toBe('expired')
  })

  it('assess flags stale when recency below threshold (and not expired)', () => {
    const item = mk({ id: 'a', content: 'no time phrase', updatedAt: '2024-01-01T00:00:00Z' })
    const a = assess(item, { now: NOW(), halfLifeDays: 60, staleThreshold: 0.25 })
    expect(a.isStale).toBe(true)
    expect(a.reason).toBe('stale')
  })

  it('filterActive drops expired, tags stale goals/projects with needs_refresh', () => {
    const expired = mk({ id: 'e', content: 'x', expiresAt: '2020-01-01T00:00:00Z' })
    const staleGoal = mk({ id: 'g', content: 'no phrase', type: MemoryType.GOAL, updatedAt: '2024-01-01T00:00:00Z' })
    const fresh = mk({ id: 'f', content: 'currently', updatedAt: '2026-06-22T00:00:00Z' })
    const out = filterActive([expired, staleGoal, fresh], { now: NOW(), halfLifeDays: 60 })
    expect(out.map((i) => i.id)).toEqual(['g', 'f']) // expired dropped
    expect(staleGoal.metadata.needs_refresh).toBe(true)
  })

  it('sortbyRecency orders newest first', () => {
    const old = mk({ id: 'o', updatedAt: '2024-01-01T00:00:00Z' })
    const newish = mk({ id: 'n', updatedAt: '2026-06-22T00:00:00Z' })
    const sorted = sortbyRecency([old, newish], { now: NOW() })
    expect(sorted.map((i) => i.id)).toEqual(['n', 'o'])
  })
})
