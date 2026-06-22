import { describe, expect, it } from 'vitest'
import { TICKLE_REACTIONS, TICKLE_TYPES, resolveTickle } from './pet-tickle'

describe('TICKLE_REACTIONS', () => {
  it('has 12+ interaction types (exceeds QQ 5)', () => {
    expect(TICKLE_TYPES.length).toBeGreaterThanOrEqual(12)
  })

  it('every reaction has required fields', () => {
    for (const [type, r] of Object.entries(TICKLE_REACTIONS)) {
      expect(typeof r.expression).toBe('string')
      expect(typeof r.moodDelta).toBe('number')
      expect(typeof r.text).toBe('string')
      expect(r.text.length).toBeGreaterThan(0)
      expect(typeof r.floatText).toBe('string')
    }
  })

  it('hug gives most mood (emotional peak)', () => {
    expect(TICKLE_REACTIONS.hug.moodDelta).toBeGreaterThan(TICKLE_REACTIONS.pet.moodDelta)
  })

  it('scare can reduce mood (negative interaction)', () => {
    expect(TICKLE_REACTIONS.scare.moodDelta).toBeLessThan(0)
  })
})

describe('resolveTickle', () => {
  it('returns base reaction without special', () => {
    const r = resolveTickle('pet', () => 0.99) // 高随机值，不触发 special(<0.15)
    expect(r.expression).toBe('content')
  })

  it('triggers special reaction by chance', () => {
    const r = resolveTickle('poke', () => 0.05) // <0.15 触发 special
    expect(r.expression).toBe('angry')
    expect(r.text).toContain('烦')
  })

  it('deterministic with same random', () => {
    const r1 = resolveTickle('tickle', () => 0.5)
    const r2 = resolveTickle('tickle', () => 0.5)
    expect(r1).toEqual(r2)
  })
})
