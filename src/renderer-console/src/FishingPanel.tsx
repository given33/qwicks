/**
 * 钓鱼玩法面板（M9）。
 *
 * 抛竿 → 等待咬钩（随机延迟，水波动画）→ 提竿时机判定 → 收获。
 * 暖黄角色站在岸边（CSS 占位），钓到鱼换元宝 + 写档案。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { judgeCast, rollBiteDelay, type FishCatch } from '@shared/fishing-logic'

type Bridge = {
  reward: (amount: number) => Promise<unknown>
  diaryAppend: (icon: string, text: string) => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

type Phase = 'idle' | 'casting' | 'biting' | 'result'

export function FishingPanel({ onClose }: { onClose: () => void }): ReactElement {
  const [phase, setPhase] = useState<Phase>('idle')
  const [combo, setCombo] = useState(0)
  const [lastCatch, setLastCatch] = useState<FishCatch | null>(null)
  const [totalEarned, setTotalEarned] = useState(0)
  const [message, setMessage] = useState('点击抛竿开始钓鱼')
  const bitAtRef = useRef<number | null>(null)
  const castStartRef = useRef(0)
  const timerRef = useRef(0)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const cast = (): void => {
    setPhase('casting')
    setMessage('鱼钩入水，等待鱼上钩…')
    setLastCatch(null)
    castStartRef.current = Date.now()
    bitAtRef.current = null
    const delay = rollBiteDelay()
    timerRef.current = window.setTimeout(() => {
      bitAtRef.current = Date.now() - castStartRef.current
      setPhase('biting')
      setMessage('咬钩了！快提竿！')
    }, delay)
  }

  const reel = (): void => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    const elapsed = Date.now() - castStartRef.current
    const r = judgeCast(elapsed, bitAtRef.current, combo)
    if (r.outcome === 'early') {
      setMessage('太心急了，鱼吓跑了（连击清零）')
      setCombo(0)
      setPhase('result')
    } else if (r.outcome === 'escaped') {
      setMessage('动作太慢，鱼跑了（连击清零）')
      setCombo(0)
      setPhase('result')
    } else {
      setMessage(`钓到了 ${r.catch.name}！+${r.catch.value} 元宝`)
      setLastCatch(r.catch)
      setCombo(r.combo)
      setTotalEarned((t) => t + r.catch.value)
      void bridge()?.reward(r.catch.value)
      void bridge()?.diaryAppend('🎣', `钓到了${r.catch.name}，卖了 ${r.catch.value} 元宝`)
      setPhase('result')
    }
  }

  const rarityColor: Record<string, string> = {
    common: '#888', uncommon: '#4a8', rare: '#c4a', junk: '#963'
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg, #b8e0f5 0%, #6ab8d9 60%, #3a7a99 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 16
    }}>
      <button onClick={onClose} style={closeBtnStyle}>× 关闭</button>
      <div style={{ position: 'absolute', top: '60%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
        {phase === 'biting' && <span style={{ animation: 'pet-bite-shake 0.3s infinite' }}>!!! 咬钩 !!!</span>}
      </div>
      {/* 暖黄角色占位（站在岸边） */}
      <div style={{
        width: 60, height: 75, borderRadius: '48% 48% 42% 42%', background: '#f5c451',
        marginBottom: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
      }} />
      <div style={{ fontSize: 15, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.4)', marginBottom: 12, textAlign: 'center' }}>
        {message}
      </div>
      {lastCatch && (
        <div style={{ fontSize: 14, color: rarityColor[lastCatch.rarity], marginBottom: 8 }}>
          {lastCatch.name}（{lastCatch.rarity}）
        </div>
      )}
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
        连击 x{combo} · 本场赚取 {totalEarned} 元宝
      </div>
      {phase === 'idle' || phase === 'result' ? (
        <button style={actionBtnStyle} onClick={cast}>🎣 抛竿</button>
      ) : phase === 'casting' ? (
        <button style={{ ...actionBtnStyle, opacity: 0.5 }} disabled>等待中…</button>
      ) : (
        <button style={{ ...actionBtnStyle, background: '#e85', animation: 'pet-bite-shake 0.3s infinite' }} onClick={reel}>
          ⬆ 提竿！
        </button>
      )}
      <style>{`@keyframes pet-bite-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-3px)} 75%{transform:translateX(3px)} }`}</style>
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.3)',
  color: '#fff', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13
}
const actionBtnStyle: React.CSSProperties = {
  padding: '12px 28px', border: 'none', background: '#f5c451', color: '#5a3a0a',
  borderRadius: 24, fontSize: 16, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
}
