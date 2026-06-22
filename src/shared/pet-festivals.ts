/**
 * 桌面宠物 —— 节日彩蛋 + 个性系统（P4）。
 *
 * 节日彩蛋：按日期检测节日，触发专属装扮/台词/特效。
 * 个性系统：每只宠物有个性倾向（活泼/内向/吃货/学霸/睡神…），
 * 影响行为权重、对话风格、对互动的反应。
 */

/** 节日定义。dateRange 用 MM-DD 或 MM-DD~MM-DD 区间。 */
export type Festival = {
  id: string
  name: string
  dateRange: string  // "MM-DD" 或 "MM-DD~MM-DD"
  emoji: string
  /** 节日专属台词 */
  greetings: string[]
  /** 节日特效色（环境粒子染色） */
  themeColor?: string
}

export const FESTIVALS: Festival[] = [
  { id: 'newyear', name: '元旦', dateRange: '01-01', emoji: '🎉', greetings: ['新年快乐！新的一年也要一起哦~'] },
  { id: 'spring', name: '春节', dateRange: '01-20~02-20', emoji: '🧧', greetings: ['过年啦！恭喜发财，红包拿来~', '新年好！我穿了新衣服哦~'], themeColor: '#ff5555' },
  { id: 'valentine', name: '情人节', dateRange: '02-14', emoji: '💘', greetings: ['情人节快乐~要永远在一起哦！'], themeColor: '#ff88aa' },
  { id: 'april-fool', name: '愚人节', dateRange: '04-01', emoji: '🤡', greetings: ['嘿嘿，骗你的啦~', '今天说什么都不能信哦~'] },
  { id: 'children', name: '儿童节', dateRange: '06-01', emoji: '🧸', greetings: ['儿童节快乐！我也是个宝宝~'] },
  { id: 'mid-autumn', name: '中秋节', dateRange: '09-10~09-25', emoji: '🥮', greetings: ['中秋快乐！一起吃月饼~'], themeColor: '#ffcc66' },
  { id: 'halloween', name: '万圣节', dateRange: '10-25~11-01', emoji: '🎃', greetings: ['不给糖就捣蛋！', '嘿嘿嘿~不给糖捣蛋咯~'], themeColor: '#ff7733' },
  { id: 'christmas', name: '圣诞节', dateRange: '12-20~12-26', emoji: '🎄', greetings: ['圣诞快乐！有我的礼物吗~', '叮叮当~圣诞快乐！'], themeColor: '#33aa55' },
  { id: 'newyear-eve', name: '除夕', dateRange: '12-31', emoji: '🎆', greetings: ['辞旧迎新！明年也要照顾我哦~'] }
]

/** 检测某日期是否在节日范围内。 */
export function getActiveFestival(date: Date): Festival | null {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  for (const f of FESTIVALS) {
    if (f.dateRange.includes('~')) {
      const [start, end] = f.dateRange.split('~')
      if (mmdd >= start && mmdd <= end) return f
    } else if (mmdd === f.dateRange) {
      return f
    }
  }
  return null
}

/** 随机一句节日台词。 */
export function festivalGreeting(festival: Festival, random: () => number = Math.random): string {
  return festival.greetings[Math.floor(random() * festival.greetings.length)] ?? festival.greetings[0] ?? ''
}

// ===== 个性系统 =====

export type Personality =
  | 'lively'    // 活泼：行为频率高，爱玩
  | 'shy'       // 内向：行为频率低，安静
  | 'foodie'    // 吃货：饥饿衰减快，喂食心情加成大
  | 'scholar'   // 学霸：学习效率高
  | 'sleeper'   // 睡神：爱睡觉，恢复快
  | 'rebel'     // 叛逆：互动心情加成小，偶尔捣蛋
  | 'gentle'    // 温柔：心情恢复快，被摸加成大

export const PERSONALITIES: { id: Personality; name: string; desc: string; emoji: string }[] = [
  { id: 'lively', name: '活泼', desc: '爱玩爱闹，行为频繁', emoji: '⚡' },
  { id: 'shy', name: '内向', desc: '安安静静，行为较少', emoji: '🌸' },
  { id: 'foodie', name: '吃货', desc: '容易饿，但吃东西最开心', emoji: '🍴' },
  { id: 'scholar', name: '学霸', desc: '学习效率高', emoji: '📚' },
  { id: 'sleeper', name: '睡神', desc: '爱睡觉，恢复快', emoji: '😴' },
  { id: 'rebel', name: '叛逆', desc: '有点小脾气，偶尔捣蛋', emoji: '😈' },
  { id: 'gentle', name: '温柔', desc: '温柔乖巧，被摸超开心', emoji: '💛' }
]

/** 个性对游戏参数的修饰。 */
export type PersonalityMods = {
  /** 行为触发间隔倍率（<1 更频繁） */
  activityMultiplier: number
  /** 饥饿衰减倍率（>1 更快饿） */
  hungerDecayMultiplier: number
  /** 喂食心情加成倍率 */
  feedMoodMultiplier: number
  /** 学习属性加成倍率 */
  studyMultiplier: number
  /** 摸头心情加成倍率 */
  petMoodMultiplier: number
}

export function personalityMods(p: Personality): PersonalityMods {
  switch (p) {
    case 'lively': return { activityMultiplier: 0.6, hungerDecayMultiplier: 1.2, feedMoodMultiplier: 1, studyMultiplier: 1, petMoodMultiplier: 1.2 }
    case 'shy': return { activityMultiplier: 1.6, hungerDecayMultiplier: 0.9, feedMoodMultiplier: 1, studyMultiplier: 1.1, petMoodMultiplier: 0.8 }
    case 'foodie': return { activityMultiplier: 1, hungerDecayMultiplier: 1.5, feedMoodMultiplier: 1.8, studyMultiplier: 0.9, petMoodMultiplier: 1 }
    case 'scholar': return { activityMultiplier: 1.1, hungerDecayMultiplier: 1, feedMoodMultiplier: 1, studyMultiplier: 1.5, petMoodMultiplier: 1 }
    case 'sleeper': return { activityMultiplier: 1.3, hungerDecayMultiplier: 0.8, feedMoodMultiplier: 1, studyMultiplier: 1, petMoodMultiplier: 1 }
    case 'rebel': return { activityMultiplier: 0.8, hungerDecayMultiplier: 1.1, feedMoodMultiplier: 0.9, studyMultiplier: 0.8, petMoodMultiplier: 0.7 }
    case 'gentle': return { activityMultiplier: 1, hungerDecayMultiplier: 0.9, feedMoodMultiplier: 1.2, studyMultiplier: 1, petMoodMultiplier: 1.6 }
  }
}

/** 随机分配个性（新宠物孵化时）。 */
export function rollPersonality(random: () => number = Math.random): Personality {
  const ids = PERSONALITIES.map((p) => p.id)
  return ids[Math.floor(random() * ids.length)] ?? 'lively'
}
