/**
 * 成就追踪（M7 主进程侧）。
 *
 * 各照料/玩耍/行为动作后调用 recordAction 更新 stats + 检测新成就。
 * 新成就广播 pet:achievement-unlocked，渲染层弹窗。
 */
import { checkAchievements, defaultStats, type PetStats } from '../shared/pet-achievements'

// 用结构化类型避免和 PetState 强耦合（只用到 stats/achievements 两个字段）
type PetStateLike = {
  stats?: PetStats
  achievements?: { unlocked: string[]; unlockedAt: Record<string, number> }
  coins?: number
  signInStreakDays?: number
}

export type PetAction =
  | 'feed' | 'bath' | 'cure' | 'pet' | 'play' | 'signIn'
  | 'revive' | 'collapse' | 'activity' | 'buy' | 'tickle' | 'reward'

/** 给 state 的 stats 计数 +1，返回新 stats。 */
export function bumpStat(stats: PetStats | undefined, action: PetAction): PetStats {
  const s = { ...(stats ?? defaultStats()) }
  switch (action) {
    case 'feed': s.feedCount += 1; break
    case 'bath': s.bathCount += 1; break
    case 'cure': s.cureCount += 1; break
    case 'pet': s.petCount += 1; break
    case 'play': s.playCount += 1; break
    case 'signIn': s.signInStreak += 1; break
    case 'revive': s.revivedCount += 1; break
    case 'collapse': s.collapsedCount += 1; break
    case 'activity': s.activitiesExperienced += 1; break
    case 'buy': s.itemsOwned += 1; break
    case 'tickle': s.playCount += 1; break
    case 'reward': break
  }
  return s
}

/**
 * 记录一次动作：更新 stats + 检测成就。
 * 返回 { state, newlyUnlocked }。调用方据此广播。
 */
export function recordAction(
  state: PetStateLike,
  action: PetAction,
  now: number = Date.now()
): { state: PetStateLike; newlyUnlocked: string[] } {
  const stats = bumpStat(state.stats, action)
  // BUG-10 修复：signIn 时同步 signInStreak = signInStreakDays（真连续天数）
  if (action === 'signIn' && state.signInStreakDays !== undefined) {
    stats.signInStreak = state.signInStreakDays
  }
  const unlocked = state.achievements?.unlocked ?? []
  // BUG-11 修复：传 coins 让 rich-500 可判定
  const { newlyUnlocked } = checkAchievements(stats, unlocked, state.coins)
  const allUnlocked = [...unlocked, ...newlyUnlocked]
  const unlockedAt = { ...(state.achievements?.unlockedAt ?? {}) }
  for (const id of newlyUnlocked) unlockedAt[id] = now
  return {
    state: {
      ...state,
      stats,
      achievements: { unlocked: allUnlocked, unlockedAt }
    },
    newlyUnlocked
  }
}
