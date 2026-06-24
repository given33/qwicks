/**
 * 桌面宠物 —— 场景行为库（M6）。
 *
 * 可扩展行为库：每个行为 = 暖黄姿态 + 道具/表情 + 时长 + 经验 + 日志文案。
 * 新增行为 = 往 PET_ACTIVITIES 加一项，不改逻辑。
 * 执行器在 PetStage 的 idle 分支随机触发（持续 duration，用对应姿态+表情）。
 * 第二批（爬山/游泳/滑雪等专用帧）预留，待资产到位加入。
 */
import type { PetPose } from './pet-sprite-atlas'

export type PetActivity = {
  id: string
  name: string
  /** 使用的暖黄姿态 */
  pose: PetPose
  /** 头顶飘的表情符号（程序化，无需专用帧） */
  emoji?: string
  /** 持续时长 ms */
  duration: number
  /** 完成后给的经验 */
  expBoost: number
  /** 心情加成 */
  moodBoost: number
  /** 档案日志文案 */
  logText: string
  /** 触发权重（越大越常见） */
  weight: number
  /** 最低阶段要求（egg 不可有行为） */
  minStage?: 'kid' | 'adult'
}

/** 首批 40+ 行为（现有帧 + 程序化表情能做的）。 */
export const PET_ACTIVITIES: PetActivity[] = [
  // 静态休闲类
  { id: 'read', name: '看书', pose: 'sit', emoji: '📖', duration: 8000, expBoost: 5, moodBoost: 8, logText: '在看一本有趣的书', weight: 10, minStage: 'kid' },
  { id: 'surf-web', name: '上网', pose: 'sit', emoji: '💻', duration: 7000, expBoost: 3, moodBoost: 6, logText: '在网上冲浪', weight: 8, minStage: 'kid' },
  { id: 'sleep-nap', name: '打盹', pose: 'sleep', emoji: '💤', duration: 10000, expBoost: 2, moodBoost: 10, logText: '打了个盹', weight: 9, minStage: 'kid' },
  { id: 'daze', name: '发呆', pose: 'think', emoji: '…', duration: 5000, expBoost: 1, moodBoost: 2, logText: '在发呆', weight: 7 },
  { id: 'daydream', name: '做白日梦', pose: 'wonder', emoji: '💭', duration: 7000, expBoost: 2, moodBoost: 5, logText: '在做白日梦', weight: 6, minStage: 'kid' },
  { id: 'stretch', name: '伸懒腰', pose: 'stand', emoji: '🙆', duration: 3000, expBoost: 2, moodBoost: 4, logText: '伸了个懒腰', weight: 6 },
  { id: 'yawn', name: '打哈欠', pose: 'talk', emoji: '🥱', duration: 2500, expBoost: 1, moodBoost: 2, logText: '打了个哈欠', weight: 5 },
  { id: 'look-around', name: '左顾右盼', pose: 'wonder', duration: 4000, expBoost: 2, moodBoost: 3, logText: '好奇地左顾右盼', weight: 6 },
  { id: 'sunbathe', name: '晒太阳', pose: 'sit', emoji: '☀️', duration: 8000, expBoost: 3, moodBoost: 9, logText: '在惬意地晒太阳', weight: 7, minStage: 'kid' },

  // 活泼动作类
  { id: 'hum', name: '哼歌', pose: 'stand', emoji: '🎵', duration: 5000, expBoost: 4, moodBoost: 10, logText: '在哼小曲', weight: 7, minStage: 'kid' },
  { id: 'dance', name: '跳舞', pose: 'stand', emoji: '💃', duration: 6000, expBoost: 8, moodBoost: 15, logText: '开心地跳起舞来', weight: 6, minStage: 'kid' },
  { id: 'count-stars', name: '数星星', pose: 'wonder', emoji: '⭐', duration: 7000, expBoost: 5, moodBoost: 8, logText: '在数星星', weight: 5, minStage: 'kid' },
  { id: 'count-sheep', name: '数绵羊', pose: 'sleep', emoji: '🐑', duration: 8000, expBoost: 4, moodBoost: 7, logText: '在数绵羊入睡', weight: 5, minStage: 'kid' },
  { id: 'yarn-ball', name: '玩毛线球', pose: 'sit', emoji: '🧶', duration: 6000, expBoost: 6, moodBoost: 12, logText: '在玩毛线球', weight: 6, minStage: 'kid' },
  { id: 'blocks', name: '堆积木', pose: 'sit', emoji: '🧱', duration: 7000, expBoost: 7, moodBoost: 10, logText: '在堆积木', weight: 5, minStage: 'kid' },
  { id: 'draw', name: '画画', pose: 'sit', emoji: '🎨', duration: 8000, expBoost: 8, moodBoost: 12, logText: '在认真画画', weight: 5, minStage: 'kid' },
  { id: 'diary', name: '写日记', pose: 'sit', emoji: '✏️', duration: 7000, expBoost: 6, moodBoost: 8, logText: '在写日记', weight: 4, minStage: 'kid' },
  { id: 'clean-window', name: '擦窗户', pose: 'stand', emoji: '🪟', duration: 5000, expBoost: 5, moodBoost: 6, logText: '在擦窗户', weight: 4, minStage: 'kid' },
  { id: 'water-flowers', name: '浇花', pose: 'stand', emoji: '💧', duration: 5000, expBoost: 5, moodBoost: 7, logText: '在浇花', weight: 4, minStage: 'kid' },
  { id: 'look-outside', name: '看窗外', pose: 'wonder', emoji: '🌅', duration: 6000, expBoost: 3, moodBoost: 5, logText: '在眺望窗外', weight: 5 },

  // 社交/表情类
  { id: 'wave-hi', name: '挥手打招呼', pose: 'wave', emoji: '👋', duration: 3000, expBoost: 3, moodBoost: 8, logText: '热情地挥了挥手', weight: 7 },
  { id: 'clap', name: '鼓掌', pose: 'wave', emoji: '👏', duration: 3000, expBoost: 4, moodBoost: 12, logText: '开心地鼓掌', weight: 5, minStage: 'kid' },
  { id: 'jump', name: '蹦跳', pose: 'stand', emoji: '🤸', duration: 4000, expBoost: 7, moodBoost: 14, logText: '欢快地蹦蹦跳跳', weight: 6, minStage: 'kid' },
  { id: 'spin', name: '转圈', pose: 'stand', emoji: '🌀', duration: 4000, expBoost: 6, moodBoost: 12, logText: '在原地转圈', weight: 5, minStage: 'kid' },
  { id: 'slide-step', name: '滑步', pose: 'walk', emoji: '🕺', duration: 4000, expBoost: 6, moodBoost: 11, logText: '炫了个滑步', weight: 4, minStage: 'kid' },

  // 日常类
  { id: 'snack-time', name: '吃零食', pose: 'sit', emoji: '🍪', duration: 4000, expBoost: 3, moodBoost: 10, logText: '偷吃了点零食', weight: 6, minStage: 'kid' },
  { id: 'mirror', name: '照镜子', pose: 'stand', emoji: '🪞', duration: 4000, expBoost: 2, moodBoost: 6, logText: '在照镜子整理仪容', weight: 4, minStage: 'kid' },
  { id: 'groom', name: '梳毛', pose: 'sit', emoji: '💆', duration: 5000, expBoost: 4, moodBoost: 8, logText: '在认真梳毛', weight: 5, minStage: 'kid' },
  { id: 'whistle', name: '吹口哨', pose: 'stand', emoji: '😙', duration: 4000, expBoost: 3, moodBoost: 9, logText: '在吹口哨', weight: 4, minStage: 'kid' },
  { id: 'leg-cross', name: '跷二郎腿', pose: 'sit', duration: 5000, expBoost: 2, moodBoost: 5, logText: '悠闲地跷起二郎腿', weight: 4 },
  { id: 'lie-down', name: '趴着', pose: 'sad', duration: 5000, expBoost: 1, moodBoost: 3, logText: '趴着休息', weight: 4 },
  { id: 'roll', name: '打滚', pose: 'stand', emoji: '🤣', duration: 4000, expBoost: 6, moodBoost: 13, logText: '在地上打滚', weight: 5, minStage: 'kid' },
  { id: 'hide-seek', name: '捉迷藏', pose: 'wonder', emoji: '🙈', duration: 4000, expBoost: 5, moodBoost: 10, logText: '玩起了捉迷藏', weight: 4, minStage: 'kid' },
  { id: 'peek', name: '偷看', pose: 'wonder', emoji: '👀', duration: 3000, expBoost: 2, moodBoost: 5, logText: '偷偷瞄了一眼', weight: 4 },
  { id: 'surprised', name: '惊讶', pose: 'talk', emoji: '😲', duration: 2500, expBoost: 1, moodBoost: 4, logText: '被吓了一跳', weight: 3 },
  { id: 'sigh', name: '叹气', pose: 'sad', emoji: '😮‍💨', duration: 2500, expBoost: 1, moodBoost: 2, logText: '叹了口气', weight: 3 },
  { id: 'nod', name: '点头', pose: 'stand', emoji: '👌', duration: 2500, expBoost: 2, moodBoost: 4, logText: '若有所思地点了点头', weight: 3 },
  { id: 'shake-head', name: '摇头', pose: 'stand', emoji: '🙅', duration: 2500, expBoost: 2, moodBoost: 3, logText: '摇了摇头', weight: 3 },
  { id: 'wave-bye', name: '挥手告别', pose: 'wave', emoji: '👋', duration: 3000, expBoost: 2, moodBoost: 5, logText: '挥挥手像在告别', weight: 3 },
  { id: 'think-hard', name: '苦思冥想', pose: 'think', emoji: '🤔', duration: 6000, expBoost: 5, moodBoost: 4, logText: '在苦思冥想', weight: 4, minStage: 'kid' },
  { id: 'sing', name: '唱歌', pose: 'wave', emoji: '🎤', duration: 6000, expBoost: 8, moodBoost: 14, logText: '引吭高歌', weight: 5, minStage: 'kid' },
  { id: 'pray', name: '祈祷', pose: 'sit', emoji: '🙏', duration: 4000, expBoost: 4, moodBoost: 7, logText: '双手合十祈祷', weight: 3, minStage: 'kid' },
  { id: 'stretch-legs', name: '活动筋骨', pose: 'stand', emoji: '🤾', duration: 4000, expBoost: 5, moodBoost: 8, logText: '在活动筋骨', weight: 5, minStage: 'kid' },
  { id: 'blow-kiss', name: '飞吻', pose: 'wave', emoji: '😘', duration: 2500, expBoost: 3, moodBoost: 10, logText: '送出一个飞吻', weight: 4, minStage: 'kid' }
]

