import type { ReactElement } from 'react'
import { Brain, Sparkles, Search } from 'lucide-react'

/**
 * v3(CHIEF P0-3 报告二轮 §4.3/§13):回答级 Memory Sources 指示器。
 *
 * 消费 memory_status SSE 事件,在 assistant message 旁显示轻量状态:
 * - 🧠 remembering:本次回答使用了记忆上下文
 * - ✨ personalizing:注入了个性化记忆
 * - 🔍 rewrittenQueryFromMemory:搜索查询基于记忆优化
 *
 * 状态只显示抽象标志,不直接展示敏感内容(报告 §4.2 验收标准)。
 */
export interface DreamMemoryStatus {
  remembering: boolean
  personalizing: boolean
  memorySourcesUsed: string[]
  rewrittenQueryFromMemory: boolean
}

export function DreamMemoryStatusIndicator({
  status
}: {
  status: DreamMemoryStatus | null
}): ReactElement | null {
  if (!status) return null
  // 无记忆时不显示(报告 §4.2:无记忆/Temporary/opt-out 不显示)
  if (!status.remembering && !status.personalizing && !status.rewrittenQueryFromMemory) {
    return null
  }

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
      {status.remembering && (
        <span className="flex items-center gap-1" title="本次回答使用了记忆上下文">
          <Brain size={12} className="text-sky-400" />
          记忆
        </span>
      )}
      {status.personalizing && (
        <span className="flex items-center gap-1" title="注入了个性化记忆">
          <Sparkles size={12} className="text-violet-400" />
          个性化
        </span>
      )}
      {status.rewrittenQueryFromMemory && (
        <span className="flex items-center gap-1" title="搜索查询已根据记忆优化">
          <Search size={12} className="text-emerald-400" />
          查询优化
        </span>
      )}
      {status.memorySourcesUsed.length > 0 && (
        <span className="text-zinc-500">
          ({status.memorySourcesUsed.length} 个来源)
        </span>
      )}
    </div>
  )
}
