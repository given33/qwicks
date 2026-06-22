import { describe, expect, it } from 'vitest'
import { isPointInBbox } from './bbox'

describe('isPointInBbox', () => {
  const bbox = { x: 100, y: 100, width: 80, height: 120 }

  it('point inside bbox is true', () => {
    expect(isPointInBbox({ x: 140, y: 160 }, bbox)).toBe(true)
  })

  it('point on edge is true (inclusive)', () => {
    expect(isPointInBbox({ x: 100, y: 100 }, bbox)).toBe(true)
    expect(isPointInBbox({ x: 180, y: 220 }, bbox)).toBe(true)
  })

  it('point outside is false', () => {
    expect(isPointInBbox({ x: 50, y: 160 }, bbox)).toBe(false)
    expect(isPointInBbox({ x: 140, y: 300 }, bbox)).toBe(false)
  })

  it('padding expands the hit area', () => {
    // 8px 外的点，无 padding 时 false，有 padding 时 true
    expect(isPointInBbox({ x: 90, y: 160 }, bbox, 0)).toBe(false)
    expect(isPointInBbox({ x: 90, y: 160 }, bbox, 12)).toBe(true)
  })
})
