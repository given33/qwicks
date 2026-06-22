import { describe, expect, it } from 'vitest'
import { filterValidObstacles, isPointBlockedByAny, isPointInRect } from './pet-obstacles'

describe('isPointInRect', () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 }
  it('inside is true', () => {
    expect(isPointInRect({ x: 200, y: 175 }, rect)).toBe(true)
  })
  it('outside is false', () => {
    expect(isPointInRect({ x: 50, y: 175 }, rect)).toBe(false)
  })
  it('padding expands', () => {
    expect(isPointInRect({ x: 90, y: 175 }, rect, 0)).toBe(false)
    expect(isPointInRect({ x: 90, y: 175 }, rect, 20)).toBe(true)
  })
})

describe('isPointBlockedByAny', () => {
  const obstacles = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 500, y: 500, width: 100, height: 100 }
  ]
  it('blocked by first', () => {
    expect(isPointBlockedByAny({ x: 50, y: 50 }, obstacles)).toBe(true)
  })
  it('blocked by second', () => {
    expect(isPointBlockedByAny({ x: 550, y: 550 }, obstacles)).toBe(true)
  })
  it('not blocked in gap', () => {
    expect(isPointBlockedByAny({ x: 300, y: 300 }, obstacles)).toBe(false)
  })
})

describe('filterValidObstacles', () => {
  it('drops degenerate rects', () => {
    const result = filterValidObstacles([
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 100, height: 0 },
      { x: 0, y: 0, width: 1, height: 1 }, // 1px 视为退化，排除
      { x: 0, y: 0, width: 200, height: 150 }
    ])
    expect(result).toHaveLength(1)
    expect(result[0].width).toBe(200)
  })
})
