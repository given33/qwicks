/** 照料 tab：摸头/玩耍/喂食(最近食物)/签到快捷。 */
import type { ReactElement } from 'react'
import type { PetState } from '@shared/pet-state'

type Bridge = {
  pet: () => Promise<unknown>
  play: () => Promise<unknown>
  feed: (id: string) => Promise<unknown>
  signIn: () => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function CareTab({ state, onFish }: { state: PetState | null; onFish?: () => void }): ReactElement {
  const foods = state?.inventory.filter((i) => i.type === 'food') ?? []
  const quickFoods = foods.slice(0, 3)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button style={btnStyle} onClick={() => void bridge()?.pet()}>摸摸头</button>
      <button style={btnStyle} onClick={() => void bridge()?.play()}>玩耍</button>
      <button style={btnStyle} onClick={() => void bridge()?.signIn()}>每日签到</button>
      {onFish && <button style={btnStyle} onClick={onFish}>🎣 去钓鱼</button>}
      {quickFoods.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#999' }}>快速喂食</div>
          {quickFoods.map((f) => (
            <button key={f.id} style={btnStyle} onClick={() => void bridge()?.feed(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid rgba(245,196,81,0.4)',
  background: 'rgba(245,196,81,0.1)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  color: '#7a5a1a',
  textAlign: 'left'
}
