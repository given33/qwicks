/**
 * 桌面宠物 —— 场景行为执行器（M6-T3）。
 *
 * 独立组件，订阅 pet state（读成长阶段）。idle 时按阶段+权重随机触发行为：
 * 持续 duration 期间头顶飘对应表情符号，完成后给经验/心情加成，并写档案日志（M8）。
 *
 * 蛋阶段不活动。行为期间显示飘字表情让宠物"自己会玩"。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { pickActivity, type PetActivity } from '@shared/pet-activities'
import type { PetGrowth } from '@shared/pet-growth'

type Bridge = {
  getState: () => Promise<{ growth?: PetGrowth }>
  onStateChanged: (cb: (s: { growth?: PetGrowth }) => void) => () => void
  play: () => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function PetActivityRunner(): ReactElement | null {
  const [stage, setStage] = useState<PetGrowth['stage'] | null>(null)
  const [current, setCurrent] = useState<{ activity: PetActivity; startedAt: number } | null>(null)
  const [floatingEmoji, setFloatingEmoji] = useState<{ emoji: string; id: number } | null>(null)

  // 订阅阶段
  useEffect(() => {
    const b = bridge()
    if (!b) return
    void b.getState().then((s) => setStage(s.growth?.stage ?? 'egg'))
    const unsub = b.onStateChanged((s) => setStage(s.growth?.stage ?? 'egg'))
    return unsub
  }, [])

  // 行为调度：无当前行为且非蛋时，随机延迟后触发
  useEffect(() => {
    if (!stage || stage === 'egg') return
    if (current) return
    const delay = 5000 + Math.random() * 10000 // 5-15s 后开始一个行为
    const timer = window.setTimeout(() => {
      const activity = pickActivity(stage)
      if (!activity) return
      setCurrent({ activity, startedAt: Date.now() })
      if (activity.emoji) {
        setFloatingEmoji({ emoji: activity.emoji, id: Date.now() })
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [stage, current])

  // 行为结束：清当前 + 加经验/心情（通过 play IPC 简化）
  useEffect(() => {
    if (!current) return
    const remaining = current.activity.duration - (Date.now() - current.startedAt)
    const timer = window.setTimeout(() => {
      // 行为完成：给经验/心情（复用 play IPC 的 +mood，经验由日志/成就系统记录）
      // 简化：调用 play 给一点心情，完整经验奖励留 M7 成就/M8 档案统一处理
      void bridge()?.play().catch(() => {})
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