export type ActivityStageFilter = 'egg' | 'kid' | 'adult'

/**
 * 按阶段过滤 + 权重随机选一个行为。蛋阶段返回 null（不活动）。
 * 注入 random 便于测试。
 */
export function pickActivity(
  stage: ActivityStageFilter,
  random: () => number = Math.random
): PetActivity | null {
  if (stage === 'egg') return null
  const eligible = PET_ACTIVITIES.filter((a) => {
    if (!a.minStage) return true
    if (a.minStage === 'kid') return stage === 'kid' || stage === 'adult'
    return stage === 'adult'
  })
  if (eligible.length === 0) return null
  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0)
  let r = random() * totalWeight
  for (const a of eligible) {
    r -= a.weight
    if (r <= 0) return a
  }
  return eligible[eligible.length - 1] ?? null
}

// ===== 情绪态驱动行为池（Round 2 新玩法，学习 QQ 5 大情绪态）=====

export type ActivityMood = 'happy' | 'neutral' | 'sad' | 'sick'

/** 行为 id → 适合的情绪态集合。sad 时只做安静行为，happy 时偏好活泼行为。 */
const ACTIVITY_MOOD_MAP: Record<string, ActivityMood[]> = {
  // happy 偏好：活泼/兴奋类
  dance: ['happy'], jump: ['happy'], spin: ['happy'], sing: ['happy', 'neutral'],
  clap: ['happy', 'neutral'], 'slide-step': ['happy', 'neutral'], roll: ['happy', 'neutral'],
  hum: ['happy', 'neutral'],
  // neutral 通用：日常行为
  read: ['neutral', 'happy'], 'surf-web': ['neutral', 'happy'], 'look-around': ['neutral'],
  stretch: ['neutral'], whistle: ['neutral', 'happy'], 'leg-cross': ['neutral'],
  'clean-window': ['neutral'], 'water-flowers': ['neutral'],
  'wave-hi': ['neutral', 'happy'], 'wave-bye': ['neutral'], nod: ['neutral'],
  'study-together': ['neutral'], mirror: ['neutral', 'happy'], groom: ['neutral', 'happy'],
  'sunbathe': ['neutral', 'happy'], 'snack-time': ['neutral', 'happy'], 'count-stars': ['neutral', 'happy'],
  // sad/sick 偏好：安静/低能量
  'sleep-nap': ['sad', 'sick', 'neutral'], daze: ['sad', 'neutral'], 'lie-down': ['sad', 'sick'],
  sigh: ['sad'], daydream: ['sad', 'neutral'], yawn: ['sad', 'sick', 'neutral'],
  'count-sheep': ['sad', 'sick'], 'think-hard': ['neutral', 'sad'],
  // sick 专属
  'look-outside': ['neutral', 'sad'],
  // 通用
  'draw': ['neutral', 'happy'], diary: ['neutral'], blocks: ['neutral', 'happy'],
  'yarn-ball': ['happy', 'neutral'], peek: ['neutral'], surprised: ['neutral'],
  'shake-head': ['sad', 'neutral'], pray: ['neutral', 'sad'], 'stretch-legs': ['neutral'],
  hide: ['neutral', 'sad'], tease: ['happy'], 'blow-kiss': ['happy', 'neutral']
}

