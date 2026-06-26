/**
 * Codex 风格的渲染分组决策树（对标 split-items-into-render-groups.tsx）。
 *
 * 四阶段管道：
 *  1. 分类器（对标 Ve）：把 ChatBlock 分类为 assistant-message / exec / patch /
 *     read / web / other。
 *  2. 锚点切分（对标 Lt）：用 assistant-message 当锚点，切出"工具活动段"。
 *  3. 摘要累积（对标 zt/Bt/Vt）：Set 去重的路径统计 + 命令/搜索计数。
 *  4. 管道组装（对标 tn）：合并连续可折叠 item 成 collapsed-tool-activity；
 *     detail level 控制单个 exec 是否折叠；turn 进行中最新活动区展开。
 *
 * 纯函数，无 React 依赖，易单测。
 */
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { classifyToolCategory, type ToolCategory } from './tool-category'

/** 分类后的活动类型（对标 Codex 的 classified.type）。 */
export type RenderActivityType =
  | 'assistant-message'
  | 'exec'
  | 'patch'
  | 'read'
  | 'web'
  | 'other'

/** 单个 block 的分类结果（对标 Ve 返回值，简化版）。 */
export type ClassifiedUnit = {
  block: ChatBlock
  type: RenderActivityType
  isRunning: boolean
  /** 文件路径（patch/exec 用于摘要去重）。 */
  filePath?: string
  /** 工具分类细分（terminal/edit/write/read/search/web）。 */
  category?: ToolCategory
}

/** 详情级别（对标 conversationDetailLevel，简化为 2 级）。 */
export type DetailLevel = 'STEPS_PROSE' | 'DETAILED'

/** 一个"工具活动段"（锚点之间的可折叠群）。 */
export type ActivitySlice = {
  startIndex: number
  endIndex: number
  /** 该段是否是 turn 进行中的"当前活动区"（最后一个段 + 未关闭）。 */
  isCurrentActivity: boolean
}

/**
 * 分类器（对标 Ve）。把单个 ChatBlock 转成 ClassifiedUnit。
 */
export function classifyBlock(block: ChatBlock): ClassifiedUnit {
  if (block.kind === 'assistant') {
    return { block, type: 'assistant-message', isRunning: false }
  }
  if (block.kind === 'reasoning') {
    return { block, type: 'other', isRunning: false }
  }
  if (block.kind === 'compaction') {
    return { block, type: 'other', isRunning: false }
  }
  // tool block — 按 tool-category 细分
  const category = classifyToolCategory(block as ToolBlock)
  const isRunning = (block as ToolBlock).status === 'running'
  const filePath = (block as ToolBlock).filePath
  switch (category) {
    case 'terminal':
      return { block, type: 'exec', isRunning, filePath, category }
    case 'edit':
      return { block, type: 'patch', isRunning, filePath, category }
    case 'write':
      return { block, type: 'patch', isRunning, filePath, category }
    case 'read':
      return { block, type: 'read', isRunning, filePath, category }
    case 'search':
      return { block, type: 'read', isRunning, filePath, category }
    case 'web':
      return { block, type: 'web', isRunning, filePath, category }
    default:
      return { block, type: 'exec', isRunning, filePath, category }
  }
}

/**
 * 是否可折叠（对标 Rt）。exec/patch/read/web 可折叠；
 * assistant-message/other 不可折叠（它们是独立的展示单元）。
 */
export function isCollapsible(unit: ClassifiedUnit): boolean {
  return (
    unit.type === 'exec' ||
    unit.type === 'patch' ||
    unit.type === 'read' ||
    unit.type === 'web'
  )
}

/**
 * 锚点切分（对标 Lt）。用 assistant-message 索引当锚点，切出每两个锚点之间的
 * "工具活动段"。assistant-message 本身不进任何段。
 *
 * - 无锚点 + isClosed：整段作为一个活动段。
 * - 无锚点 + 未关闭：返回空（turn 还在进行，尚未有 assistant 回复）。
 * - 有锚点：每个锚点之后到下一个锚点之前为一个段（跳过空段）。
 *
 * @param classified 已分类的 units
 * @param isActivitySliceClosed turn 是否结束（closed = 已完成，不会再追加）
 */
export function splitByAssistantAnchors(
  classified: ClassifiedUnit[],
  isActivitySliceClosed: boolean
): ActivitySlice[] {
  const anchorIndices: number[] = []
  for (const [i, unit] of classified.entries()) {
    if (unit.type === 'assistant-message') anchorIndices.push(i)
  }

  // 无锚点：closed 则整段一个活动段，否则空
  if (anchorIndices.length === 0) {
    return isActivitySliceClosed && classified.length > 0
      ? [{ startIndex: 0, endIndex: classified.length, isCurrentActivity: false }]
      : []
  }

  const slices: ActivitySlice[] = []
  for (const [anchorOrdinal, anchorIdx] of anchorIndices.entries()) {
    const isLastAnchor = anchorOrdinal === anchorIndices.length - 1
    // 最后一个锚点之后的"尾部"：closed 则延伸到数组末尾；未关闭也延伸到末尾
    // （这就是"当前活动区"——turn 还在进行，工具正在跑）。
    const nextAnchor = anchorIndices[anchorOrdinal + 1] ?? (isLastAnchor ? classified.length : null)
    // 非最后一个锚点且 nextAnchor 不存在（不该发生，防御）→ 跳过
    if (nextAnchor == null) continue
    // 段 = 锚点之后到下一个锚点之前；跳过空段（锚点紧邻）
    if (anchorIdx + 1 >= nextAnchor) continue
    slices.push({
      startIndex: anchorIdx + 1,
      endIndex: nextAnchor,
      // 最后一个段 + 未关闭 = 当前活动区（对标 tn 的 isCurrentToolActivity）
      isCurrentActivity: isLastAnchor && !isActivitySliceClosed
    })
  }
  return slices
}
