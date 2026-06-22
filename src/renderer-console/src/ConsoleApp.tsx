/**
 * 宠物控制台主应用（M4-T7/T8）。
 *
 * 自绘暖黄主题面板（非原生 Menu）。6 tab：照料/库存/商店/成就/档案/设置。
 * M4 先实现照料/库存/商店/设置；成就/档案 tab 占位（M7/M8 激活）。
 * 圆角卡片 + 属性仪表盘 + 元宝 + tab 切换。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { CareTab } from './tabs/CareTab'
import { InventoryTab } from './tabs/InventoryTab'
import { ShopTab } from './tabs/ShopTab'
import { SettingsTab } from './tabs/SettingsTab'
import { PlaceholderTab } from './tabs/PlaceholderTab'
import type { PetState } from '@shared/pet-state'

type TabId = 'care' | 'inventory' | 'shop' | 'achievements' | 'diary' | 'settings'

const TABS: { id: TabId; label: string; active: boolean }[] = [
  { id: 'care', label: '照料', active: true },
  { id: 'inventory', label: '库存', active: true },
  { id: 'shop', label: '商店', active: true },
  { id: 'achievements', label: '成就', active: false },
  { id: 'diary', label: '档案', active: false },
  { id: 'settings', label: '设置', active: true }
]

type PetBridge = {
  getState: () => Promise<PetState>
  onStateChanged: (cb: (s: PetState) => void) => () => void
  toggleConsole: () => void
}

function getBridge(): PetBridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: PetBridge }).pet ?? null : null
}

export function ConsoleApp(): ReactElement {
  const [state, setState] = useState<PetState | null>(null)
  const [tab, setTab] = useState<TabId>('care')

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) return
    void bridge.getState().then(setState)
    const unsub = bridge.onStateChanged(setState)
    return unsub
  }, [])

  const v = state?.vitals
  return (
    <div style={panelStyle}>
      {/* 标题栏（拖动区 + 关闭） */}
      <div style={titleBarStyle}>
        <span>🐾 宠物面板</span>
        <button
          style={closeBtnStyle}
          onClick={() => getBridge()?.toggleConsole()}
        >×</button>
      </div>

      {/* 属性仪表盘 */}
      {v && (
        <div style={vitalsStyle}>
          <VitalBar label="饱食" value={v.hunger} color="#f5c451" />
          <VitalBar label="清洁" value={v.cleanliness} color="#7ec8e3" />
          <VitalBar label="健康" value={v.health} color="#7ed287" />
          <VitalBar label="心情" value={v.mood} color="#e87fa3" />
          <div style={{ marginTop: 8, fontSize: 13 }}>🪙 元宝：{state!.coins}</div>
        </div>
      )}

      {/* tab 切换 */}
      <div style={tabsStyle}>
        {TABS.map((t) => (
          <button
            key={t.id}
            style={t.id === tab ? tabActiveStyle : tabStyle}
            disabled={!t.active}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* tab 内容 */}
      <div style={contentStyle}>
        {tab === 'care' && <CareTab state={state} />}
        {tab === 'inventory' && <InventoryTab state={state} />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'achievements' && <PlaceholderTab text="成就系统（M7 即将开放）" />}
        {tab === 'diary' && <PlaceholderTab text="宠物档案（M8 即将开放）" />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}

function VitalBar({ label, value, color }: { label: string; value: number; color: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{ width: 36 }}>{label}</span>
      <div style={{ flex: 1, height: 10, background: 'rgba(0,0,0,0.08)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 36, textAlign: 'right' }}>{Math.round(value)}</span>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'rgba(255,250,240,0.96)',
  borderRadius: 16,
  border: '1px solid rgba(245,196,81,0.4)',
 boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}
const titleBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  fontSize: 14,
  fontWeight: 600,
  color: '#7a5a1a'
}
const closeBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  cursor: 'pointer',
  color: '#999',
  lineHeight: 1
}
const vitalsStyle: React.CSSProperties = {
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  borderBottom: '1px solid rgba(0,0,0,0.06)'
}
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid rgba(0,0,0,0.06)'
}
const tabStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 4px',
  border: 'none',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer',
  color: '#999'
}
const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  color: '#7a5a1a',
  fontWeight: 600,
  borderBottom: '2px solid #f5c451'
}
const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 16
}
