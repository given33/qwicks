import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { summarizeToolActivity, formatToolActivitySummary } from './tool-activity-summary'

function tool(id: string, toolName: string, overrides: Partial<ToolBlock> = {}): ToolBlock {
  return {
    kind: 'tool',
    id,
    summary: `${toolName}: x`,
    status: 'success',
    meta: { toolName },
    ...overrides
  }
}

// Fake t() that returns the i18n key + interpolation so tests assert structure.
const t = vi.fn((key: string, opts?: Record<string, unknown>) => {
  const count = opts?.count
  return `${key}:${count ?? ''}`
})

describe('summarizeToolActivity', () => {
  it('counts commands, edits, creates, web by category', () => {
    const blocks: ChatBlock[] = [
      tool('b1', 'bash'),
      tool('b2', 'shell'),
      tool('b3', 'bash'),
      tool('e1', 'edit', { toolKind: 'file_change' }),
      tool('e2', 'edit', { toolKind: 'file_change' }),
      tool('w1', 'write', { toolKind: 'file_change' }),
      tool('ws1', 'web_search', { meta: { toolName: 'web_search', sources: [{ url: 'https://x' }] } })
    ]
    const stats = summarizeToolActivity(blocks)
    expect(stats.commandCount).toBe(3)
    expect(stats.editedFileCount).toBe(2)
    expect(stats.createdFileCount).toBe(1)
    expect(stats.webSearchCount).toBe(1)
  })

  it('tracks running counts separately', () => {
    const blocks: ChatBlock[] = [
      tool('b1', 'bash', { status: 'running' }),
      tool('b2', 'bash'),
      tool('e1', 'edit', { toolKind: 'file_change', status: 'running' })
    ]
    const stats = summarizeToolActivity(blocks)
    expect(stats.commandCount).toBe(2)
    expect(stats.runningCommandCount).toBe(1)
    expect(stats.editedFileCount).toBe(1)
    expect(stats.runningEditedFileCount).toBe(1)
  })

  it('ignores non-tool blocks', () => {
    const blocks: ChatBlock[] = [
      { kind: 'reasoning', id: 'r1', text: 'thinking' },
      { kind: 'assistant', id: 'a1', text: 'hi' }
    ]
    expect(summarizeToolActivity(blocks)).toEqual({
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
    })
  })

  it('dedupes edited file paths (same file twice = 1)', () => {
    const blocks: ChatBlock[] = [
      tool('e1', 'edit', { toolKind: 'file_change', filePath: 'src/a.ts' }),
      tool('e2', 'edit', { toolKind: 'file_change', filePath: 'src/a.ts' })
    ]
    expect(summarizeToolActivity(blocks).editedFileCount).toBe(1)
  })

  it('tracks running created file count', () => {
    const blocks: ChatBlock[] = [
      tool('w1', 'write', { toolKind: 'file_change', filePath: 'new.ts', status: 'running' })
    ]
    const stats = summarizeToolActivity(blocks)
    expect(stats.createdFileCount).toBe(1)
    expect(stats.runningCreatedFileCount).toBe(1)
  })
})

describe('formatToolActivitySummary', () => {
  it('builds a leading + non-leading multi-segment line', () => {
    const stats = summarizeToolActivity([
      tool('b1', 'bash'),
      tool('b2', 'bash'),
      tool('e1', 'edit', { toolKind: 'file_change' })
    ])
    const line = formatToolActivitySummary(stats, t)
    // first segment uses .leading key, second uses non-leading
    expect(t).toHaveBeenCalledWith(
      'toolActivitySummary.commands.leading',
      expect.objectContaining({ count: 2 })
    )
    expect(t).toHaveBeenCalledWith(
      'toolActivitySummary.edited',
      expect.objectContaining({ count: 1 })
    )
    expect(line).toContain('toolActivitySummary.commands.leading:2')
    expect(line).toContain('toolActivitySummary.edited:1')
    expect(line).toContain(' · ')
  })

  it('returns empty string when nothing happened', () => {
    expect(formatToolActivitySummary(summarizeToolActivity([]), t)).toBe('')
  })

  it('uses running form for still-active segments', () => {
    const stats = summarizeToolActivity([
      tool('b1', 'bash', { status: 'running' }),
      tool('b2', 'bash')
    ])
    formatToolActivitySummary(stats, t)
    expect(t).toHaveBeenCalledWith(
      'toolActivitySummary.commands.running.leading',
      expect.objectContaining({ count: 1 })
    )
  })
})
