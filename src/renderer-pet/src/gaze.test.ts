import { describe, expect, it } from 'vitest'
import { angleBetween, clampAngle, computeGazeTilt } from './gaze'

describe('angleBetween', () => {
  it('right is 0 deg', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0, 5)
  })
  it('down is 90 deg (screen y-down)', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90, 5)
  })
  it('left is 180/-180', () => {
    expect(Math.abs(angleBetween({ x: 0, y: 0 }, { x: -100, y: 0 }))).toBeCloseTo(180, 5)
  })
})

describe('clampAngle', () => {
  it('clamps to range', () => {
    expect(clampAngle(45, 12)).toBe(12)
    expect(clampAngle(-45, 12)).toBe(-12)
    expect(clampAngle(5, 12)).toBe(5)
  })
})

describe('computeGazeTilt', () => {
  it('mouse directly right → positive tilt up to maxTilt', () => {
    const tilt = computeGazeTilt({ x: 100, y: 100 }, { x: 1000, y: 100 }, 12)
    expect(tilt).toBeCloseTo(12, 5)
  })
  it('mouse directly left → negative tilt', () => {
    const tilt = computeGazeTilt({ x: 1000, y: 100 }, { x: 100, y: 100 }, 12)
    expect(tilt).toBeCloseTo(-12, 5)
  })
  it('mouse on sprite → zero tilt', () => {
    expect(computeGazeTilt({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(0)
  })
  it('scales smoothly with distance', () => {
    const near = computeGazeTilt({ x: 0, y: 0 }, { x: 50, y: 0 }, 12)
    const far = computeGazeTilt({ x: 0, y: 0 }, { x: 300, y: 0 }, 12)
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(far)
    expect(far).toBeCloseTo(12, 5)
  })
})
