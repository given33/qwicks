/** 占位 tab（成就/档案 M7/M8 激活前用）。 */
import type { ReactElement } from 'react'

export function PlaceholderTab({ text }: { text: string }): ReactElement {
  return (
    <div style={{ color: '#999', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
      {text}
    </div>
  )
}
