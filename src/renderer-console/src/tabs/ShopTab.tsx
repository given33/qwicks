/** 商店 tab：按类型分组，购买入库存。 */
import type { ReactElement } from 'react'
import type { PetItem } from '@shared/pet-state'
import { PET_CATALOG } from '@shared/pet-catalog'

type Bridge = { buy: (id: string) => Promise<unknown> }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

const CATEGORIES: { type: PetItem['type']; label: string }[] = [
  { type: 'food', label: '食物' },
  { type: 'bath', label: '清洁' },
  { type: 'medicine', label: '药品' },
  { type: 'revive', label: '还魂丹' },
  { type: 'toy', label: '玩具' }
]

const TYPE_ICON: Record<PetItem['type'], string> = {
  food: '🍖', bath: '🛁', medicine: '💊', revive: '✨', toy: '🧸'
}

export function ShopTab(): ReactElement {
  return (
    <div>
      {CATEGORIES.map((cat) => {
        const items = PET_CATALOG.filter((i) => i.type === cat.type)
        if (items.length === 0) return null
        return (
          <div key={cat.type} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#7a5a1a', marginBottom: 6 }}>{cat.label}</div>
            {items.map((item) => (
              <button key={item.id} style={rowStyle} onClick={() => void bridge()?.buy(item.id)}>
                <span style={{ fontSize: 18 }}>{TYPE_ICON[item.type]}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#5a4a2a' }}>{item.name}</span>
                <span style={{ fontSize: 13, color: '#b8860b' }}>🪙 {item.price}</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  border: '1px solid rgba(245,196,81,0.25)',
  background: 'rgba(255,255,255,0.5)',
  borderRadius: 6,
  cursor: 'pointer',
  marginBottom: 4
}
