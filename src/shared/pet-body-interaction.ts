/**
 * 桌面宠物 —— 部位互动矩阵（Round 2 新玩法，学习 QQ interact 系统）。
 *
 * QQ 宠物的 interact 按"接触部位"分（H=头/M=嘴/BE=身/LE/RE=耳/LF/RF=脚...），
 * 同一种"摸"摸不同部位、不同情绪下反应完全不同。
 *
 * 我们定义 8 部位 × 4 情绪 = 32 种组合反应，每种独特表情+数值+文案。
 */

/** 接触部位 */
export type BodyPart = 'head' | 'ear' | 'belly' | 'foot' | 'hand' | 'back' | 'face' | 'tail'

/** 互动时的宠物情绪态 */
export type InteractionMood = 'happy' | 'neutral' | 'sad' | 'sick'

export type BodyReaction = {
  expression: string    // 对应 pet-expressions 的表情名
  moodDelta: number
  text: string
}

/** 部位 × 情绪 → 反应矩阵。摸不同部位/不同心情下反应天差地别。 */
const BODY_MATRIX: Record<BodyPart, Record<InteractionMood, BodyReaction>> = {
  head: {
    happy: { expression: 'content', moodDelta: 8, text: '被摸头超开心，蹭你的手' },
    neutral: { expression: 'content', moodDelta: 5, text: '乖乖被摸头' },
    sad: { expression: 'shy', moodDelta: 10, text: '被摸头后心情好多了' },
    sick: { expression: 'worried', moodDelta: 2, text: '虚弱地接受摸头' }
  },
  ear: {
    happy: { expression: 'shy', moodDelta: 6, text: '耳朵被碰，害羞地缩了缩' },
    neutral: { expression: 'surprised', moodDelta: 3, text: '耳朵敏感，抖了一下' },
    sad: { expression: 'scared', moodDelta: -1, text: '不想被碰耳朵，躲开了' },
    sick: { expression: 'scared', moodDelta: -2, text: '耳朵难受，不让碰' }
  },
  belly: {
    happy: { expression: 'excited', moodDelta: 15, text: '被摸肚子爽翻了，打起滚来' },
    neutral: { expression: 'playful', moodDelta: 8, text: '被摸肚子，咯咯笑' },
    sad: { expression: 'scared', moodDelta: -2, text: '肚子不舒服，躲开了' },
    sick: { expression: 'scared', moodDelta: -5, text: '肚子痛，千万别碰！' }
  },
  foot: {
    happy: { expression: 'naughty', moodDelta: 7, text: '脚底被碰，调皮地缩脚' },
    neutral: { expression: 'surprised', moodDelta: 2, text: '脚被碰了一下' },
    sad: { expression: 'embarrassed', moodDelta: 1, text: '不情愿地让你碰脚' },
    sick: { expression: 'worried', moodDelta: -1, text: '没力气缩脚了' }
  },
  hand: {
    happy: { expression: 'proud', moodDelta: 6, text: '乖乖让你握手' },
    neutral: { expression: 'content', moodDelta: 4, text: '配合地伸出手' },
    sad: { expression: 'shy', moodDelta: 3, text: '怯怯地伸出手' },
    sick: { expression: 'worried', moodDelta: 1, text: '虚弱地抬了抬手' }
  },
  back: {
    happy: { expression: 'content', moodDelta: 10, text: '被顺背摸，舒服得眯眼' },
    neutral: { expression: 'content', moodDelta: 6, text: '被摸背，很享受' },
    sad: { expression: 'content', moodDelta: 8, text: '被摸背后安心了许多' },
    sick: { expression: 'content', moodDelta: 4, text: '被摸背感觉好一点了' }
  },
  face: {
    happy: { expression: 'shy', moodDelta: 5, text: '脸被捏，害羞红扑扑' },
    neutral: { expression: 'surprised', moodDelta: 2, text: '脸被碰，一脸懵' },
    sad: { expression: 'embarrassed', moodDelta: -1, text: '不想被碰脸' },
    sick: { expression: 'scared', moodDelta: -3, text: '脸很难受，别碰' }
  },
  tail: {
    happy: { expression: 'excited', moodDelta: 12, text: '尾巴被抓住，开心地转圈' },
    neutral: { expression: 'naughty', moodDelta: 5, text: '尾巴被碰，回头看' },
    sad: { expression: 'scared', moodDelta: -3, text: '尾巴垂着，不想被碰' },
    sick: { expression: 'worried', moodDelta: -2, text: '尾巴没力气动了' }
  }
}

export const BODY_PARTS: { id: BodyPart; name: string; emoji: string }[] = [
  { id: 'head', name: '头', emoji: '🤚' },
  { id: 'ear', name: '耳朵', emoji: '👂' },
  { id: 'belly', name: '肚子', emoji: '🫳' },
  { id: 'foot', name: '脚', emoji: '🦶' },
  { id: 'hand', name: '手', emoji: '🤝' },
  { id: 'back', name: '背', emoji: '👋' },
  { id: 'face', name: '脸', emoji: '🤏' },
  { id: 'tail', name: '尾巴', emoji: '🐾' }
]

/** 查询某部位×某情绪的反应。 */
export function bodyReact(part: BodyPart, mood: InteractionMood): BodyReaction {
  return BODY_MATRIX[part]?.[mood] ?? BODY_MATRIX.head.neutral
}

/**
 * 根据宠物属性推导当前互动情绪态。
 * happy: mood>70 且非 sick
 * sad: mood<30
 * sick: health<30
 * neutral: 其他
 */
export function deriveInteractionMood(vitals: { mood: number; health: number }): InteractionMood {
  if (vitals.health < 30) return 'sick'
  if (vitals.mood < 30) return 'sad'
  if (vitals.mood > 70) return 'happy'
  return 'neutral'
}

/** 随机选一个部位（UI 用）。 */
export function pickBodyPart(random: () => number = Math.random): BodyPart {
  const parts = BODY_PARTS.map((p) => p.id)
  return parts[Math.floor(random() * parts.length)] ?? 'head'
}

/** 校验矩阵完整性。 */
export function validateBodyMatrix(): string[] {
  const errors: string[] = []
  for (const part of BODY_PARTS.map((p) => p.id)) {
    for (const mood of ['happy', 'neutral', 'sad', 'sick'] as InteractionMood[]) {
      const r = BODY_MATRIX[part]?.[mood]
      if (!r || typeof r.moodDelta !== 'number' || !r.text) {
        errors.push(`${part}-${mood}: missing reaction`)
      }
    }
  }
  return errors
}
