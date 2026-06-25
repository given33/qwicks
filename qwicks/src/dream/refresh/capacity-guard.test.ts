/**
 * Batch D (spec §4): MemoryCapacityGuard — soft limit → auto-demote lowest value.
 * RESTRICTED never demoted; SENSITIVE penalized 0.5; protected window + top_of_mind exempt.
 * Background is NOT deletion — items remain retrievable.
 */
import { describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryScope,
  MemoryType,
  SensitivityLevel
} from '../types.js'
import { guardCapacity } from './capacity-guard.js'
import type { CapacityConfig } from './capacity-guard.js'

function item(id: string, opts: Partial<MemoryItem> & { sensitivity?: SensitivityLevel } = {}): MemoryItem {
  return new MemoryItem(
    id,
    'default',
    MemoryType.FACT,
    opts.content ?? `content-${id}`,
    MemoryScope.USER,
    [],
    opts.importance ?? 0.5,
    0.7,
    opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    opts.updatedAt ?? '2026-01-01T00:00:00.000Z',
    null,
    undefined,
    null,
    undefined,
    [],
    opts.metadata ?? {},
    MemoryLifecycleStatus.ACTIVE,
    [],
    2,
    [],
    [],
    undefined,
    null,
    null,
    [],
    [],
    opts.isTopOfMind ?? false,
    opts.isSuppressed ?? false,
    false,
    opts.salience ?? 0.5,
    null,
    null,
    opts.sensitivity ?? SensitivityLevel.NORMAL,
    true,
    []
  )
}

const cfg: CapacityConfig = {
  softLimit: 10,
  hardLimit: 20,
  protectWindowHours: 24,
  sensitiveDemotePenalty: 0.5
}

describe('guardCapacity', () => {
  it('demotes lowest-value items until under softLimit', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: i / 12 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toHaveLength(2)
    expect(plan.toDemote).toContain('m0')
    expect(plan.toDemote).toContain('m1')
  })

  it('RESTRICTED items are never demoted', () => {
    const items = [
      item('r1', { salience: 0.01, sensitivity: SensitivityLevel.RESTRICTED }),
      ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).not.toContain('r1')
  })

  it('SENSITIVE items get 0.5 penalty — demoted before NORMAL at equal value', () => {
    const items = [
      item('sensitive', { salience: 0.5, sensitivity: SensitivityLevel.SENSITIVE }),
      item('normal', { salience: 0.5, sensitivity: SensitivityLevel.NORMAL }),
      ...Array.from({ length: 10 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, { ...cfg, softLimit: 11 }, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toContain('sensitive')
    expect(plan.toDemote).not.toContain('normal')
  })

  it('items within protectWindow (recently created) are exempt', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    const recent = item('recent', { salience: 0.01, createdAt: '2026-06-01T11:00:00.000Z' })
    const items = [recent, ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))]
    const plan = guardCapacity(items, cfg, now)
    expect(plan.toDemote).not.toContain('recent')
  })

  it('top_of_mind items are exempt', () => {
    const items = [
      item('tom', { salience: 0.01, isTopOfMind: true }),
      ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).not.toContain('tom')
  })

  it('under softLimit → nothing demoted', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`m${i}`, { salience: 0.5 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toEqual([])
    expect(plan.atHardLimit).toBe(false)
  })

  it('exceeding hardLimit → atHardLimit flag', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`m${i}`, { salience: 0.5 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.atHardLimit).toBe(true)
  })

  it('idempotent — background items excluded from active count', () => {
    const bg = item('bg', { salience: 0.01, metadata: { background: true } })
    const items = [bg, ...Array.from({ length: 10 }, (_, i) => item(`m${i}`, { salience: 0.9 }))]
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toEqual([])
  })
})
