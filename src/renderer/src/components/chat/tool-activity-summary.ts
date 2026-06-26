/**
 * Codex 风格的工具活动混合摘要（对标 toolActivitySummary / Ec 函数）。
 *
 * 把一个 turn 内的工具调用按操作类型统计，组装成一行多段摘要：
 *   "运行了 3 条命令 · 编辑了 2 个文件"
 *
 * 每段有 leading（首段，首字母大写）/ non-leading（续段，小写）两种形态，
 * 以及运行中态（"编辑中 1 个文件"）vs 完成态（"编辑了 2 个文件"）区分。
 * 纯函数，无 React 依赖，易单测。
 */
import type { ChatBlock } from '../../agent/types'
import { classifyToolCategory } from './tool-category'

export type ToolActivityStats = {
  commandCount: number
  runningCommandCount: number
  editedFileCount: number
  runningEditedFileCount: number
  createdFileCount: number
  runningCreatedFileCount: number
  deletedFileCount: 0
  webSearchCount: number
  loadedToolCount: 0
  readCount: number
  searchCount: number
}

export const EMPTY_TOOL_ACTIVITY: ToolActivityStats = {
  commandCount: 0,
  runningCommandCount: 0,
  editedFileCount: 0,
  runningEditedFileCount: 0,
  createdFileCount: 0,
  runningCreatedFileCount: 0,
  deletedFileCount: 0,
  webSearchCount: 0,
  loadedToolCount: 0,
  readCount: 0,
  searchCount: 0
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string

type Segment = {
  leadingKey: string
  nonLeadingKey: string
  runningLeadingKey?: string
  runningKey?: string
  count: number
  runningCount: number
}

/**
 * 统计一组 blocks 的工具活动。非 tool 块被忽略。
 *
 * 文件类操作（edit/write/read）使用 Set 去重：同一文件被多次编辑只算 1 个
 * editedFile（对标 Codex 的 path Set）。命令/搜索是计数（不去重）。
 * 分类复用 tool-category.ts 的 7 类映射。
 */
export function summarizeToolActivity(blocks: ChatBlock[]): ToolActivityStats {
  const editedPaths = new Set<string>()
  const runningEditedPaths = new Set<string>()
  const createdPaths = new Set<string>()
  const runningCreatedPaths = new Set<string>()
  const readPaths = new Set<string>()
  const stats: ToolActivityStats = { ...EMPTY_TOOL_ACTIVITY }
  for (const block of blocks) {
    if (block.kind !== 'tool') continue
    const category = classifyToolCategory(block)
    const isRunning = block.status === 'running'
    const filePath = block.filePath
    switch (category) {
      case 'terminal':
        stats.commandCount += 1
        if (isRunning) stats.runningCommandCount += 1
        break
      case 'edit':
        if (filePath) {
          editedPaths.add(filePath)
          if (isRunning) runningEditedPaths.add(filePath)
        } else {
          stats.editedFileCount += 1 // 无路径退化成计数
          if (isRunning) stats.runningEditedFileCount += 1
        }
        break
      case 'write':
        if (filePath) {
          createdPaths.add(filePath)
          if (isRunning) runningCreatedPaths.add(filePath)
        } else {
          stats.createdFileCount += 1
          if (isRunning) stats.runningCreatedFileCount += 1
        }
        break
      case 'read':
        if (filePath) readPaths.add(filePath)
        else stats.readCount += 1 // 无路径的 read 退化成计数
        break
      case 'search':
        stats.searchCount += 1
        break
      case 'web':
        stats.webSearchCount += 1
        break
      default:
        break
    }
  }
  stats.editedFileCount += editedPaths.size
  stats.runningEditedFileCount += runningEditedPaths.size
  stats.createdFileCount += createdPaths.size
  stats.runningCreatedFileCount += runningCreatedPaths.size
  stats.readCount += readPaths.size
  return stats
}

/**
 * 把统计组装成一行多段摘要（首段大写、续段小写、运行中态区分）。
 * 返回空串表示无活动。段顺序对标 Codex：commands → created → edited → web → read/search。
 */
export function formatToolActivitySummary(stats: ToolActivityStats, t: TFunc): string {
  const completedCommands = stats.commandCount - stats.runningCommandCount
  const completedEdited = stats.editedFileCount - stats.runningEditedFileCount
  const segments: Segment[] = [
    {
      leadingKey: 'toolActivitySummary.commands.leading',
      nonLeadingKey: 'toolActivitySummary.commands',
      runningLeadingKey: 'toolActivitySummary.commands.running.leading',
      runningKey: 'toolActivitySummary.commands.running',
      count: completedCommands,
      runningCount: stats.runningCommandCount
    },
    {
      leadingKey: 'toolActivitySummary.created.leading',
      nonLeadingKey: 'toolActivitySummary.created',
      runningLeadingKey: 'toolActivitySummary.creating.leading',
      runningKey: 'toolActivitySummary.creating',
      count: stats.createdFileCount - stats.runningCreatedFileCount,
      runningCount: stats.runningCreatedFileCount
    },
    {
      leadingKey: 'toolActivitySummary.edited.leading',
      nonLeadingKey: 'toolActivitySummary.edited',
      runningLeadingKey: 'toolActivitySummary.editing.leading',
      runningKey: 'toolActivitySummary.editing',
      count: completedEdited,
      runningCount: stats.runningEditedFileCount
    },
    {
      leadingKey: 'toolActivitySummary.webSearch.leading',
      nonLeadingKey: 'toolActivitySummary.webSearch',
      count: stats.webSearchCount,
      runningCount: 0
    },
    {
      leadingKey: 'toolActivitySummary.read.leading',
      nonLeadingKey: 'toolActivitySummary.read',
      count: stats.readCount,
      runningCount: 0
    },
    {
      leadingKey: 'toolActivitySummary.search.leading',
      nonLeadingKey: 'toolActivitySummary.search',
      count: stats.searchCount,
      runningCount: 0
    }
  ]

  const parts: string[] = []
  for (const seg of segments) {
    // 运行中段优先（若该类有正在运行的）
    if (seg.runningCount > 0 && seg.runningLeadingKey && seg.runningKey) {
      parts.push(
        t(parts.length === 0 ? seg.runningLeadingKey : seg.runningKey, { count: seg.runningCount })
      )
    }
    if (seg.count > 0) {
      parts.push(
        t(parts.length === 0 ? seg.leadingKey : seg.nonLeadingKey, { count: seg.count })
      )
    }
  }
  return parts.join(' · ')
}
