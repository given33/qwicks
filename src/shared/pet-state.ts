/**
 * 桌面宠物 —— 生存状态与衰减/疾病纯函数（M4-T1）。
 *
 * 四属性（饥饿/清洁/健康/心情）随时间衰减，过低触发饥饿/脏/病/濒死。
 * 全部纯函数，可在 Vitest 喂数据验证。衰减曲线参数集中，便于平衡性调整。
 *
 * 设计要点：
 *   - 衰减非线性：接近 0 时减速，避免"刚打开就死了"
 *   - 健康间接受饥饿/清洁驱动；饥饿或脏持续低位 → 健康下降；偶发感染
 *   - collapsed（倒下）= health 归 0，需还魂丹（M4-T9）救活
 *   - 离线补算有 8h 保护上限，避免长期不开机回来发现饿死
 */

export type PetVitals = {
  hunger: number       // 0-100, 100=饱, 随时间↓
  cleanliness: number  // 0-100, 100=干净, 随时间↓
  health: number       // 0-100, 100=健康; 饥饿/脏到阈值↓
  mood: number         // 0-100, 100=开心; 受上述三项加权影响
}

export type PetStatus = 'healthy' | 'hungry' | 'dirty' | 'sick' | 'critical' | 'collapsed'

/** 道具类型 */
export type PetItemType = 'food' | 'bath' | 'medicine' | 'revive' | 'toy'

import { defaultGrowth, type PetGrowth } from './pet-growth'

export type PetItem = {
  id: string
  type: PetItemType
  name: string
  /** 对属性的影响（正数=恢复） */
  effect: Partial<PetVitals>
  /** 商店价格（元宝）；0=非卖品 */
  price: number
}

export type PetState = {
  vitals: PetVitals
  status: PetStatus
  coins: number
  inventory: PetItem[]
  lastTickAt: number       // ISO 时间戳（ms），离线补算用
  lastSignInDate?: string  // YYYY-MM-DD，签到去重
  growth?: PetGrowth // M5 成长（缺省时按蛋初始化）
  /** M7 成就统计（累积行为计数）+ 已解锁成就。store 维护。 */
  stats?: import('./pet-achievements').PetStats
  achievements?: { unlocked: string[]; unlockedAt: Record<string, number> }
  /** M12 婚育状态。 */
  marriage?: import('./pet-marriage').MarriageState
  /** P3 教育+职业状态。 */
  career?: import('./pet-career').CareerState
  /** P4 个性（影响衰减/互动倍率）。孵化时随机分配。 */
  personality?: import('./pet-festivals').Personality
  /** R3 打工冷却：今日打工次数 + 日期（每日重置，上限防经济崩塌） */
  workCountToday?: number
  workDate?: string
  /** R3 连续签到天数（断签归零，不同于累计 signInStreak） */
  signInStreakDays?: number
}

/** 每小时衰减量（按 100 基准）。非线性：低值时衰减减缓。 */
const HUNGER_DECAY_PER_HOUR = 8
const CLEANLINESS_DECAY_PER_HOUR = 5
/** 饥饿/脏低于此阈值时开始掉健康 */
const HEALTH_DROP_THRESHOLD = 30
const HEALTH_DROP_PER_HOUR = 6
/** 心情受三项影响的权重 */
const MOOD_HUNGER_WEIGHT = 0.3
const MOOD_CLEAN_WEIGHT = 0.2
const MOOD_HEALTH_WEIGHT = 0.5

/** 离线补算的墙上时间上限（ms），避免长期不开机饿死 */
export const OFFLINE_CATCH_UP_CAP_MS = 8 * 60 * 60 * 1000 // 8h

/** 默认初始状态（新宠物） */
export function defaultPetState(now: number): PetState {
  return {
    vitals: { hunger: 80, cleanliness: 80, health: 100, mood: 80 },
    status: 'healthy',
    coins: 200,
    inventory: [],
    lastTickAt: now,
    growth: defaultGrowth(now)
  }
}

/**
 * 非线性衰减：低值时减速。
 * 当前值越接近 0，衰减越慢（模拟"快饿昏时代谢降低"）。
 */
function nonLinearDecay(current: number, perHour: number, hours: number): number {
  // 衰减因子：当前值越低，实际衰减越慢（最小到原值的 30%）
  const factor = 0.3 + 0.7 * (current / 100)
  return Math.max(0, current - perHour * factor * hours)
}

/**
 * 推进属性衰减。elapsedMs 为经过的墙钟毫秒。
 * 返回新的 vitals（不改原对象）。
 */
