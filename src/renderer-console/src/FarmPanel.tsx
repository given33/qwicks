/**
 * 农场玩法面板（M10）。
 *
 * 6 块地网格。选种子（扣元宝）→ 种下 → 定时生长 → 收获（得元宝 + 写档案）。
 * 暖黄角色在田边（占位）。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { CROPS, defaultFarm, harvest, plant, plotStage, stageEmoji, type FarmState } from '@shared/farm-logic'

type Bridge = {
  pay: (amount: number) => Promise<{ ok: boolean }>
  reward: (amount: number) => Promise<unknown>
  diaryAppend: (icon: string, text: string) => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function FarmPanel({ onClose }: { onClose: () => void }): ReactElement {
  const [farm, setFarm] = useState<FarmState>(defaultFarm)
  const [selectedCrop, setSelectedCrop] = useState(CROPS[0].id)
  const [, force] = useState(0)

  // 定时刷新生长进度（每秒）
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const now = Date.now()

  const onPlant = async (plotIndex: number): Promise<void> => {
    const b = bridge()
    if (!b) return
    const crop = CROPS.find((c) => c.id === selectedCrop)
    if (!crop) return
    const r = await b.pay(crop.seedPrice)
    if (!r.ok) return
    setFarm((f) => plant(f, plotIndex, selectedCrop, Date.now()))
  }

  const onHarvest = (plotIndex: number): void => {
    const { farm: next, reward, cropName } = harvest(farm, plotIndex, now)
    setFarm(next)
    if (reward > 0 && cropName) {
      void bridge()?.reward(reward)
      void bridge()?.diaryAppend('🌾', `收获了${cropName}，卖了 ${reward} 元宝`)
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg, #c4e0a0 0%, #8ab860 60%, #5a8040 100%)',
      display: 'flex', flexDirection: 'column', padding: 16
    }}>
      <button onClick={onClose} style={closeBtnStyle}>× 关闭</button>
      <div style={{ fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 12 }}>🌾 农场</div>

      {/* 种子选择 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {CROPS.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCrop(c.id)}
            style={selectedCrop === c.id ? seedBtnActive : seedBtn}
          >
            {stageEmoji('ripe', c.id)} {c.name} 🪙{c.seedPrice}
          </button>
        ))}
      </div>

      {/* 6 块地 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, flex: 1 }}>
        {farm.plots.map((plot, i) => {
          const stage = plotStage(plot, now)
          const occupied = plot.cropId !== null
          return (
            <button
              key={i}
              onClick={() => (stage === 'ripe' ? onHarvest(i) : !occupied && onPlant(i))}
              style={plotStyle}
            >
              <div style={{ fontSize: 36 }}>{stageEmoji(stage, plot.cropId)}</div>
              <div style={{ fontSize: 11, color: '#5a4030' }}>
                {!occupied ? '空地（点种植）' : stage === 'ripe' ? '成熟！点收获' : '生长中…'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.3)',
  color: '#fff', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13
}
const seedBtn: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.2)',
  color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12
}
const seedBtnActive: React.CSSProperties = { ...seedBtn, background: '#f5c451', color: '#5a3a0a', fontWeight: 600 }
const plotStyle: React.CSSProperties = {
  border: '2px solid rgba(255,255,255,0.4)', background: 'rgba(139,90,43,0.4)', borderRadius: 10,
  cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4
}
