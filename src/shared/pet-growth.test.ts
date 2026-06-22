import { describe, expect, it } from 'vitest'
import {
  ADULT_MIN_LEVEL,
  addExp,
  advanceToAdult,
  canAdvanceToAdult,
  defaultGrowth,
  EGG_HATCH_DURATION_MS,
  EXP_PER_LEVEL,
  MAX_LEVEL,
  tickEgg
} from './pet-growth'

describe('defaultGrowth', () => {
  it('starts as egg with gender', () => {
    const g = defaultGrowth(1000)
    expect(g.stage).toBe('egg')
    expect(['GG', 'MM']).toContain(g.gender)
    expect(g.eggProgress).toBe(0)
  })
})

describe('tickEgg', () => {
  it('accumulates progress over time', () => {
    const g = defaultGrowth(0)
    const next = tickEgg(g, EGG_HATCH_DURATION_MS / 2) // 半程
    expect(next.eggProgress).toBeCloseTo(50, 0)
    expect(next.stage).toBe('egg')
  })

  it('hatches to kid when progress reaches 100', () => {
    const g = defaultGrowth(0)
    const next = tickEgg(g, EGG_HATCH_DURATION_MS + 1000)
    expect(next.stage).toBe('kid')
    expect(next.eggProgress).toBe(100)
    expect(next.level).toBe(0)
  })

  it('growthSpeed accelerates hatching', () => {
    const g = defaultGrowth(0)
    // 2x 速度，一半时间即孵化
    const next = tickEgg(g, EGG_HATCH_DURATION_MS / 2, 2)
    expect(next.stage).toBe('kid')
  })

  it('no-op when not egg', () => {
    const kid = { ...defaultGrowth(0), stage: 'kid' as const }
    expect(tickEgg(kid, 1000)).toBe(kid)
  })
})

describe('canAdvanceToAdult + advanceToAdult', () => {
  it('kid needs both time and level', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const lowLevel = { ...defaultGrowth(0), stage: 'kid' as const, level: 1, stageEnteredAt: 0 }
    expect(canAdvanceToAdult(lowLevel, now)).toBe(false) // 等级不够
    const highLevelYoung = { ...lowLevel, level: ADULT_MIN_LEVEL, stageEnteredAt: now - 1000 }
    expect(canAdvanceToAdult(highLevelYoung, now)).toBe(false) // 时间不够
    const ready = { ...lowLevel, level: ADULT_MIN_LEVEL, stageEnteredAt: 0 }
    expect(canAdvanceToAdult(ready, now)).toBe(true)
  })

  it('advanceToAdult changes stage', () => {
    const kid = { ...defaultGrowth(0), stage: 'kid' as const, level: 5, stageEnteredAt: 0 }
    const adult = advanceToAdult(kid, 9999)
    expect(adult.stage).toBe('adult')
    expect(adult.stageEnteredAt).toBe(9999)
  })
})

describe('addExp', () => {
  it('accumulates exp and levels up at threshold', () => {
    const kid = { ...defaultGrowth(0), stage: 'kid' as const }
    const r = addExp(kid, EXP_PER_LEVEL + 10)
    expect(r.leveledUp).toBe(true)
    expect(r.growth.level).toBe(1)
    expect(r.growth.exp).toBe(10)
  })

  it('caps at MAX_LEVEL', () => {
    const nearMax = { ...defaultGrowth(0), stage: 'kid' as const, level: MAX_LEVEL - 1, exp: 90 }
    const r = addExp(nearMax, 1000)
    expect(r.growth.level).toBe(MAX_LEVEL)
    expect(r.growth.exp).toBe(0)
    // 已满级再加 exp 不变
    const r2 = addExp(r.growth, 100)
    expect(r2.growth).toBe(r.growth)
  })

  it('egg gains no exp', () => {
    const egg = defaultGrowth(0)
    const r = addExp(egg, 100)
    expect(r.leveledUp).toBe(false)
    expect(r.growth).toBe(egg)
  })
})
