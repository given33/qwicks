import type { ReactElement } from 'react'
import { Brain, Sparkles, Search } from 'lucide-react'
import type { DreamTurnMemoryStatus } from '../store/chat-store-types'

/**
 * v3(差距1/2):回答级 Memory Sources 指示器。
 *
 * 从 chat store 的 memoryStatusByTurnId[turnId] 读取状态,渲染到 assistant message 旁。
 * 状态只显示抽象标志,不直接展示敏感内容(报告 §4.2 验收标准)。
 *
 * 挂载方式:在 MessageTimeline 的 assistant message 渲染处,
 * 传入该 message 对应的 turnId,组件自动从 store 查找并渲染。
 */
export function DreamMemoryStatusIndicator({
  status
}: {
  status: DreamTurnMemoryStatus | null | undefined
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
      {status.sources && status.sources.sourceIds.length > 0 && (
        <span className="text-zinc-500">
          ({status.sources.sourceIds.length} 个来源)
        </span>
      )}
    </div>
  )
}
