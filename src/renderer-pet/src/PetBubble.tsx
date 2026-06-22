/**
 * 桌面宠物状态气泡（M4-T4）。
 *
 * 属性过低时宠物头顶冒对话气泡（QQ 经典文案随机），常驻到属性恢复。
 * 独立组件，订阅 pet state，根据 status 选文案。
 * 渲染位置跟随精灵（通过 pet state 的 position，M1 起位置在 PetStage 管理；
 * 这里简化：气泡浮在屏幕底部中央偏上，靠近默认精灵区域）。
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { PetState, PetStatus } from '@shared/pet-state'

type Bridge = {
  getState: () => Promise<PetState>
  onStateChanged: (cb: (s: PetState) => void) => () => void
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

const BUBBLE_TEXT: Record<Exclude<PetStatus, 'healthy'>, string[]> = {
  hungry: ['主人，我肚子好饿啊~', '想吃东西…'],
  dirty: ['好脏呀，带我去洗澡嘛', '我身上臭臭的…'],
  sick: ['咳咳…我不舒服…', '头好晕…'],
  critical: ['我感觉快要不行了…'],
  collapsed: ['…（需要还魂丹）…']
}

export function PetBubble(): ReactElement | null {
  const [status, setStatus] = useState<PetStatus>('healthy')

  useEffect(() => {
    const b = bridge()
    if (!b) return
    void b.getState().then((s) => setStatus(s.status))
    const unsub = b.onStateChanged((s) => setStatus(s.status))
    return unsub
  }, [])

  if (status === 'healthy') return null
  const texts = BUBBLE_TEXT[status as Exclude<PetStatus, 'healthy'>]
  if (!texts) return null
  const text = texts[Math.floor(Date.now() / 4000) % texts.length]

  return (
    <div style={{
      position: 'absolute',
      bottom: 140,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid rgba(245,196,81,0.5)',
      borderRadius: 12,
      padding: '8px 14px',
      fontSize: 14,
      color: '#5a4a2a',
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      pointerEvents: 'none',
      animation: 'pet-bubble-pop 0.3s ease-out'
    }}>
      {text}
      <style>{`
        @keyframes pet-bubble-pop {
          from { transform: translateX(-50%) scale(0.7); opacity: 0; }
          to { transform: translateX(-50%) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
