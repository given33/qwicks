/**
 * 桌面宠物 —— 压力测试（极端数值/高频调用/边界）。
 *
 * 验证系统在异常输入、高频 tick、极端时长下不崩溃、不产生非法状态。
 * 粒子/重力的压力测试在 pet-environment.test.ts（renderer-pet 侧）。
 */
import { describe, expect, it } from 'vitest'
import {
  applyItemEffect,
  applyOfflineCatchUp,
  buyItem,
  defaultPetState,
  tickVitals,
  type PetState
} from './pet-state'

const HOUR = 60 * 60 * 1000

describe('stress: 属性衰减极端值', () => {
  it('零时长 tick 不变化', () => {
    const v = { hunger: 50, cleanliness: 50, health: 50, mood: 50 }
    expect(tickVitals(v, 0).hunger).toBe(50)
  })

  it('超长时长不产生负值或 NaN', () => {
    const next = tickVitals({ hunger: 50, cleanliness: 50, health: 50, mood: 50 }, 365 * 24 * HOUR)
    for (const val of Object.values(next)) {
      expect(val).not.toBeNaN()
      expect(val).toBeGreaterThanOrEqual(0)
    }
  })

  it('0 属性再 tick 仍 ≥0', () => {
    const next = tickVitals({ hunger: 0, cleanliness: 0, health: 0, mood: 0 }, 10 * HOUR)
    for (const val of Object.values(next)) {
      expect(val).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('stress: 离线补算极端', () => {
  it('负时长（时钟回拨）不崩溃', () => {
    const state = defaultPetState(10000)
    const next = applyOfflineCatchUp(state, 5000)
    expect(next.vitals.hunger).toBeGreaterThanOrEqual(0)
  })

  it('极大时长被 cap 保护，宠物存活', () => {
    const state = defaultPetState(0)
    const next = applyOfflineCatchUp(state, Number.MAX_SAFE_INTEGER)
    expect(next.status).not.toBe('collapsed')
  })
})

describe('stress: 经济边界', () => {
  it('元宝不足买高价品被拒', () => {
    const state = { ...defaultPetState(0), coins: 5 }
    const item = { id: 'feast', type: 'food' as const, name: '满汉全席', effect: { hunger: 80 }, price: 80 }
    expect(buyItem(state, item)).toBe(state)
  })

  it('0 元宝买 0 价物品成功', () => {
    const state = { ...defaultPetState(0), coins: 0 }
    const free = { id: 'free', type: 'toy' as const, name: '免费', effect: {}, price: 0 }
    expect(buyItem(state, free).inventory).toHaveLength(1)
  })
})

describe('stress: 还魂丹复活', () => {
  it('collapsed 宠物用还魂丹满血复活', () => {
    const state: PetState = {
      ...defaultPetState(0),
      status: 'collapsed',
      vitals: { hunger: 0, cleanliness: 0, health: 0, mood: 0 }
    }
    const revive = { id: 'revive', type: 'revive' as const, name: '还魂丹', effect: {}, price: 200 }
    const next = applyItemEffect(state, revive)
    expect(next.vitals.health).toBe(100)
    expect(next.status).not.toBe('collapsed')
  })
})
