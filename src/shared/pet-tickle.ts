/**
 * 桌面宠物 —— Tickle 互动系统（P2，参考 QQ TickleActionType 并扩展）。
 *
 * QQ 有 5 种互动（玩球/逗鼠/跳绳/运动/吹泡泡）。我们扩展到 12+ 种，
 * 每种触发独特：表情 + 数值变化 + 反应文案 + 概率性特殊反应。
 *
 * 这是 QQ 交互优势的核心：不是"摸头=+心情"一种通用反应，
 * 而是每种互动有专属反馈，让宠物"知道你在怎么对它"。
 */

export type TickleType =
  | 'pet'        // 摸头（温柔）
  | 'poke'       // 戳（调皮）
  | 'tickle'     // 挠痒（大笑）
  | 'tease'      // 挑逗（玩弄）
  | 'scare'      // 吓唬
  | 'amuse'      // 逗乐
  | 'handshake'  // 握手
  | 'hug'        // 拥抱
  | 'ball'       // 玩球
  | 'feather'    // 羽毛逗
  | 'sing'       // 对它唱歌
  | 'mirror'     // 给它照镜子

export type TickleReaction = {
  /** 触发的情绪表情（对应 pet-expressions） */
  expression: string
  /** 心情变化（可负） */
  moodDelta: number
  /** 饥饿变化（玩球消耗体力） */
  hungerDelta?: number
  /** 反应文案（档案日志用） */
  text: string
  /** 头顶飘字 */
  floatText: string
  /** 概率性特殊反应（如 10% 反向） */
  special?: { chance: number; expression: string; text: string; floatText: string }
}

/** 每种互动的反应定义。 */
export const TICKLE_REACTIONS: Record<TickleType, TickleReaction> = {
  pet: {
    expression: 'content', moodDelta: 5, text: '被温柔地摸了摸头，很享受', floatText: '+心情'
  },
  poke: {
    expression: 'surprised', moodDelta: 2, text: '被戳了一下，吓一跳', floatText: '？！',
    special: { chance: 0.15, expression: 'angry', text: '被戳烦了，哼', floatText: '哼！' }
  },
  tickle: {
    expression: 'excited', moodDelta: 12, text: '被挠痒痒，笑得停不下来', floatText: '哈哈哈'
  },
  tease: {
    expression: 'naughty', moodDelta: 3, text: '被挑逗了，调皮地回应', floatText: '哼哼',
    special: { chance: 0.2, expression: 'embarrassed', text: '被挑逗得害羞了', floatText: '...' }
  },
  scare: {
    expression: 'scared', moodDelta: -3, text: '被吓了一跳', floatText: '！！',
    special: { chance: 0.25, expression: 'angry', text: '被吓后生气了', floatText: '哼！' }
  },
  amuse: {
    expression: 'happy', moodDelta: 8, text: '被逗乐了，开怀大笑', floatText: '哈哈'
  },
  handshake: {
    expression: 'proud', moodDelta: 6, text: '乖乖握了手', floatText: '🐾'
  },
  hug: {
    expression: 'love', moodDelta: 15, text: '被紧紧拥抱，满满的幸福感', floatText: '❤️'
  },
  ball: {
    expression: 'playful', moodDelta: 10, hungerDelta: -3, text: '开心地玩起了球', floatText: '🎾'
  },
  feather: {
    expression: 'curious', moodDelta: 7, text: '好奇地追着羽毛', floatText: '?'
  },
  sing: {
    expression: 'content', moodDelta: 9, text: '听着歌，陶醉地晃起来', floatText: '🎵'
  },
  mirror: {
    expression: 'shy', moodDelta: 4, text: '看到镜子里的自己，害羞了', floatText: '///',
    special: { chance: 0.3, expression: 'smug', text: '照镜子觉得自己真好看', floatText: '嘿嘿' }
  }
}

export const TICKLE_TYPES = Object.keys(TICKLE_REACTIONS) as TickleType[]

/** 中文标签 + emoji */
export const TICKLE_LABELS: Record<TickleType, { name: string; emoji: string }> = {
  pet: { name: '摸头', emoji: '🤚' },
  poke: { name: '戳', emoji: '👉' },
  tickle: { name: '挠痒', emoji: '🤣' },
  tease: { name: '挑逗', emoji: '😏' },
  scare: { name: '吓唬', emoji: '😱' },
  amuse: { name: '逗乐', emoji: '😆' },
  handshake: { name: '握手', emoji: '🤝' },
  hug: { name: '拥抱', emoji: '🤗' },
  ball: { name: '玩球', emoji: '🎾' },
  feather: { name: '羽毛逗', emoji: '🪶' },
  sing: { name: '唱歌', emoji: '🎤' },
  mirror: { name: '照镜子', emoji: '🪞' }
}

/**
 * 解析一次互动的反应（含概率性特殊反应）。
 * 注入 random 便于测试。
 */
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
