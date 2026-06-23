/**
 * 桌面宠物 —— 成就系统（M7）。
 *
 * Steam 式成就：达成全屏弹窗。纯函数定义 + 触发检测。
 * 分类：成长 / 照料 / 生存 / 玩耍 / 收集。
 *
 * 成就触发依赖"事件计数器"（pet 累积行为统计），由 store 维护，检测时传入。
 */
export type AchievementCategory = 'growth' | 'care' | 'survival' | 'play' | 'collection'

export type PetAchievement = {
  id: string
  category: AchievementCategory
  name: string
  desc: string
  /** 隐藏成就：未解锁时显示 ??? */
  hidden?: boolean
}

/** 事件计数器：记录宠物累积行为，成就检测依据。 */
export type PetStats = {
  feedCount: number
  bathCount: number
  cureCount: number
  petCount: number
  playCount: number
  signInStreak: number
  activitiesExperienced: number
  itemsOwned: number
  revivedCount: number
  maxLevel: number
  reachedAdult: boolean
  collapsedCount: number
}

export const PET_ACHIEVEMENTS: PetAchievement[] = [
  // 成长类
  { id: 'first-hatch', category: 'growth', name: '破壳而出', desc: '宠物成功孵化' },
  { id: 'become-kid', category: 'growth', name: '初长成', desc: '宠物成长为幼年' },
  { id: 'become-adult', category: 'growth', name: '成年礼', desc: '宠物成年' },
  { id: 'level-3', category: 'growth', name: '小有所成', desc: '达到 3 级' },
  { id: 'level-7', category: 'growth', name: '满级达人', desc: '达到满级 7 级', hidden: true },

  // 照料类
  { id: 'feed-10', category: 'care', name: '初级饲养员', desc: '累计喂食 10 次' },
  { id: 'feed-100', category: 'care', name: '美食家', desc: '累计喂食 100 次' },
  { id: 'bath-10', category: 'care', name: '爱干净', desc: '累计洗澡 10 次' },
  { id: 'cure-1', category: 'care', name: '妙手回春', desc: '第一次治好宠物' },
  { id: 'sign-in-7', category: 'care', name: '一周不间断', desc: '连续签到 7 天' },
  { id: 'pet-50', category: 'care', name: '摸摸大王', desc: '摸头 50 次' },

  // 生存类
  { id: 'survive-collapse', category: 'survival', name: '劫后余生', desc: '经历濒死并被救活', hidden: true },
  { id: 'revive-master', category: 'survival', name: '还魂大师', desc: '使用还魂丹 3 次', hidden: true },

  // 玩耍类
  { id: 'play-10', category: 'play', name: '玩伴', desc: '陪玩 10 次' },
  { id: 'activities-20', category: 'play', name: '见多识广', desc: '体验 20 种不同行为' },
  { id: 'activities-all', category: 'play', name: '全行为收藏家', desc: '体验全部行为', hidden: true },

  // 收集类
  { id: 'items-10', category: 'collection', name: '小有积蓄', desc: '累计拥有 10 件道具' },
  { id: 'rich-500', category: 'collection', name: '小富翁', desc: '元宝达到 500' }
]

export type AchievementCheckResult = {
  /** 这次检测新解锁的成就 id */
  newlyUnlocked: string[]
}

/**
 * 检测当前 stats 下应解锁的成就，返回尚未解锁（alreadyUnlocked 之外）的合格成就。
 * 调用方据此记录新解锁 + 触发弹窗。
 */
export function checkAchievements(stats: PetStats, alreadyUnlocked: string[], coins?: number): AchievementCheckResult {
  const unlocked = new Set(alreadyUnlocked)
  const newlyUnlocked: string[] = []

  const conditions: Record<string, boolean> = {
    'first-hatch': stats.feedCount > 0 || stats.playCount > 0 || stats.reachedAdult, // 被照料过=已孵化
    'become-kid': stats.playCount > 0 || stats.feedCount > 0 || stats.reachedAdult,
    'become-adult': stats.reachedAdult,
    'level-3': stats.maxLevel >= 3,
    'level-7': stats.maxLevel >= 7,
    'feed-10': stats.feedCount >= 10,
    'feed-100': stats.feedCount >= 100,
    'bath-10': stats.bathCount >= 10,
    'cure-1': stats.cureCount >= 1,
    'sign-in-7': stats.signInStreak >= 7,
    'pet-50': stats.petCount >= 50,
    'survive-collapse': stats.revivedCount >= 1,
    'revive-master': stats.revivedCount >= 3,
    'play-10': stats.playCount >= 10,
    'activities-20': stats.activitiesExperienced >= 20,
    'activities-all': stats.activitiesExperienced >= 43,
    'items-10': stats.itemsOwned >= 10,
    'rich-500': (coins ?? 0) >= 500 // BUG-11 修复：接 coins 判定
  }

  for (const ach of PET_ACHIEVEMENTS) {
    if (unlocked.has(ach.id)) continue
    if (conditions[ach.id]) {
      newlyUnlocked.push(ach.id)
      unlocked.add(ach.id)
    }
  }

  return { newlyUnlocked }
}

/** 查成就定义。 */
export function findAchievement(id: string): PetAchievement | undefined {
  return PET_ACHIEVEMENTS.find((a) => a.id === id)
}

/** 默认统计（新宠物）。 */
export function defaultStats(): PetStats {
  return {
    feedCount: 0,
    bathCount: 0,
    cureCount: 0,
    petCount: 0,
    playCount: 0,
    signInStreak: 0,
    activitiesExperienced: 0,
    itemsOwned: 0,
    revivedCount: 0,
    maxLevel: 0,
    reachedAdult: false,
    collapsedCount: 0
  }
}
