/**
 * 桌面宠物 —— 成长系统（M5）。
 *
 * 三阶段：蛋(Egg) → 幼年(Kid) → 成年(Adult)，加性别(GG/MM) + 等级(0-7+) + 经验。
 * 全部纯函数。时长用可调常量（蛋孵化~30min墙钟，幼→成~7天），后续按体验调。
 *
 * - 蛋阶段：不可交互，只累积孵化进度；满 100 孵化成幼年（随机性别）
 * - 幼年：小体型，活泼，不能打工/婚育
 * - 成年：饲养满 growthSpeed*7天 + 等级≥阈值；可打工(M5后)/婚育(M12)
 * - 经验来自被照料/玩耍/签到；满阈升级，最高等级触发 LevUp
 */
export type PetStage = 'egg' | 'kid' | 'adult'
export type PetGender = 'GG' | 'MM'

export type PetGrowth = {
  stage: PetStage
  stageEnteredAt: number  // ms 时间戳
  gender: PetGender
  level: number           // 0 起，参照 QQ dengji 8 级体系
  exp: number             // 当前等级内经验 0-100
  eggProgress?: number    // 蛋阶段 0-100
}

/** 蛋孵化所需墙钟时间（ms），默认 30 分钟。可被 settings.growthSpeed 缩放。 */
export const EGG_HATCH_DURATION_MS = 30 * 60 * 1000
/** 幼年→成年所需饲养墙钟时间（ms），默认 7 天。 */
export const KID_TO_ADULT_DURATION_MS = 7 * 24 * 60 * 60 * 1000
/** 升级所需经验（每级），升级后 exp 清零。 */
export const EXP_PER_LEVEL = 100
/** 最大等级（满级后 exp 不再涨）。 */
export const MAX_LEVEL = 7
/** 幼年→成年最低等级要求。 */
export const ADULT_MIN_LEVEL = 3

export function defaultGrowth(now: number): PetGrowth {
  return {
    stage: 'egg',
    stageEnteredAt: now,
    gender: Math.random() < 0.5 ? 'GG' : 'MM',
    level: 0,
    exp: 0,
    eggProgress: 0
  }
}

/**
 * 推进蛋孵化进度。elapsedMs 为经过墙钟时间。返回更新后的 growth。
 * growthSpeed 倍率：>1 加速（调试），默认 1。
 */
export function tickEgg(growth: PetGrowth, elapsedMs: number, growthSpeed = 1, now = Date.now()): PetGrowth {
  if (growth.stage !== 'egg') return growth
  // BUG-23 修复：growthSpeed=0 防除零
  const safeSpeed = growthSpeed > 0 ? growthSpeed : 1
  const progressPerMs = 100 / (EGG_HATCH_DURATION_MS / safeSpeed)
  const eggProgress = Math.min(100, (growth.eggProgress ?? 0) + progressPerMs * elapsedMs)
  if (eggProgress >= 100) {
    // BUG-1 修复：用传入 now 而非 Date.now()
    return { ...growth, stage: 'kid', stageEnteredAt: now, eggProgress: 100, level: 0, exp: 0 }
  }
  return { ...growth, eggProgress }
}

/**
 * 检查幼年是否可晋升成年：饲养时长达标 + 等级达标。
 */
export function canAdvanceToAdult(growth: PetGrowth, now: number, growthSpeed = 1): boolean {
  if (growth.stage !== 'kid') return false
  const elapsed = now - growth.stageEnteredAt
  const required = KID_TO_ADULT_DURATION_MS / growthSpeed
  return elapsed >= required && growth.level >= ADULT_MIN_LEVEL
}

/** 执行幼年→成年晋升。 */
export function advanceToAdult(growth: PetGrowth, now: number): PetGrowth {
  if (growth.stage !== 'kid') return growth
  return { ...growth, stage: 'adult', stageEnteredAt: now }
}

/**
 * 增加经验，可能升级。返回 { growth, leveledUp }。
 * 满级后 exp 不再涨。
 */
export function addExp(growth: PetGrowth, amount: number): { growth: PetGrowth; leveledUp: boolean } {
  if (growth.stage === 'egg') return { growth, leveledUp: false }
  if (growth.level >= MAX_LEVEL) return { growth, leveledUp: false }
  let exp = growth.exp + amount
  let level = growth.level
  let leveledUp = false
  while (exp >= EXP_PER_LEVEL && level < MAX_LEVEL) {
    exp -= EXP_PER_LEVEL
    level += 1
    leveledUp = true
  }
  if (level >= MAX_LEVEL) exp = 0
  return { growth: { ...growth, level, exp }, leveledUp }
}

/** 蛋阶段是否可交互（不可）。 */
export function isInteractable(growth: PetGrowth): boolean {
  return growth.stage !== 'egg'
}
