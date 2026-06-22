import { describe, expect, it } from 'vitest'
import {
  FESTIVALS, festivalGreeting, getActiveFestival,
  personalityMods, PERSONALITIES, rollPersonality
} from './pet-festivals'

describe('FESTIVALS', () => {
  it('has at least 8 festivals', () => {
    expect(FESTIVALS.length).toBeGreaterThanOrEqual(8)
  })

  it('covers major holidays', () => {
    const ids = FESTIVALS.map((f) => f.id)
    expect(ids).toContain('spring')
    expect(ids).toContain('christmas')
    expect(ids).toContain('halloween')
  })
})

describe('getActiveFestival', () => {
  it('detects single-day festival', () => {
    expect(getActiveFestival(new Date(2026, 0, 1))?.id).toBe('newyear') // 1月1日
  })
  it('detects date-range festival', () => {
    expect(getActiveFestival(new Date(2026, 11, 24))?.id).toBe('christmas') // 12月24日
  })
  it('returns null on non-festival day', () => {
    expect(getActiveFestival(new Date(2026, 6, 15))).toBeNull() // 7月15日
  })
})

describe('festivalGreeting', () => {
  it('returns a string', () => {
    const f = FESTIVALS[0]
    expect(typeof festivalGreeting(f)).toBe('string')
    expect(festivalGreeting(f).length).toBeGreaterThan(0)
  })
})

describe('personality system', () => {
  it('has 7 personalities', () => {
    expect(PERSONALITIES.length).toBe(7)
  })

  it('foodie has higher hunger decay + feed mood', () => {
    const m = personalityMods('foodie')
    expect(m.hungerDecayMultiplier).toBeGreaterThan(1)
    expect(m.feedMoodMultiplier).toBeGreaterThan(1)
  })

  it('scholar has study boost', () => {
    expect(personalityMods('scholar').studyMultiplier).toBeGreaterThan(1)
  })

  it('rollPersonality returns valid type', () => {
    const ids = PERSONALITIES.map((p) => p.id)
    expect(ids).toContain(rollPersonality())
  })
})
