import { describe, expect, it } from 'vitest'
import {
  computeFallStep,
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

describe('M3 state machine extensions', () => {
  const ctx = (now: number) => ({ now, walkArea, position: { x: 100, y: 100 } })

  it('grab from idle/wander → dragging', () => {
    const idle = makeIdle(0)
    expect(transitionPetMotion(idle, { type: 'grab' }, ctx(1000))).toEqual({ kind: 'dragging' })
  })

  it('dragging + release → falling with vy 0', () => {
    const dragging = { kind: 'dragging' as const }
    const next = transitionPetMotion(dragging, { type: 'release' }, ctx(1000))
    expect(next).toEqual({ kind: 'falling', vy: 0 })
  })

  it('falling + land → landed', () => {
    const falling = { kind: 'falling' as const, vy: 0.5 }
    const next = transitionPetMotion(falling, { type: 'land' }, ctx(1000))
    expect(next.kind).toBe('landed')
  })

  it('landed + timeout → idle', () => {
    const landed = { kind: 'landed' as const, until: 1000 }
    const next = transitionPetMotion(landed, { type: 'timeout' }, ctx(2000))
    expect(next.kind).toBe('idle')
  })

  it('wander + hitWall → bonk', () => {
    const wander = { kind: 'wander' as const, target: { x: 200, y: 200 }, until: 99999 }
    const next = transitionPetMotion(wander, { type: 'hitWall', fromLeft: true }, ctx(1000))
    expect(next.kind).toBe('bonk')
    expect(next).toHaveProperty('fromLeft', true)
  })

  it('bonk + timeout → idle or wander', () => {
    const bonk = { kind: 'bonk' as const, until: 1000, fromLeft: true }
    const next = transitionPetMotion(bonk, { type: 'timeout' }, { ...ctx(2000), random: () => 0.9 })
    expect(['idle', 'wander']).toContain(next.kind)
  })

  it('grab ignored when already falling', () => {
    const falling = { kind: 'falling' as const, vy: 0.5 }
    expect(transitionPetMotion(falling, { type: 'grab' }, ctx(1000))).toBe(falling)
  })
})

describe('computeFallStep', () => {
  it('accelerates downward with gravity', () => {
    const r = computeFallStep(100, 0, 100, 1000)
    expect(r.vy).toBeGreaterThan(0)
    expect(r.y).toBeGreaterThan(100)
    expect(r.landed).toBe(false)
  })

  it('caps at terminal velocity', () => {
    let vy = 0
    let y = 0
    for (let i = 0; i < 1000; i += 1) {
      const r = computeFallStep(y, vy, 100, 100000)
      vy = r.vy
      y = r.y
    }
    expect(vy).toBeLessThanOrEqual(1.5)
  })

  it('lands and clamps to groundY', () => {
    const r = computeFallStep(990, 1.5, 100, 1000)
    expect(r.landed).toBe(true)
    expect(r.y).toBe(1000)
    expect(r.vy).toBe(0)
  })
})
