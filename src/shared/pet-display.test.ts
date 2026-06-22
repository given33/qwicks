import { describe, expect, it } from 'vitest'
import {
  computeVirtualDesktopBounds,
  findDisplayAtPoint,
  isPointOnAnyDisplay,
  screenToWindowCoordinate,
  windowToScreenCoordinate
} from './pet-display'

describe('computeVirtualDesktopBounds', () => {
  it('returns 1x1 fallback when no displays', () => {
    expect(computeVirtualDesktopBounds([])).toEqual({ x: 0, y: 0, width: 1, height: 1, originX: 0, originY: 0 })
  })

  it('single display returns itself', () => {
    const union = computeVirtualDesktopBounds([{ x: 0, y: 0, width: 1920, height: 1080 }])
    expect(union).toEqual({ x: 0, y: 0, width: 1920, height: 1080, originX: 0, originY: 0 })
  })

  it('two displays side by side (right) spans both', () => {
    const union = computeVirtualDesktopBounds([
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 2560, height: 1440 }
    ])
    expect(union).toEqual({ x: 0, y: 0, width: 4480, height: 1440, originX: 0, originY: 0 })
  })

  it('display on the left produces negative origin', () => {
    const union = computeVirtualDesktopBounds([
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: -2560, y: 0, width: 2560, height: 1440 }
    ])
    expect(union.originX).toBe(-2560)
    expect(union.originY).toBe(0)
    expect(union.width).toBe(4480)
    expect(union.height).toBe(1440)
  })

  it('misaligned displays take outer rectangle (dead zone in middle)', () => {
    // 主屏在左上，副屏在右下，中间有死区
    const union = computeVirtualDesktopBounds([
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 2200, y: 600, width: 1920, height: 1080 }
    ])
    expect(union).toEqual({ x: 0, y: 0, width: 4120, height: 1680, originX: 0, originY: 0 })
  })
})

describe('isPointOnAnyDisplay', () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 }
  ]
  it('point inside a display is true', () => {
    expect(isPointOnAnyDisplay({ x: 100, y: 100 }, displays)).toBe(true)
    expect(isPointOnAnyDisplay({ x: 2000, y: 100 }, displays)).toBe(true)
  })
  it('point in dead zone between/around displays is false', () => {
    expect(isPointOnAnyDisplay({ x: 5000, y: 5000 }, displays)).toBe(false)
  })
})

describe('findDisplayAtPoint', () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 }
  ]
  it('finds the display containing the point', () => {
    expect(findDisplayAtPoint({ x: 100, y: 100 }, displays)).toEqual(displays[0])
    expect(findDisplayAtPoint({ x: 3000, y: 100 }, displays)).toEqual(displays[1])
  })
  it('returns null in dead zone', () => {
    expect(findDisplayAtPoint({ x: 9999, y: 9999 }, displays)).toBeNull()
  })
})

describe('coordinate conversion', () => {
  const union = computeVirtualDesktopBounds([
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: -2560, y: 0, width: 2560, height: 1440 }
  ])
  // union origin = (-2560, 0)
  it('screenToWindow shifts by origin', () => {
    expect(screenToWindowCoordinate({ x: -2560, y: 0 }, union)).toEqual({ x: 0, y: 0 })
    expect(screenToWindowCoordinate({ x: 0, y: 0 }, union)).toEqual({ x: 2560, y: 0 })
  })
  it('windowToScreen is the inverse', () => {
    const screen = { x: -1000, y: 500 }
    const win = screenToWindowCoordinate(screen, union)
    expect(windowToScreenCoordinate(win, union)).toEqual(screen)
  })
})
