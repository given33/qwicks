/** 库存 tab：物品网格，点击使用。 */
import type { ReactElement } from 'react'
import type { PetItem, PetState } from '@shared/pet-state'

type Bridge = { useItem: (id: string) => Promise<unknown> }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

const TYPE_ICON: Record<PetItem['type'], string> = {
  food: '🍖', bath: '🛁', medicine: '💊', revive: '✨', toy: '🧸'
}

export function InventoryTab({ state }: { state: PetState | null }): ReactElement {
  const items = state?.inventory ?? []
  if (items.length === 0) {
    return <div style={{ color: '#999', fontSize: 13, textAlign: 'center', marginTop: 40 }}>库存空空如也，去商店买点东西吧～</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {items.map((item, i) => (
        <button
          key={`${item.id}-${i}`}
          style={cellStyle}
          onClick={() => void bridge()?.useItem(item.id)}
        >
          <div style={{ fontSize: 24 }}>{TYPE_ICON[item.type]}</div>
          <div style={{ fontSize: 12, color: '#7a5a1a' }}>{item.name}</div>
        </button>
      ))}
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  padding: 12,
  border: '1px solid rgba(245,196,81,0.3)',
  background: 'rgba(255,255,255,0.6)',
  borderRadius: 8,
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4
}
