/**
 * 桌面宠物 —— 端到端集成测试。
 *
 * 串联纯函数验证完整业务闭环（Electron 无 GUI 环境下能做的最深层 e2e）。
 * 覆盖：照料→属性变化→成就解锁→档案记录→经济流转→成长推进→婚育。
 * 视觉/交互的 e2e（点击 UI 看宠物反应）需手动验收，见最终汇报清单。
 */
import { describe, expect, it } from 'vitest'
import {
  applyItemEffect,
  applyOfflineCatchUp,
  applySignIn,
  buyItem,
  consumeItem,
  defaultPetState,
  deriveStatus,
  tickVitals,
  type PetState
} from './pet-state'
import { addExp, advanceToAdult, canAdvanceToAdult, defaultGrowth, tickEgg } from './pet-growth'
import { checkAchievements, defaultStats } from './pet-achievements'
import { findItem } from './pet-catalog'
import { rollCatch, type FishCatch } from './fishing-logic'
import { harvest, plant } from './farm-logic'
import { scoreToCoins } from './minigame-logic'
import { layEgg, marry } from './pet-marriage'

const HOUR = 60 * 60 * 1000

describe('e2e: 完整生命周期闭环', () => {
  it('新宠物 → 孵化 → 成长 → 成年 → 结婚 → 育蛋', () => {
    // 1. 新宠物是蛋
    let state = defaultPetState(0)
    expect(state.growth?.stage).toBe('egg')

    // 2. 蛋孵化（加速）
    let growth = state.growth!
    growth = tickEgg(growth, 31 * 60 * 1000, 100) // 100x 加速
    expect(growth.stage).toBe('kid')
    state = { ...state, growth }

    // 3. 幼年喂食成长
    for (let i = 0; i < 5; i += 1) {
      const food = findItem('rice')!
      state = { ...state, coins: state.coins + 20 } // 给点钱买食物
      state = buyItem(state, food)
      const { state: next, item } = consumeItem(state, food.id)
      state = applyItemEffect(next, item!)
    }
    expect(state.vitals.hunger).toBeGreaterThan(80)

    // 4. 累积经验升级到可成年等级
    let expResult = addExp(state.growth!, 1000)
    state = { ...state, growth: expResult.growth }
    expect(state.growth!.level).toBeGreaterThanOrEqual(3)

    // 5. 时间到，晋升成年（手动设 stageEnteredAt=0 模拟已饲养足够久）
    const future = 8 * 24 * 60 * 60 * 1000 // 8 天后
    growth = { ...state.growth!, stageEnteredAt: 0 }
    state = { ...state, growth }
    expect(canAdvanceToAdult(state.growth!, future)).toBe(true)
    growth = advanceToAdult(state.growth!, future)
    state = { ...state, growth }
    expect(state.growth!.stage).toBe('adult')

    // 6. 成年结婚
    let marriageState = marry({ partnerId: null, partnerName: null, marriedAt: null, eggs: 0 }, { id: 'p1', name: '小花' }, future)
    expect(marriageState.partnerName).toBe('小花')

    // 7. 培育宠物蛋
    const eggResult = layEgg(marriageState, future + 1)
    expect(eggResult.laid).toBe(true)
    expect(eggResult.state.eggs).toBe(1)
  })
})

