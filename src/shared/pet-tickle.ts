/**
 * 桌面宠物 —— Tickle 互动系统（扩展版，30+ 种，分 6 类）。
 *
 * 参考 QQ TickleActionType 并大幅扩展。6 大类：
 *   温柔系（摸/抱/拍/揉） / 调皮系（戳/挠/吓/逗） / 逗乐系（唱歌/跳舞/讲笑话）
 *   肢体系（握手/击掌/转圈/举高高） / 道具系（玩球/羽毛/激光笔/镜子） / 陪伴系（陪伴/看剧/一起睡）
 * 每种独特：表情 + 数值 + 文案 + 概率性特殊反应。
 */

export type TickleType =
  // 温柔系
  | 'pet' | 'hug' | 'pat' | 'stroke' | 'cuddle' | 'kiss'
  // 调皮系
  | 'poke' | 'tickle' | 'tease' | 'scare' | 'pinch' | 'blow' | 'imitate'
  // 逗乐系
  | 'amuse' | 'sing' | 'dance' | 'joke' | 'magic' | 'story'
  // 肢体系
  | 'handshake' | 'highfive' | 'spin' | 'liftup' | 'fistbump'
  // 道具系
  | 'ball' | 'feather' | 'laser' | 'mirror' | 'balloon' | 'soap-bubble'
  // 陪伴系
  | 'company' | 'watchtv' | 'study-together' | 'sleep-together' | 'walk'

export type TickleReaction = {
  expression: string
  moodDelta: number
  hungerDelta?: number
  text: string
  floatText: string
  special?: { chance: number; expression: string; text: string; floatText: string }
}

