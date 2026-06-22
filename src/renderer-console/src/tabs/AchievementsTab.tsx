/** 成就 tab：全成就列表 + 解锁状态 + 总进度。 */
import type { ReactElement } from 'react'
import { PET_ACHIEVEMENTS } from '@shared/pet-achievements'
import type { PetState } from '@shared/pet-state'

const CATEGORY_LABEL: Record<string, string> = {
  growth: '成长', care: '照料', survival: '生存', play: '玩耍', collection: '收集'
}

export function AchievementsTab({ state }: { state: PetState | null }): ReactElement {
  const unlocked = new Set(state?.achievements?.unlocked ?? [])
  const total = PET_ACHIEVEMENTS.length
  const got = unlocked.size
  const byCategory: Record<string, typeof PET_ACHIEVEMENTS> = {}
  for (const a of PET_ACHIEVEMENTS) {
    (byCategory[a.category] ??= []).push(a)
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: '#7a5a1a', marginBottom: 12 }}>
        已解锁 {got} / {total}（{Math.round(got / total * 100)}%）
      </div>
      <div style={{ height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ width: `${got / total * 100}%`, height: '100%', background: '#f5c451' }} />
      </div>
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#8a6a2a', marginBottom: 6 }}>
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          {items.map((a) => {
            const isUnlocked = unlocked.has(a.id)
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 8px', marginBottom: 4,
                background: isUnlocked ? 'rgba(245,196,81,0.15)' : 'rgba(0,0,0,0.03)',
                borderRadius: 6,
                opacity: isUnlocked ? 1 : 0.5
              }}>
                <span style={{ fontSize: 18 }}>{isUnlocked ? '🏆' : (a.hidden ? '❓' : '🔒')}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: isUnlocked ? '#5a3a0a' : '#999' }}>
                    {isUnlocked || !a.hidden ? a.name : '???'}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>
                    {isUnlocked || !a.hidden ? a.desc : '隐藏成就'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
