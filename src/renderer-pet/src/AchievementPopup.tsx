/**
 * 桌面宠物 —— 成就解锁弹窗（M7，Steam 式）。
 *
 * 监听 pet:achievement-unlocked，达成瞬间全屏暗化 + 徽章放大弹入 +
 * 光芒 + "成就解锁"标题 + 描述。3.5s 后自动消失。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { findAchievement } from '@shared/pet-achievements'

type Bridge = { onAchievementUnlocked: (cb: (id: string) => void) => () => void }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

type Popup = { id: string; key: number }

export function AchievementPopup(): ReactElement | null {
  const [popup, setPopup] = useState<Popup | null>(null)

  useEffect(() => {
    const b = bridge()
    if (!b) return
    return b.onAchievementUnlocked((id) => {
      setPopup({ id, key: Date.now() })
    })
  }, [])

  useEffect(() => {
    if (!popup) return
    const timer = window.setTimeout(() => setPopup(null), 3500)
    return () => window.clearTimeout(timer)
  }, [popup])

  if (!popup) return null
  const ach = findAchievement(popup.id)
  if (!ach) return null

  return (
    <div
      key={popup.key}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        animation: 'pet-ach-fade 0.4s ease-out',
        zIndex: 9999
      }}
    >
      <div style={{
        background: 'rgba(255,250,240,0.98)',
        border: '2px solid #f5c451',
        borderRadius: 16,
        padding: '24px 32px',
        textAlign: 'center',
        boxShadow: '0 0 60px rgba(245,196,81,0.6), 0 12px 32px rgba(0,0,0,0.3)',
        animation: 'pet-ach-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)'
      }}>
        <div style={{ fontSize: 14, color: '#b8860b', letterSpacing: 2, marginBottom: 8 }}>★ 成就解锁 ★</div>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🏆</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#5a3a0a', marginBottom: 6 }}>{ach.name}</div>
        <div style={{ fontSize: 14, color: '#8a7a5a' }}>{ach.desc}</div>
      </div>
      <style>{`
        @keyframes pet-ach-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pet-ach-pop {
          0% { transform: scale(0.3) rotate(-10deg); opacity: 0; }
          60% { transform: scale(1.1) rotate(2deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
