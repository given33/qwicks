/** 互动 tab：35 种 Tickle 互动，按 6 类分组。 */
import { useState, type ReactElement } from 'react'
import { TICKLE_CATEGORIES, TICKLE_LABELS, type TickleType } from '@shared/pet-tickle'

type Bridge = { tickle: (type: string) => Promise<{ ok: boolean; reaction?: { floatText: string; text: string } }> }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function TickleTab(): ReactElement {
  const [lastReaction, setLastReaction] = useState('选一种互动方式陪它玩吧～')

  const doTickle = async (type: TickleType): Promise<void> => {
    const r = await bridge()?.tickle(type)
    if (r?.ok && r.reaction) {
      setLastReaction(`${r.reaction.floatText}  ${r.reaction.text}`)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#7a5a1a', marginBottom: 10, minHeight: 18 }}>{lastReaction}</div>
      {TICKLE_CATEGORIES.map((cat) => (
        <div key={cat.name} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#8a6a2a', marginBottom: 4 }}>
            {cat.emoji} {cat.name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {cat.types.map((t) => (
              <button key={t} style={cellStyle} title={TICKLE_LABELS[t].name} onClick={() => void doTickle(t)}>
                <div style={{ fontSize: 18 }}>{TICKLE_LABELS[t].emoji}</div>
                <div style={{ fontSize: 9, color: '#7a5a1a' }}>{TICKLE_LABELS[t].name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  padding: 6, border: '1px solid rgba(245,196,81,0.25)', background: 'rgba(255,255,255,0.5)',
  borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
}