export function tickVitals(vitals: PetVitals, elapsedMs: number): PetVitals {
  const hours = elapsedMs / (1000 * 60 * 60)
  let hunger = nonLinearDecay(vitals.hunger, HUNGER_DECAY_PER_HOUR, hours)
  let cleanliness = nonLinearDecay(vitals.cleanliness, CLEANLINESS_DECAY_PER_HOUR, hours)

  // 健康受饥饿/清洁影响：任一低于阈值则掉健康
  let health = vitals.health
  if (vitals.hunger < HEALTH_DROP_THRESHOLD || vitalityLow(vitals.cleanliness, HEALTH_DROP_THRESHOLD)) {
    health = Math.max(0, health - HEALTH_DROP_PER_HOUR * hours)
  } else {
    // 都还行时缓慢自然恢复
    health = Math.min(100, health + 1 * hours)
  }

  // 心情 = 三项加权
  const mood = Math.min(100, Math.max(0,
    vitals.hunger * MOOD_HUNGER_WEIGHT +
    vitals.cleanliness * MOOD_CLEAN_WEIGHT +
    health * MOOD_HEALTH_WEIGHT
  ))

  // BUG-7 修复：所有输出 clamp 到 [0,100]
  return {
    hunger: clamp(hunger),
    cleanliness: clamp(cleanliness),
    health: clamp(health),
    mood: clamp(mood)
  }
}

function vitalityLow(value: number, threshold: number): boolean {
  return value < threshold
}

/** 根据 vitals 推导当前 status（显示优先级） */
export function deriveStatus(vitals: PetVitals): PetStatus {
  if (vitals.health <= 0) return 'collapsed'
  if (vitals.health < 10) return 'critical'
  if (vitals.health < 30) return 'sick'
  if (vitals.hunger < 30) return 'hungry'
  if (vitals.cleanliness < 30) return 'dirty'
  return 'healthy'
}

/**
 * 离线补算：启动时根据 lastTickAt 与 now 的差值补衰减。
 * 有 OFFLINE_CATCH_UP_CAP_MS 上限保护。
 */
export function applyOfflineCatchUp(state: PetState, now: number): PetState {
  const elapsed = Math.min(Math.max(0, now - state.lastTickAt), OFFLINE_CATCH_UP_CAP_MS)
  if (elapsed <= 0) return { ...state, lastTickAt: now }
  const vitals = tickVitals(state.vitals, elapsed)
  return {
    ...state,
    vitals,
    status: deriveStatus(vitals),
    lastTickAt: now
  }
}

/** 应用道具效果（喂食/洗澡/吃药/还魂丹）。返回新 state。 */
export function applyItemEffect(state: PetState, item: PetItem): PetState {
  const vitals: PetVitals = {
    hunger: clamp(state.vitals.hunger + (item.effect.hunger ?? 0)),
    cleanliness: clamp(state.vitals.cleanliness + (item.effect.cleanliness ?? 0)),
    health: clamp(state.vitals.health + (item.effect.health ?? 0)),
    mood: clamp(state.vitals.mood + (item.effect.mood ?? 0))
  }
  // 还魂丹：collapsed 时强制 health 满血复活
  if (item.type === 'revive' && state.status === 'collapsed') {
    vitals.health = 100
    vitals.hunger = clamp(vitals.hunger + 40)
  }
  return {
    ...state,
    vitals,
    status: deriveStatus(vitals)
  }
}

/** 每日签到：发元宝，去重，连续签到递增奖励。返回 { state, awarded, reward }。 */
export function applySignIn(state: PetState, today: string): { state: PetState; awarded: boolean; reward: number } {
  if (state.lastSignInDate === today) {
    return { state, awarded: false, reward: 0 }
  }
  // R3: 连续签到递增奖励。BUG-14 修复：yesterday 用本地时区
  const yesterday = todayString(new Date(today).getTime() - 86400000)
  const isContinuous = state.lastSignInDate === yesterday
  const newStreak = isContinuous ? (state.signInStreakDays ?? 0) + 1 : 1
  const reward = Math.min(30 + (newStreak - 1) * 5, 100)
  return {
    state: {
      ...state,
      coins: state.coins + reward,
      lastSignInDate: today,
      signInStreakDays: newStreak
    },
    awarded: true,
    reward
  }
}

/** 购买道具：扣元宝加入库存。元宝不足返回原 state。 */
export function buyItem(state: PetState, item: PetItem): PetState {
  if (state.coins < item.price) return state
  return {
    ...state,
    coins: state.coins - item.price,
    inventory: [...state.inventory, item]
  }
}

/** 从库存消耗一个道具（按 id）。库存无则不变。 */
export function consumeItem(state: PetState, itemId: string): { state: PetState; item: PetItem | null } {
  const idx = state.inventory.findIndex((i) => i.id === itemId)
  if (idx === -1) return { state, item: null }
  const item = state.inventory[idx]
  const inventory = [...state.inventory.slice(0, idx), ...state.inventory.slice(idx + 1)]
  return { state: { ...state, inventory }, item }
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v))
}

/** 取今天日期字符串 YYYY-MM-DD（BUG-14 修复：用本地时区而非 UTC） */
export function todayString(now: number = Date.now()): string {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