export const TICKLE_REACTIONS: Record<TickleType, TickleReaction> = {
  // ===== 温柔系 =====
  pet: { expression: 'content', moodDelta: 5, text: '被温柔地摸了摸头，享受地眯起眼', floatText: '+心情' },
  hug: { expression: 'love', moodDelta: 15, text: '被紧紧拥抱，满满的幸福感', floatText: '❤️' },
  pat: { expression: 'content', moodDelta: 4, text: '被轻轻拍了拍，乖乖的', floatText: '🐾' },
  stroke: { expression: 'shy', moodDelta: 7, text: '被顺毛抚摸，舒服得直哼哼', floatText: '～',
    special: { chance: 0.25, expression: 'content', text: '舒服到睡着了', floatText: '💤' } },
  cuddle: { expression: 'love', moodDelta: 12, text: '被抱在怀里蹭蹭，心都要化了', floatText: '💕' },
  kiss: { expression: 'shy', moodDelta: 18, text: '被亲了一口，脸红成苹果', floatText: '///',
    special: { chance: 0.2, expression: 'embarrassed', text: '害羞得躲起来了', floatText: '＞﹏＜' } },

  // ===== 调皮系 =====
  poke: { expression: 'surprised', moodDelta: 2, text: '被戳了一下，吓一跳', floatText: '？！',
    special: { chance: 0.15, expression: 'angry', text: '被戳烦了，生气了', floatText: '哼！' } },
  tickle: { expression: 'excited', moodDelta: 12, text: '被挠痒痒，笑得停不下来', floatText: '哈哈哈' },
  tease: { expression: 'naughty', moodDelta: 3, text: '被挑逗了，调皮地回应', floatText: '哼哼',
    special: { chance: 0.2, expression: 'embarrassed', text: '被挑逗得害羞了', floatText: '...' } },
  scare: { expression: 'scared', moodDelta: -3, text: '被吓了一跳，心砰砰跳', floatText: '！！',
    special: { chance: 0.25, expression: 'angry', text: '被吓后生气了，不理你', floatText: '哼！' } },
  pinch: { expression: 'surprised', moodDelta: -1, text: '被轻轻掐了一下脸蛋', floatText: '哎！',
    special: { chance: 0.2, expression: 'shy', text: '被掐得脸更红了', floatText: '//' } },
  blow: { expression: 'surprised', moodDelta: 4, text: '被吹了一脸气，头发都飞起来', floatText: '呼～' },
  imitate: { expression: 'naughty', moodDelta: 6, text: '看你模仿它，它也学你的样子', floatText: '学！',
    special: { chance: 0.3, expression: 'smug', text: '学得比你还像，得意极了', floatText: '嘿嘿' } },

  // ===== 逗乐系 =====
  amuse: { expression: 'happy', moodDelta: 8, text: '被逗乐了，开怀大笑', floatText: '哈哈' },
  sing: { expression: 'content', moodDelta: 9, text: '听着你唱歌，陶醉地晃起来', floatText: '🎵' },
  dance: { expression: 'excited', moodDelta: 14, text: '拉着你一起跳舞，开心到飞起', floatText: '💃',
    special: { chance: 0.15, expression: 'dizzy', text: '转太多圈晕了', floatText: '💫' } },
  joke: { expression: 'happy', moodDelta: 10, text: '听了你的笑话，笑得前仰后合', floatText: '哈哈哈' },
  magic: { expression: 'curious', moodDelta: 11, text: '看你的魔术，眼睛瞪得圆圆的', floatText: '哇！',
    special: { chance: 0.2, expression: 'sparkle', text: '被魔术惊呆了，眼睛闪闪发光', floatText: '✨' } },
  story: { expression: 'curious', moodDelta: 8, text: '听你讲故事，听得入迷', floatText: '...' },

  // ===== 肢体系 =====
  handshake: { expression: 'proud', moodDelta: 6, text: '乖乖握了手，很有礼貌', floatText: '🤝' },
  highfive: { expression: 'excited', moodDelta: 9, text: '和你击掌，啪一声超响', floatText: '✋' },
  spin: { expression: 'playful', moodDelta: 11, text: '被举起来转圈圈，咯咯笑', floatText: '🤸',
    special: { chance: 0.2, expression: 'dizzy', text: '转晕了，走路打晃', floatText: '💫' } },
  liftup: { expression: 'scared', moodDelta: 3, text: '被举高高，又怕又兴奋', floatText: '哇啊',
    special: { chance: 0.3, expression: 'excited', text: '举高高太好玩了，还要', floatText: '还要！' } },
  fistbump: { expression: 'smug', moodDelta: 8, text: '和你碰拳，酷酷的', floatText: '👊' },

  // ===== 道具系 =====
  ball: { expression: 'playful', moodDelta: 10, hungerDelta: -3, text: '开心地追着球跑', floatText: '🎾' },
  feather: { expression: 'curious', moodDelta: 7, text: '好奇地扑腾羽毛', floatText: '🪶' },
  laser: { expression: 'excited', moodDelta: 13, hungerDelta: -4, text: '疯狂追逐激光点，停不下来', floatText: '🔴',
    special: { chance: 0.2, expression: 'dizzy', text: '追激光追晕了', floatText: '💫' } },
  mirror: { expression: 'shy', moodDelta: 4, text: '看到镜子里的自己，害羞了', floatText: '///',
    special: { chance: 0.3, expression: 'smug', text: '照镜子觉得自己真好看', floatText: '嘿嘿' } },
  balloon: { expression: 'curious', moodDelta: 8, text: '好奇地拍打气球，看它弹来弹去', floatText: '🎈',
    special: { chance: 0.1, expression: 'scared', text: '气球突然爆了，吓哭', floatText: '呜！' } },
  'soap-bubble': { expression: 'sparkle', moodDelta: 9, text: '追着泡泡跑，看它们一个个破掉', floatText: '🫧' },

  // ===== 陪伴系 =====
  company: { expression: 'content', moodDelta: 7, text: '感受到你的陪伴，安心地待在旁边', floatText: '陪伴' },
  watchtv: { expression: 'content', moodDelta: 8, text: '和你一起看剧，看到精彩处拍手', floatText: '📺' },
  'study-together': { expression: 'thinking', moodDelta: 5, text: '陪你一起学习，认真当书童', floatText: '📚' },
  'sleep-together': { expression: 'sleepy', moodDelta: 10, text: '和你一起打盹，幸福地睡着', floatText: '💤' },
  walk: { expression: 'happy', moodDelta: 12, hungerDelta: -5, text: '出门散步啦，到处闻闻看看', floatText: '🚶' }
}

