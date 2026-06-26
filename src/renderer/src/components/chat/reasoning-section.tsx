import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AssistantMarkdown } from './AssistantMarkdown'

/**
 * Codex 风格的思维链展示（对标 ReasoningItem）。
 *
 * 双态渲染：
 *  - 思考中（isThinking）：流式 markdown + shimmer 状态标签 + 自动滚底 +
 *    默认展开。状态标签 = "Thinking"（不显示秒数，秒数归 WorkMetaRow 总轴）。
 *  - 思考完（!isThinking）：完整 markdown + "Thought" 标签 + 默认折叠可展开。
 *
 * 关键：本组件只展示思考【内容】，不计时——避免与 WorkMetaRow 出现双重计时。
 * 详见 docs/spec 与 turn-timer 状态机。
 */
export function ReasoningSection({
  text,
  isThinking,
  viewportRef
}: {
  text: string
  /** 是否正在流式思考中（= live-reasoning 且 turn 进行中） */
  isThinking: boolean
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement | null {
  const { t } = useTranslation('common')
  // 去掉思考开头的 ** ** 标题前缀（模型常把小标题写在思考里），对标 Codex Bh()
  const content = stripLeadingBoldTitle(text).trim()
  // 思考完才有内容才显示；思考中只要 preview 有字就显示
  const hasContent = isThinking ? !!content : !!text.trim()
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  // 思考中默认展开；完成后默认折叠
  const expanded = isThinking ? true : (userExpanded ?? false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 智能追尾：用户向上滚动查看历史时不打断（对标 Codex autoScrollToBottom 语义）
  const stickToBottomRef = useRef(true)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceToBottom < 24
  }

  // 思考中自动滚到底（流式追加），但用户主动上滚后不打断
  useEffect(() => {
    if (!isThinking || !stickToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, isThinking])

  if (!hasContent) return null

  const statusLabel = isThinking ? t('thinkingNow').replace(/…$/, '') : t('reasoningThought')
  const canCollapse = !isThinking

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => canCollapse && setUserExpanded(!expanded)}
        aria-expanded={expanded}
        className={`group flex w-fit max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[14px] font-medium transition ${
          canCollapse ? 'cursor-pointer hover:opacity-85' : 'cursor-default'
        } text-ds-muted`}
      >
        <span className={`tabular-nums ${isThinking ? 'ds-shiny-text' : ''}`}>{statusLabel}</span>
        {canCollapse ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
              strokeWidth={1.8}
            />
          )
        ) : null}
      </button>
      {expanded ? (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="ds-reasoning-fade mt-1 max-h-36 overflow-y-auto border-l-2 border-ds-border-muted/35 pl-3"
          style={{
            // 底部边缘渐隐，对标 Codex --edge-fade-distance
            WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
            maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)'
          }}
        >
          <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
            <AssistantMarkdown text={content} streaming={isThinking} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 去掉思考文本开头的 `**标题**` 前缀（对标 Codex Bh()）。
 * 模型常把小标题（如 **分析需求**）写在思考开头，展示时去掉更干净。
 */
function stripLeadingBoldTitle(text: string): string {
  const trimmed = text.trimStart()
  const match = trimmed.match(/^\*\*([^\n]*?)\*\*/)
  if (match) return trimmed.slice(match[0].length)
  // 未闭合的 ** 开头（流式中）：当作标题前缀，暂时不显示
  if (trimmed.startsWith('**')) return ''
  return trimmed
}
