/** 互动 tab：12 种 Tickle 互动，每种独特反应。 */
import { useState, type ReactElement } from 'react'
import { TICKLE_TYPES, TICKLE_LABELS, type TickleType } from '@shared/pet-tickle'

type Bridge = { tickle: (type: string) => Promise<{ ok: boolean; reaction?: { floatText: string; text: string } }> }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function TickleTab(): ReactElement {
  const [lastReaction, setLastReaction] = useState<string>('选一种互动方式陪它玩吧～')

  const doTickle = async (type: TickleType): Promise<void> => {
    const r = await bridge()?.tickle(type)
    if (r?.ok && r.reaction) {
      setLastReaction(`${r.reaction.floatText}  ${r.reaction.text}`)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: '#7a5a1a', marginBottom: 8, minHeight: 20 }}>{lastReaction}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {TICKLE_TYPES.map((t) => (
          <button
            key={t}
            style={cellStyle}
            onClick={() => void doTickle(t)}
          >
            <div style={{ fontSize: 22 }}>{TICKLE_LABELS[t].emoji}</div>
            <div style={{ fontSize: 11, color: '#7a5a1a' }}>{TICKLE_LABELS[t].name}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  padding: 10, border: '1px solid rgba(245,196,81,0.3)', background: 'rgba(255,255,255,0.6)',
  borderRadius: 8, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
}
