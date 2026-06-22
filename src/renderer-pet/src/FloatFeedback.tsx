/**
 * 桌面宠物 —— 浮动数值反馈系统（补强：参考 QQ 宠物 float 反馈分层）。
 *
 * QQ 宠物的反馈三件套：常驻状态条 + 正/负浮动数值 + 收益特效。
 * 我们之前只有 PetBubble（文字气泡），缺"数值飘字"。
 * 本模块提供浮动反馈的渲染：+25饱食 / +15元宝 / +5心情 等，
 * 由照料动作/小游戏结算触发，向上飘升淡出。
 *
 * 同时支持"获得特效"（赚钱/升级时额外光芒）。
 */
import { useEffect, useState, type ReactElement } from 'react'

export type FloatFeedback = {
  id: number
  text: string
  color: string
  x: number  // 相对窗口百分比 0-100
  y: number
}

// 全局反馈队列（任何组件 push 即可触发飘字）
let feedbackQueue: FloatFeedback[] = []
let feedbackId = 0
const subscribers: Array<(items: FloatFeedback[]) => void> = []

/** 触发一个浮动反馈（任意组件调用）。 */
export function pushFloatFeedback(text: string, color = '#3a3', x = 50, y = 50): void {
  const item: FloatFeedback = { id: ++feedbackId, text, color, x, y }
  feedbackQueue = [...feedbackQueue, item]
  for (const sub of subscribers) sub(feedbackQueue)
  // 1.2s 后自动移除
  window.setTimeout(() => {
    feedbackQueue = feedbackQueue.filter((f) => f.id !== item.id)
    for (const sub of subscribers) sub(feedbackQueue)
  }, 1200)
}

/** 预设颜色 */
export const FEEDBACK_COLORS = {
  positive: '#3aa855',  // 绿（增益）
  negative: '#d44',     // 红（减益）
  coin: '#daa520',      // 金（元宝）
  mood: '#e87fa3',      // 粉（心情）
  exp: '#6a8aff'        // 蓝（经验）
}

/** 浮动反馈渲染层（挂载在 pet renderer，监听队列）。 */
export function FloatFeedbackLayer(): ReactElement | null {
  const [items, setItems] = useState<FloatFeedback[]>([])
  useEffect(() => {
    subscribers.push(setItems)
    return () => {
      const idx = subscribers.indexOf(setItems)
      if (idx >= 0) subscribers.splice(idx, 1)
    }
  }, [])

  if (items.length === 0) return null
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      {items.map((f) => (
        <div
          key={f.id}
          style={{
            position: 'absolute',
            left: `${f.x}%`,
            top: `${f.y}%`,
            transform: 'translateX(-50%)',
            color: f.color,
            fontSize: 18,
            fontWeight: 700,
            textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            animation: 'pet-float-up 1.2s ease-out forwards'
          }}
        >
          {f.text}
        </div>
      ))}
      <style>{`
        @keyframes pet-float-up {
          0% { transform: translateX(-50%) translateY(0) scale(0.6); opacity: 0; }
          15% { transform: translateX(-50%) translateY(-10px) scale(1.2); opacity: 1; }
          100% { transform: translateX(-50%) translateY(-60px) scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

/**
 * 监听 pet state 变化，自动生成飘字反馈（参考 QQ float 反馈分层）。
 * 检测 hunger/cleanliness/health/mood/coins 的增减，飘出 +/-数值。
 * 这是 QQ 宠物"爽感"的核心：每次操作立刻看到数值变化飘起。
 */
export function FeedbackWatcher(): ReactElement | null {
  useEffect(() => {
    const b = bridge()
    if (!b) return
    let prev: PetStateLite | null = null
    void b.getState().then((s) => {
      prev = s
    })
    return b.onStateChanged((s) => {
      if (!prev) {
        prev = s
        return
      }
      if (prev.vitals && s.vitals) {
        for (const key of Object.keys(VITAL_LABEL) as (keyof PetVitals)[]) {
          const delta = Math.round((s.vitals[key] ?? 0) - (prev.vitals[key] ?? 0))
          if (delta !== 0) {
            pushFloatFeedback(
              `${delta > 0 ? '+' : ''}${delta} ${VITAL_LABEL[key]}`,
              delta > 0 ? VITAL_COLOR[key] : FEEDBACK_COLORS.negative,
              50,
              55
            )
          }
        }
      }
      const coinDelta = Math.round((s.coins ?? 0) - (prev.coins ?? 0))
      if (coinDelta !== 0) {
        pushFloatFeedback(
          `${coinDelta > 0 ? '+' : ''}${coinDelta} 元宝`,
          coinDelta > 0 ? FEEDBACK_COLORS.coin : FEEDBACK_COLORS.negative,
          50,
          48
        )
      }
      prev = s
    })
  }, [])
  return null
}

type PetVitals = { hunger: number; cleanliness: number; health: number; mood: number }
type PetStateLite = { vitals?: PetVitals; coins?: number }

type Bridge = {
  getState: () => Promise<PetStateLite>
  onStateChanged: (cb: (s: PetStateLite) => void) => () => void
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

const VITAL_LABEL: Record<keyof PetVitals, string> = {
  hunger: '饱食',
  cleanliness: '清洁',
  health: '健康',
  mood: '心情'
}
const VITAL_COLOR: Record<keyof PetVitals, string> = {
  hunger: FEEDBACK_COLORS.positive,
  cleanliness: '#7ec8e3',
  health: '#7ed287',
  mood: FEEDBACK_COLORS.mood
}
