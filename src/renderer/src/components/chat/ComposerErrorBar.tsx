import { useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export type ComposerError = {
  summary: string
  detail?: string
  maxAttempts: number
}

/**
 * 输出框(消息列表)与输入框之间的纯文字错误条。
 * 5 次重连全失败后显示。样式:灰色纯文字、无背景、无边框、居中;
 * 概括行可点击展开具体原因(HTTP 状态码/错误体/建议)。
 */
export function ComposerErrorBar({ error }: { error: ComposerError | null }): ReactElement | null {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  if (!error) return null
  return (
    <div className="flex flex-col items-center px-4 py-2.5 text-center text-[13px]" style={{ color: '#999' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 hover:opacity-80"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
      >
        <span>{t('modelConnectFailed', { max: error.maxAttempts })}</span>
        {error.detail ? <span className="text-[11px] opacity-70">{expanded ? '▲' : '▼'}</span> : null}
      </button>
      {expanded && error.detail ? (
        <div className="mt-1 max-w-full whitespace-pre-wrap text-[12px] opacity-80">{error.detail}</div>
      ) : null}
    </div>
  )
}
