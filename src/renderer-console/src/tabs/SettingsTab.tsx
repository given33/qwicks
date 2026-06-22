/** 设置 tab：展示宠物设置（完整编辑留后续迭代）。 */
import type { ReactElement } from 'react'

export function SettingsTab(): ReactElement {
  return (
    <div style={{ fontSize: 13, color: '#5a4a2a', lineHeight: 1.8 }}>
      <p>桌面宠物设置：</p>
      <p>• 显隐：通过托盘菜单"显示/隐藏桌面宠物"</p>
      <p>• 漫步/缩放/签到等可在主窗口设置中调整</p>
      <p style={{ color: '#999', marginTop: 16, fontSize: 12 }}>更多设置选项开发中…</p>
    </div>
  )
}
