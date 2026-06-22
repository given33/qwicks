/**
 * 婚育面板（M12）。
 *
 * 成年后可相亲结婚（教堂场景）+ 培育宠物蛋。暖黄双方 + 仪式感。
 */
import { type ReactElement } from 'react'
import type { PetState } from '@shared/pet-state'

type Bridge = {
  marry: () => Promise<{ ok: boolean; partnerName?: string }>
  layEgg: () => Promise<{ ok: boolean; eggs?: number }>
  divorce: () => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function MarriagePanel({ state, onClose }: { state: PetState | null; onClose: () => void }): ReactElement {
  const marriage = state?.marriage
  const isAdult = state?.growth?.stage === 'adult'
  const married = marriage?.marriedAt !== null && marriage?.marriedAt !== undefined

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg, #ffd9e8 0%, #f5b8c8 60%, #d88aa0 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <button onClick={onClose} style={closeBtnStyle}>× 关闭</button>
      <div style={{ fontSize: 16, color: '#7a2a4a', fontWeight: 600, marginBottom: 20 }}>💍 婚姻殿堂</div>

      {/* 暖黄双方占位 */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        <div style={{ width: 60, height: 75, borderRadius: '48% 48% 42% 42%', background: '#f5c451', boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
        {married && <div style={{ fontSize: 28, alignSelf: 'center' }}>💕</div>}
        {married && (
          <div style={{ width: 60, height: 75, borderRadius: '48% 48% 42% 42%', background: '#f5a851', boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
        )}
      </div>

      {!isAdult ? (
        <div style={{ color: '#7a2a4a', fontSize: 14 }}>宠物还未成年，不能结婚哦～</div>
      ) : !married ? (
        <>
          <div style={{ color: '#7a2a4a', fontSize: 14, marginBottom: 20 }}>单身的它期待一段姻缘…</div>
          <button style={actionBtnStyle} onClick={() => void bridge()?.marry().then(() => onClose())}>
            💒 相亲结婚
          </button>
        </>
      ) : (
        <>
          <div style={{ color: '#7a2a4a', fontSize: 15, marginBottom: 8 }}>
            已与 {marriage!.partnerName} 结为伴侣
          </div>
          <div style={{ color: '#9a5a7a', fontSize: 13, marginBottom: 20 }}>
            已培育 {marriage!.eggs} 枚宠物蛋
          </div>
          <button style={actionBtnStyle} onClick={() => void bridge()?.layEgg().then(() => onClose())}>
            🥚 培育宠物蛋
          </button>
          <button style={{ ...actionBtnStyle, background: '#ccc', color: '#666', marginTop: 12 }} onClick={() => void bridge()?.divorce().then(() => onClose())}>
            分手
          </button>
        </>
      )}
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.4)',
  color: '#7a2a4a', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13
}
const actionBtnStyle: React.CSSProperties = {
  padding: '12px 28px', border: 'none', background: '#e85a8a', color: '#fff',
  borderRadius: 24, fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
}
