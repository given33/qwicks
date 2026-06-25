import type { ReactElement } from 'react'
import { Check, ChevronDown, ChevronRight, Ban } from 'lucide-react'

/**
 * v3(差距1, Batch C §3.2):回答级 Memory Sources 面板。
 *
 * DreamMemoryStatusIndicator 在有来源时渲染本组件。消费 chat store 的
 * DreamTurnMemoryStatus.sources(usedMemoryIds / downrankedMemoryIds /
 * suppressedMemoryIds / sourceIds),按桶展示计数 + 记忆 id。
 *
 * - 共享聊天视图(isSharedView)整体不渲染(对齐 OpenAI FAQ:分享不含 Memory Sources)。
 * - 仅展示抽象标志 + id,不直接展示敏感 source 内容(报告 §4.2 验收标准)。
 *   逐条 sourceText / reason / 操作按钮等 ledger 富数据落地后,本组件可扩展。
 * - 使用 <details> 原生折叠(DOM-native),无需 React state —— 兼容测试直接函数调用。
 */
export interface MemorySourcesPanelSources {
  usedMemoryIds: string[]
  downrankedMemoryIds: string[]
  suppressedMemoryIds: string[]
  sourceIds: string[]
}

export function MemorySourcesPanel({
  sources,
  isSharedView
}: {
  sources: MemorySourcesPanelSources
  isSharedView: boolean
}): ReactElement | null {
  // 共享视图下整体不渲染(spec §3.2)。
  if (isSharedView) return null

  const hasAny =
    sources.usedMemoryIds.length > 0 ||
    sources.downrankedMemoryIds.length > 0 ||
    sources.suppressedMemoryIds.length > 0
  if (!hasAny) {
    return (
      <div className="mt-1 rounded-lg border border-ds-border-muted bg-ds-bg-secondary px-3 py-2 text-[12px] text-ds-muted">
        这条回答没有用到记忆来源。
      </div>
    )
  }

  return (
    <details className="mt-1 rounded-lg border border-ds-border-muted bg-ds-bg-secondary px-3 py-2 text-[12px] text-ds-muted">
      <summary className="cursor-pointer select-none text-ds-muted hover:text-ds-ink transition">
        记忆来源详情
      </summary>
      <div className="mt-1">
        <Section label="已采用" icon={<Check size={12} className="text-emerald-500" />} ids={sources.usedMemoryIds} defaultOpen />
        <Section label="已降权" icon={<ChevronDown size={12} className="text-amber-500" />} ids={sources.downrankedMemoryIds} />
        <Section label="已过滤" icon={<Ban size={12} className="text-rose-500" />} ids={sources.suppressedMemoryIds} />
      </div>
    </details>
  )
}

function Section({
  label,
  icon,
  ids,
  defaultOpen = false
}: {
  label: string
  icon: ReactElement
  ids: string[]
  defaultOpen?: boolean
}): ReactElement | null {
  if (ids.length === 0) return null
  return (
    <details open={defaultOpen} className="py-0.5">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-ds-muted hover:text-ds-ink transition">
        <ChevronRight size={12} />
        {icon}
        <span className="font-medium">{label}</span>
        <span className="text-ds-faint">({ids.length})</span>
      </summary>
      <ul className="ml-5 mt-0.5 space-y-0.5">
        {ids.map((id) => (
          <li key={id} className="truncate text-ds-faint">
            {id}
          </li>
        ))}
      </ul>
    </details>
  )
}
