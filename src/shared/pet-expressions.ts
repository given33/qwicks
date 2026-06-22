/**
 * 桌面宠物 —— 程序化表情系统（P1，超越 9 帧限制）。
 *
 * 核心思路：宠物拆成 分层可编程形象（身体 + 眼 + 嘴 + 腮红 + 道具），
 * 每层独立用 SVG 合成。9 个基础姿态帧 + 程序化五官组合 → 几十种表情。
 *
 * 这是用代码模拟美术丰富度的关键：不依赖专用表情帧，靠五官参数变化
 * 表达 开心/难过/惊讶/害羞/生气/调皮/困/馋/思考/得意/委屈… 等情绪。
 *
 * 表情定义是纯数据，可单测；合成器是 React 组件。
 */

/** 五官参数：每种表情对应一组眼睛/嘴巴/腮红的画法。 */
export type FaceParams = {
  /** 眼睛形状 */
  eyes: 'normal' | 'happy' | 'sad' | 'wide' | 'closed' | 'wink' | 'heart' | 'star' | 'angry' | 'dizzy' | 'sparkle'
  /** 嘴巴形状 */
  mouth: 'smile' | 'open' | 'frown' | 'flat' | 'o' | 'tongue' | 'cat' | 'shocked' | 'whistle'
  /** 腮红强度 0-1（0=无） */
  blush: number
  /** 头顶附加（汗珠/气泡/感叹号/心/问号/zzz 等），可选 */
  topEmoji?: string
}

/** 表情库：情绪名 → 五官参数。每种情绪有独特面部组合。 */
export const PET_EXPRESSIONS: Record<string, FaceParams> = {
  // 基础情绪
  happy: { eyes: 'happy', mouth: 'smile', blush: 0.3 },
  neutral: { eyes: 'normal', mouth: 'flat', blush: 0 },
  sad: { eyes: 'sad', mouth: 'frown', blush: 0 },
  surprised: { eyes: 'wide', mouth: 'o', blush: 0.1 },
  angry: { eyes: 'angry', mouth: 'frown', blush: 0.5 },
  sleepy: { eyes: 'closed', mouth: 'flat', blush: 0, topEmoji: '💤' },
  dizzy: { eyes: 'dizzy', mouth: 'o', blush: 0, topEmoji: '💫' },

  // 细分情绪（QQ 级丰富度）
  excited: { eyes: 'star', mouth: 'open', blush: 0.4 },
  shy: { eyes: 'happy', mouth: 'smile', blush: 0.9 },
  proud: { eyes: 'normal', mouth: 'smile', blush: 0.2 },
  embarrassed: { eyes: 'sad', mouth: 'flat', blush: 0.8 },
  curious: { eyes: 'wide', mouth: 'flat', blush: 0, topEmoji: '?' },
  confused: { eyes: 'normal', mouth: 'frown', blush: 0, topEmoji: '?' },
  thinking: { eyes: 'normal', mouth: 'flat', blush: 0, topEmoji: '💭' },
  hungry: { eyes: 'normal', mouth: 'tongue', blush: 0, topEmoji: '~' },
  craving: { eyes: 'heart', mouth: 'tongue', blush: 0.6 },
  love: { eyes: 'heart', mouth: 'smile', blush: 0.7, topEmoji: '❤️' },
  naughty: { eyes: 'wink', mouth: 'cat', blush: 0.3 },
  playful: { eyes: 'sparkle', mouth: 'tongue', blush: 0.4 },
  guilty: { eyes: 'sad', mouth: 'frown', blush: 0.6 },
  scared: { eyes: 'wide', mouth: 'shocked', blush: 0 },
  bored: { eyes: 'half' as 'normal', mouth: 'flat', blush: 0 },
  content: { eyes: 'closed', mouth: 'smile', blush: 0.3 },
  smug: { eyes: 'normal', mouth: 'cat', blush: 0.2 },
  worried: { eyes: 'sad', mouth: 'o', blush: 0.2, topEmoji: '!' },
  relieved: { eyes: 'closed', mouth: 'whistle', blush: 0.1 },
  mischievous: { eyes: 'wink', mouth: 'smile', blush: 0.3 }
}

/** 取某情绪的表情参数（fallback neutral）。 */
export function getExpression(mood: string): FaceParams {
  return PET_EXPRESSIONS[mood] ?? PET_EXPRESSIONS.neutral
}

/**
 * 根据属性自动推导当前情绪表情。
 * 让宠物的脸随状态实时变化——这是"活着"的关键。
 */
export function deriveExpression(opts: {
  status: string
  mood: number        // 0-100
  hunger: number      // 0-100
  health: number      // 0-100
  isIdle: boolean
  beingPetted?: boolean
  beingDragged?: boolean
}): string {
  const { status, mood, hunger, health, isIdle, beingPetted, beingDragged } = opts
  if (beingDragged) return 'scared'
  if (beingPetted) return 'content'
  if (status === 'collapsed') return 'dizzy'
  if (status === 'critical') return 'scared'
  if (status === 'sick') return health < 15 ? 'dizzy' : 'sad'
  if (hunger < 25) return 'hungry'
  if (mood < 20) return 'sad'
  if (mood > 80 && isIdle) return 'happy'
  if (mood > 60) return 'content'
  if (isIdle && hunger < 40) return 'hungry'
  return 'neutral'
}

/** 校验表情库完整性。 */
export function validateExpressions(): string[] {
  const errors: string[] = []
  for (const [name, params] of Object.entries(PET_EXPRESSIONS)) {
    if (typeof params.eyes !== 'string') errors.push(`${name}: invalid eyes`)
    if (typeof params.mouth !== 'string') errors.push(`${name}: invalid mouth`)
    if (typeof params.blush !== 'number' || params.blush < 0 || params.blush > 1) {
      errors.push(`${name}: invalid blush`)
    }
  }
  return errors
}
