import { describe, expect, it } from 'vitest'
import {
  hasReachedTarget,
  isMotionTimedOut,
  makeIdle,
  pickWanderTarget,
  transitionPetMotion
} from './pet-motion'

const walkArea = { x: 0, y: 0, width: 1920, height: 1080 }

describe('pickWanderTarget', () => {
  it('target stays within walk area bounds', () => {
    const ctx = { now: 0, walkArea, position: { x: 960, y: 540 }, random: () => 0.5 }
    const target = pickWanderTarget(ctx)
    expect(target.x).toBeGreaterThanOrEqual(48)
    expect(target.x).toBeLessThanOrEqual(1920 - 48)
    expect(target.y).toBeGreaterThanOrEqual(60)
    expect(target.y).toBeLessThanOrEqual(1080 - 60)
  })

  it('respects injected RNG for deterministic tests', () => {
    const ctx = { now: 0, walkArea, position: { x: 960, y: 540 }, random: () => 0 }
    // rng=0 → target 接近左上角（最小值）
    const target = pickWanderTarget(ctx)
    expect(target.x).toBeCloseTo(48, 0)
    expect(target.y).toBeCloseTo(60, 0)
  })
})

describe('transitionPetMotion', () => {
  it('idle timeout with low random → wander', () => {
    // idle→wander: rng < 0.6 时转 wander
    const state = makeIdle(0)
    const next = transitionPetMotion(state, { type: 'timeout' }, {
      now: 5000,
      walkArea,
      position: { x: 100, y: 100 },
      random: () => 0.1
    })
    expect(next.kind).toBe('wander')
  })

  it('idle timeout with high random → new idle', () => {
    const state = makeIdle(0)
    const next = transitionPetMotion(state, { type: 'timeout' }, {
      now: 5000,
      walkArea,
      position: { x: 100, y: 100 },
      random: () => 0.9 // >= 0.6 → 继续 idle
    })
    expect(next.kind).toBe('idle')
  })

  it('wander reached → idle', () => {
    const state = { kind: 'wander' as const, target: { x: 200, y: 200 }, until: 99999 }
    const next = transitionPetMotion(state, { type: 'reached' }, {
      now: 1000,
      walkArea,
      position: { x: 200, y: 200 }
    })
    expect(next.kind).toBe('idle')
  })

  it('wander timeout → re-wander or idle (depends on rng)', () => {
    const state = { kind: 'wander' as const, target: { x: 200, y: 200 }, until: 100 }
    // wander timeout: rng < 0.5 → re-wander; rng >= 0.5 → idle
    const nextWander = transitionPetMotion(state, { type: 'timeout' }, {
      now: 200,
      walkArea,
      position: { x: 100, y: 100 },
      random: () => 0.1
    })
    expect(nextWander.kind).toBe('wander')

    const nextIdle = transitionPetMotion(state, { type: 'timeout' }, {
      now: 200,
      walkArea,
      position: { x: 100, y: 100 },
      random: () => 0.9
    })
    expect(nextIdle.kind).toBe('idle')
  })

  it('idle ignores reached event', () => {
    const state = makeIdle(0)
    const next = transitionPetMotion(state, { type: 'reached' }, {
      now: 1000,
      walkArea,
      position: { x: 100, y: 100 }
    })
    expect(next).toBe(state)
  })
})

describe('helpers', () => {
  it('hasReachedTarget true within threshold', () => {
    expect(hasReachedTarget({ x: 100, y: 100 }, { x: 103, y: 104 })).toBe(true)
    expect(hasReachedTarget({ x: 100, y: 100 }, { x: 200, y: 200 })).toBe(false)
  })

  it('isMotionTimedOut compares now vs until', () => {
    expect(isMotionTimedOut({ kind: 'idle', until: 5000 }, 5000)).toBe(true)
    expect(isMotionTimedOut({ kind: 'idle', until: 5000 }, 4999)).toBe(false)
  })
})
