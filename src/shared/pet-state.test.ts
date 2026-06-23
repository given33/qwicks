import { describe, expect, it } from 'vitest'
import {
  applyItemEffect,
  applyOfflineCatchUp,
  applySignIn,
  buyItem,
  consumeItem,
  defaultPetState,
  deriveStatus,
  OFFLINE_CATCH_UP_CAP_MS,
  tickVitals,
  type PetState
} from './pet-state'

const HOUR = 60 * 60 * 1000

describe('tickVitals', () => {
  it('decreases hunger and cleanliness over time', () => {
    const v = { hunger: 80, cleanliness: 80, health: 100, mood: 80 }
    const next = tickVitals(v, HOUR)
    expect(next.hunger).toBeLessThan(80)
    expect(next.cleanliness).toBeLessThan(80)
  })

  it('non-linear: decay slows near zero', () => {
    const high = tickVitals({ hunger: 90, cleanliness: 90, health: 100, mood: 80 }, HOUR)
    const low = tickVitals({ hunger: 10, cleanliness: 90, health: 100, mood: 80 }, HOUR)
    // 低值时实际衰减更小（因子更小）
    const highLoss = 90 - high.hunger
    const lowLoss = 10 - low.hunger
    expect(lowLoss).toBeLessThan(highLoss)
  })

  it('health drops when hunger below threshold', () => {
    const v = { hunger: 20, cleanliness: 90, health: 80, mood: 80 }
    const next = tickVitals(v, HOUR)
    expect(next.health).toBeLessThan(80)
  })

  it('health recovers slowly when all good', () => {
    const v = { hunger: 80, cleanliness: 80, health: 70, mood: 80 }
    const next = tickVitals(v, HOUR)
    expect(next.health).toBeGreaterThan(70)
  })

  it('mood is weighted average of three vitals', () => {
    const v = { hunger: 100, cleanliness: 100, health: 100, mood: 0 }
    const next = tickVitals(v, 0) // 0 时间，只重算 mood
    expect(next.mood).toBeCloseTo(100, 0)
  })
  // BUG-7 回归：脏数据 >100 应被 clamp
  it('clamps dirty input >100 to [0,100]', () => {
    const next = tickVitals({ hunger: 120, cleanliness: 50, health: 50, mood: 50 }, HOUR)
    expect(next.hunger).toBeLessThanOrEqual(100)
  })
})

describe('deriveStatus', () => {
  it('priority: collapsed > critical > sick > hungry > dirty', () => {
    expect(deriveStatus({ hunger: 0, cleanliness: 0, health: 0, mood: 0 })).toBe('collapsed')
    expect(deriveStatus({ hunger: 0, cleanliness: 0, health: 5, mood: 0 })).toBe('critical')
    expect(deriveStatus({ hunger: 0, cleanliness: 0, health: 25, mood: 0 })).toBe('sick')
    expect(deriveStatus({ hunger: 20, cleanliness: 50, health: 60, mood: 50 })).toBe('hungry')
    expect(deriveStatus({ hunger: 50, cleanliness: 20, health: 60, mood: 50 })).toBe('dirty')
    expect(deriveStatus({ hunger: 80, cleanliness: 80, health: 80, mood: 80 })).toBe('healthy')
  })
})

describe('applyOfflineCatchUp', () => {
  it('applies decay for elapsed time', () => {
    const state = defaultPetState(0)
    const next = applyOfflineCatchUp(state, HOUR)
    expect(next.vitals.hunger).toBeLessThan(state.vitals.hunger)
    expect(next.lastTickAt).toBe(HOUR)
  })

  it('caps at OFFLINE_CATCH_UP_CAP_MS (30d does not kill pet)', () => {
    const state = defaultPetState(0)
    const thirtyDays = 30 * 24 * HOUR
    const next = applyOfflineCatchUp(state, thirtyDays)
    // 即使离线 30 天，因 8h 上限，宠物不应 collapsed
    expect(next.status).not.toBe('collapsed')
    // 确认衰减只按 8h 算
    const capped = applyOfflineCatchUp(state, OFFLINE_CATCH_UP_CAP_MS)
    expect(next.vitals.hunger).toBeCloseTo(capped.vitals.hunger, 0)
  })

  it('zero elapsed returns state unchanged', () => {
    const state = defaultPetState(1000)
    const next = applyOfflineCatchUp(state, 1000)
    expect(next.vitals).toEqual(state.vitals)
  })
})

describe('applyItemEffect', () => {
  it('food restores hunger', () => {
    const state: PetState =
      { ...defaultPetState(0), vitals: { hunger: 30, cleanliness: 80, health: 90, mood: 50 } }
    const next = applyItemEffect(state, { id: 'bun', type: 'food', name: '包子', effect: { hunger: 40 }, price: 10 })
    expect(next.vitals.hunger).toBe(70)
  })

  it('revive pill resurrects collapsed pet with full health', () => {
    const state = { ...defaultPetState(0), status: 'collapsed' as const, vitals: { hunger: 0, cleanliness: 0, health: 0, mood: 0 } }
    const next = applyItemEffect(state, { id: 'revive', type: 'revive', name: '还魂丹', effect: {}, price: 100 })
    expect(next.vitals.health).toBe(100)
    expect(next.status).not.toBe('collapsed')
  })

  it('clamps vitals to 0-100', () => {
    const state = { ...defaultPetState(0), vitals: { hunger: 90, cleanliness: 90, health: 90, mood: 90 } }
    const next = applyItemEffect(state, { id: 'feast', type: 'food', name: '满汉全席', effect: { hunger: 50 }, price: 50 })
    expect(next.vitals.hunger).toBe(100)
  })
})

describe('applySignIn', () => {
  it('awards coins once per day', () => {
    const state = defaultPetState(0)
    const r1 = applySignIn(state, '2026-06-23')
    expect(r1.awarded).toBe(true)
    expect(r1.state.coins).toBe(state.coins + 30)
    const r2 = applySignIn(r1.state, '2026-06-23')
    expect(r2.awarded).toBe(false)
    expect(r2.state.coins).toBe(r1.state.coins)
  })

  it('different day awards again', () => {
    const state = { ...defaultPetState(0), lastSignInDate: '2026-06-23' }
    const r = applySignIn(state, '2026-06-24')
    expect(r.awarded).toBe(true)
  })
})

describe('buyItem / consumeItem', () => {
  it('buy deducts coins and adds to inventory', () => {
    const state = defaultPetState(0)
    const item = { id: 'x', type: 'food' as const, name: 'x', effect: {}, price: 50 }
    const next = buyItem(state, item)
    expect(next.coins).toBe(state.coins - 50)
    expect(next.inventory).toHaveLength(1)
  })

  it('buy rejects when insufficient coins', () => {
    const state = { ...defaultPetState(0), coins: 10 }
    const item = { id: 'x', type: 'food' as const, name: 'x', effect: {}, price: 50 }
    expect(buyItem(state, item)).toBe(state)
  })

  it('consume removes item from inventory', () => {
    const item = { id: 'x', type: 'food' as const, name: 'x', effect: {}, price: 0 }
    const state = { ...defaultPetState(0), inventory: [item] }
    const { state: next, item: used } = consumeItem(state, 'x')
    expect(used).toEqual(item)
    expect(next.inventory).toHaveLength(0)
  })

  it('consume unknown id returns null item, unchanged state', () => {
    const state = defaultPetState(0)
    const { state: next, item } = consumeItem(state, 'nope')
    expect(item).toBeNull()
    expect(next.inventory).toBe(state.inventory)
  })
})
