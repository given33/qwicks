/**
 * 桌面宠物 —— 场景行为执行器（M6-T3）。
 *
 * 独立组件，订阅 pet state（读成长阶段）。idle 时按阶段+权重随机触发行为：
 * 持续 duration 期间头顶飘对应表情符号，完成后给经验/心情加成，并写档案日志（M8）。
 *
 * 蛋阶段不活动。行为期间显示飘字表情让宠物"自己会玩"。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { pickActivityByMood, type PetActivity, type ActivityMood } from '@shared/pet-activities'
import type { PetGrowth } from '@shared/pet-growth'

type Bridge = {
  getState: () => Promise<{ growth?: PetGrowth; vitals?: { mood: number; health: number } }>
  onStateChanged: (cb: (s: { growth?: PetGrowth; vitals?: { mood: number; health: number } }) => void) => () => void
  activityComplete: () => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function PetActivityRunner(): ReactElement | null {
  const [stage, setStage] = useState<PetGrowth['stage'] | null>(null)
  const [vitals, setVitals] = useState<{ mood: number; health: number }>({ mood: 70, health: 90 })
  const [current, setCurrent] = useState<{ activity: PetActivity; startedAt: number } | null>(null)
  const [floatingEmoji, setFloatingEmoji] = useState<{ emoji: string; id: number } | null>(null)

  // 订阅阶段 + 属性（推导情绪态用）
  useEffect(() => {
    const b = bridge()
    if (!b) return
    void b.getState().then((s) => {
      setStage(s.growth?.stage ?? 'egg')
      if (s.vitals) setVitals(s.vitals)
    })
    const unsub = b.onStateChanged((s) => {
      setStage(s.growth?.stage ?? 'egg')
      if (s.vitals) setVitals(s.vitals)
    })
    return unsub
  }, [])

  // 推导当前情绪态
  const mood: ActivityMood = vitals.health < 30 ? 'sick'
    : vitals.mood < 30 ? 'sad'
    : vitals.mood > 70 ? 'happy'
    : 'neutral'

  // 行为调度：无当前行为且非蛋时，按情绪态选行为
  useEffect(() => {
    if (!stage || stage === 'egg') return
    if (current) return
    const delay = 5000 + Math.random() * 10000
    const timer = window.setTimeout(() => {
      const activity = pickActivityByMood(stage, mood)
      if (!activity) return
      setCurrent({ activity, startedAt: Date.now() })
      if (activity.emoji) {
        setFloatingEmoji({ emoji: activity.emoji, id: Date.now() })
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [stage, current, mood])

  // 行为结束：清当前 + 加经验/心情（通过 play IPC 简化）
  useEffect(() => {
    if (!current) return
    const remaining = current.activity.duration - (Date.now() - current.startedAt)
    const timer = window.setTimeout(() => {
      // BUG-16 修复：行为完成走独立 IPC，不刷 playCount
      void bridge()?.activityComplete().catch(() => {})
      setCurrent(null)
    }, Math.max(remaining, 500))
    return () => window.clearTimeout(timer)
  }, [current])

  // 飘字表情自动消失
  useEffect(() => {
    if (!floatingEmoji) return
    const timer = window.setTimeout(() => setFloatingEmoji(null), 4000)
    return () => window.clearTimeout(timer)
  }, [floatingEmoji])

  if (!floatingEmoji) return null
  return (
    <div
      key={floatingEmoji.id}
      style={{
        position: 'absolute',
        bottom: 160,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 28,
        pointerEvents: 'none',
        animation: 'pet-emoji-float 4s ease-out forwards'
      }}
    >
      {floatingEmoji.emoji}
      <style>{`
        @keyframes pet-emoji-float {
          0% { transform: translateX(-50%) translateY(0) scale(0.5); opacity: 0; }
          20% { transform: translateX(-50%) translateY(-10px) scale(1.2); opacity: 1; }
          80% { transform: translateX(-50%) translateY(-40px) scale(1); opacity: 1; }
          100% { transform: translateX(-50%) translateY(-70px) scale(0.8); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
