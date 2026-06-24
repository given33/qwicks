import { describe, expect, it } from 'vitest'
import { TICKLE_REACTIONS, TICKLE_TYPES, TICKLE_CATEGORIES, TICKLE_LABELS, resolveTickle } from './pet-tickle'

describe('TICKLE_REACTIONS', () => {
  it('has 30+ interaction types (far exceeds QQ 5)', () => {
    expect(TICKLE_TYPES.length).toBeGreaterThanOrEqual(30)
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

  it('every type has a label', () => {
    for (const t of TICKLE_TYPES) {
      expect(TICKLE_LABELS[t]).toBeDefined()
      expect(TICKLE_LABELS[t].name.length).toBeGreaterThan(0)
    }
  })

  it('6 categories cover all types', () => {
    const categorized = new Set(TICKLE_CATEGORIES.flatMap((c) => c.types))
    for (const t of TICKLE_TYPES) {
      expect(categorized.has(t)).toBe(true)
    }
  })

  it('kiss gives most mood (emotional peak)', () => {
    expect(TICKLE_REACTIONS.kiss.moodDelta).toBeGreaterThanOrEqual(TICKLE_REACTIONS.hug.moodDelta)
  })

  it('scare can reduce mood (negative interaction)', () => {
    expect(TICKLE_REACTIONS.scare.moodDelta).toBeLessThan(0)
  })
})

describe('resolveTickle', () => {
  it('returns base reaction without special', () => {
    const r = resolveTickle('pet', () => 0.99)
    expect(r.expression).toBe('content')
  })

  it('triggers special reaction by chance', () => {
    const r = resolveTickle('poke', () => 0.05)
    expect(r.expression).toBe('angry')
  })

  it('deterministic with same random', () => {
    const r1 = resolveTickle('dance', () => 0.5)
    const r2 = resolveTickle('dance', () => 0.5)
    expect(r1).toEqual(r2)
  })

  it('special variants add variety', () => {
    // 多种互动有 special 反应
    const withSpecial = Object.values(TICKLE_REACTIONS).filter((r) => r.special)
    expect(withSpecial.length).toBeGreaterThanOrEqual(10)
  })
})