export const TICKLE_TYPES = Object.keys(TICKLE_REACTIONS) as TickleType[]

/** 互动分类（UI 分组用） */
export const TICKLE_CATEGORIES: { name: string; emoji: string; types: TickleType[] }[] = [
  { name: '温柔', emoji: '💛', types: ['pet', 'hug', 'pat', 'stroke', 'cuddle', 'kiss'] },
  { name: '调皮', emoji: '😈', types: ['poke', 'tickle', 'tease', 'scare', 'pinch', 'blow', 'imitate'] },
  { name: '逗乐', emoji: '🎭', types: ['amuse', 'sing', 'dance', 'joke', 'magic', 'story'] },
  { name: '肢体', emoji: '🤸', types: ['handshake', 'highfive', 'spin', 'liftup', 'fistbump'] },
  { name: '道具', emoji: '🎾', types: ['ball', 'feather', 'laser', 'mirror', 'balloon', 'soap-bubble'] },
  { name: '陪伴', emoji: '🌟', types: ['company', 'watchtv', 'study-together', 'sleep-together', 'walk'] }
]

export const TICKLE_LABELS: Record<TickleType, { name: string; emoji: string }> = {
  pet: { name: '摸头', emoji: '🤚' }, hug: { name: '拥抱', emoji: '🤗' },
  pat: { name: '拍拍', emoji: '👋' }, stroke: { name: '顺毛', emoji: '✋' },
  cuddle: { name: '蹭蹭', emoji: '🫂' }, kiss: { name: '亲亲', emoji: '💋' },
  poke: { name: '戳戳', emoji: '👉' }, tickle: { name: '挠痒', emoji: '🤣' },
  tease: { name: '挑逗', emoji: '😏' }, scare: { name: '吓唬', emoji: '😱' },
  pinch: { name: '掐脸', emoji: '🤏' }, blow: { name: '吹气', emoji: '💨' },
  imitate: { name: '模仿', emoji: '🤡' },
  amuse: { name: '逗乐', emoji: '😆' }, sing: { name: '唱歌', emoji: '🎤' },
  dance: { name: '跳舞', emoji: '💃' }, joke: { name: '笑话', emoji: '😂' },
  magic: { name: '魔术', emoji: '🎩' }, story: { name: '故事', emoji: '📖' },
  handshake: { name: '握手', emoji: '🤝' }, highfive: { name: '击掌', emoji: '✋' },
  spin: { name: '转圈', emoji: '🌀' }, liftup: { name: '举高', emoji: '🙌' },
  fistbump: { name: '碰拳', emoji: '👊' },
  ball: { name: '玩球', emoji: '🎾' }, feather: { name: '羽毛', emoji: '🪶' },
  laser: { name: '激光', emoji: '🔴' }, mirror: { name: '镜子', emoji: '🪞' },
  balloon: { name: '气球', emoji: '🎈' }, 'soap-bubble': { name: '泡泡', emoji: '🫧' },
  company: { name: '陪伴', emoji: '🌟' }, watchtv: { name: '看剧', emoji: '📺' },
  'study-together': { name: '陪读', emoji: '📚' }, 'sleep-together': { name: '同睡', emoji: '💤' },
  walk: { name: '散步', emoji: '🚶' }
}

export function resolveTickle(type: TickleType, random: () => number = Math.random): TickleReaction {
  const base = TICKLE_REACTIONS[type]
  if (base.special && random() < base.special.chance) {
    return {
      ...base,
      expression: base.special.expression,
      text: base.special.text,
      floatText: base.special.floatText
    }
  }
  return base
}