/** 根据情绪态过滤行为池再按权重选择。让宠物"看心情做事"。 */
export function pickActivityByMood(
  stage: ActivityStageFilter,
  mood: ActivityMood,
  random: () => number = Math.random
): PetActivity | null {
  if (stage === 'egg') return null
  const eligible = PET_ACTIVITIES.filter((a) => {
    // 阶段过滤（egg 已在函数开头 return null，此处 stage 只能是 kid/adult）
    if (a.minStage === 'adult' && stage !== 'adult') return false
    // 情绪过滤：没映射的默认 neutral 通用
    const moods = ACTIVITY_MOOD_MAP[a.id] ?? ['neutral']
    return moods.includes(mood)
  })
  if (eligible.length === 0) return pickActivity(stage, random) // 兜底
  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0)
  let r = random() * totalWeight
  for (const a of eligible) {
    r -= a.weight
    if (r <= 0) return a
  }
  return eligible[eligible.length - 1] ?? null
}

/** 校验行为库完整性（每项必有 pose/expBoost/logText）。测试用。 */
export function validateActivities(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const a of PET_ACTIVITIES) {
    if (ids.has(a.id)) errors.push(`duplicate id: ${a.id}`)
    ids.add(a.id)
    if (typeof a.expBoost !== 'number') errors.push(`${a.id}: missing expBoost`)
    if (typeof a.logText !== 'string' || a.logText.length === 0) errors.push(`${a.id}: missing logText`)
  }
  return errors
}