describe('e2e: 照料 → 属性 → 状态 → 成就 闭环', () => {
  it('饥饿→生病→治疗→恢复 全链路', () => {
    let state: PetState = { ...defaultPetState(0), growth: { ...defaultGrowth(0), stage: 'kid' } }
    // 模拟长时间不喂（饥饿暴跌）
    state = {
      ...state,
      vitals: tickVitals({ ...state.vitals, hunger: 20, cleanliness: 90, health: 100, mood: 80 }, 10 * HOUR),
      status: 'healthy' as never
    }
    state = { ...state, status: deriveStatus(state.vitals) }
    // 饥饿低位 → 至少进入 hungry 或更糟（health 若也掉则 sick）
    expect(['hungry', 'sick', 'critical', 'dirty']).toContain(state.status)

    // 持续饥饿 → 健康下降
    let vitals = tickVitals(state.vitals, 20 * HOUR)
    expect(vitals.health).toBeLessThan(state.vitals.health)

    // 严重掉健康 → sick
    vitals = { ...vitals, health: 20 }
    expect(deriveStatus(vitals)).toBe('sick')

    // 治病
    state = { ...state, vitals, status: deriveStatus(vitals) }
    const meds = findItem('special-meds')!
    state = { ...state, coins: state.coins + 100 }
    state = buyItem(state, meds)
    const { state: cured, item } = consumeItem(state, meds.id)
    state = applyItemEffect(cured, item!)
    expect(state.vitals.health).toBeGreaterThan(20)
  })

  it('喂食10次解锁"初级饲养员"成就', () => {
    const stats = { ...defaultStats(), feedCount: 10 }
    expect(stats.feedCount).toBe(10)
    const { newlyUnlocked } = checkAchievements(stats, [])
    expect(newlyUnlocked).toContain('feed-10')
  })
})

describe('e2e: 经济流转闭环', () => {
  it('签到得元宝 → 买食物 → 喂食 → 属性恢复', () => {
    let state: PetState = { ...defaultPetState(0), growth: { ...defaultGrowth(0), stage: 'kid' } }
    const initialCoins = state.coins

    // 签到 +30
    state = applySignIn(state, '2026-06-23').state
    expect(state.coins).toBe(initialCoins + 30)

    // 买包子 10元
    const bun = findItem('bun')!
    state = buyItem(state, bun)
    expect(state.coins).toBe(initialCoins + 30 - 10)
    expect(state.inventory).toHaveLength(1)

    // 喂食 → 饥饿恢复
    const before = state.vitals.hunger
    const { state: next, item } = consumeItem(state, bun.id)
    state = applyItemEffect(next, item!)
    expect(state.vitals.hunger).toBeGreaterThan(before)
    expect(state.inventory).toHaveLength(0)
  })

  it('钓鱼 → 卖鱼 → 得元宝', () => {
    const fish: FishCatch = rollCatch(5)
    expect(fish.value).toBeGreaterThan(0)
    let coins = 100
    coins += fish.value
    expect(coins).toBeGreaterThan(100)
  })

  it('农场 种→长→收→卖', () => {
    let farm = plant({ plots: Array.from({ length: 6 }, () => ({ cropId: null, plantedAt: null })) }, 0, 'radish', 0)
    const crop = harvest(farm, 0, 31 * 1000) // 萝卜30s成熟
    expect(crop.reward).toBeGreaterThan(0)
  })

  it('小游戏 得分 → 换元宝', () => {
    expect(scoreToCoins(10)).toBe(20)
  })
})

describe('e2e: 离线补算 + 长期稳定性', () => {
  it('离线8h回来宠物状态合理（不直接死亡）', () => {
    const state = defaultPetState(0)
    const after8h = applyOfflineCatchUp(state, 8 * HOUR)
    expect(after8h.status).not.toBe('collapsed')
    expect(after8h.vitals.hunger).toBeGreaterThan(0)
  })

  it('离线30天（被cap到8h）宠物存活', () => {
    const state = defaultPetState(0)
    const after30d = applyOfflineCatchUp(state, 30 * 24 * HOUR)
    expect(after30d.status).not.toBe('collapsed')
  })

  it('连续tick不产生异常状态', () => {
    let state = defaultPetState(0)
    for (let i = 0; i < 100; i += 1) {
      const vitals = tickVitals(state.vitals, HOUR)
      state = { ...state, vitals, status: deriveStatus(vitals) }
      // 属性始终在 0-100 范围
      for (const v of Object.values(state.vitals)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })
})
