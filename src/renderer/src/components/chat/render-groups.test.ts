import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  classifyBlock,
  isCollapsible,
  splitByAssistantAnchors,
  summarizeActivity,
  createActivityAccumulator,
  accumulateActivity,
  projectActivitySummary
} from './render-groups'

function tool(id: string, toolName: string, overrides: Partial<ToolBlock> = {}): ChatBlock {
  return {
    kind: 'tool',
    id,
    summary: `${toolName}: x`,
    status: 'success',
    meta: { toolName },
    ...overrides
  } as ChatBlock
}
function assistant(id: string, text = 'reply'): ChatBlock {
  return { kind: 'assistant', id, text } as ChatBlock
}
function reasoning(id: string): ChatBlock {
  return { kind: 'reasoning', id, text: 'thinking...' } as ChatBlock
}

describe('classifyBlock', () => {
  it('classifies assistant as assistant-message (anchor)', () => {
    expect(classifyBlock(assistant('a1')).type).toBe('assistant-message')
  })
  it('classifies reasoning as other (not collapsible)', () => {
    expect(classifyBlock(reasoning('r1')).type).toBe('other')
  })
  it('classifies terminal tool as exec', () => {
    expect(classifyBlock(tool('t1', 'bash')).type).toBe('exec')
  })
  it('classifies edit tool as patch', () => {
    expect(classifyBlock(tool('e1', 'edit', { toolKind: 'file_change' })).type).toBe('patch')
  })
  it('classifies write tool as patch', () => {
    expect(classifyBlock(tool('w1', 'write', { toolKind: 'file_change' })).type).toBe('patch')
  })
  it('classifies read tool as read', () => {
    expect(classifyBlock(tool('rd1', 'read_file')).type).toBe('read')
  })
  it('classifies web tool as web', () => {
    expect(classifyBlock(tool('ws1', 'web_search')).type).toBe('web')
  })
  it('tracks running status', () => {
    expect(classifyBlock(tool('t1', 'bash', { status: 'running' })).isRunning).toBe(true)
    expect(classifyBlock(tool('t2', 'bash', { status: 'success' })).isRunning).toBe(false)
  })
})

describe('isCollapsible', () => {
  it('collapsible: exec/patch/read/web', () => {
    expect(isCollapsible(classifyBlock(tool('t1', 'bash')))).toBe(true)
    expect(isCollapsible(classifyBlock(tool('e1', 'edit', { toolKind: 'file_change' })))).toBe(true)
    expect(isCollapsible(classifyBlock(tool('rd1', 'read_file')))).toBe(true)
    expect(isCollapsible(classifyBlock(tool('ws1', 'web_search')))).toBe(true)
  })
  it('not collapsible: assistant-message/other', () => {
    expect(isCollapsible(classifyBlock(assistant('a1')))).toBe(false)
    expect(isCollapsible(classifyBlock(reasoning('r1')))).toBe(false)
  })
})

describe('splitByAssistantAnchors', () => {
  it('no anchor + closed = single whole slice', () => {
    const blocks = [tool('t1', 'bash'), tool('t2', 'bash')]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, true)
    expect(slices).toEqual([{ startIndex: 0, endIndex: 2, isCurrentActivity: false }])
  })

  it('no anchor + not closed = empty (turn in progress, no reply yet)', () => {
    const blocks = [tool('t1', 'bash')]
    const classified = blocks.map(classifyBlock)
    expect(splitByAssistantAnchors(classified, false)).toEqual([])
  })

  it('single anchor splits into one slice after it', () => {
    const blocks = [assistant('a1'), tool('t1', 'bash'), tool('t2', 'bash')]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, true)
    expect(slices).toEqual([{ startIndex: 1, endIndex: 3, isCurrentActivity: false }])
  })

  it('multiple anchors split into segments between them', () => {
    const blocks = [
      assistant('a1'),
      tool('t1', 'bash'),
      assistant('a2'),
      tool('e1', 'edit', { toolKind: 'file_change' }),
      tool('e2', 'edit', { toolKind: 'file_change' })
    ]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, true)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toMatchObject({ startIndex: 1, endIndex: 2 })
    expect(slices[1]).toMatchObject({ startIndex: 3, endIndex: 5 })
  })

  it('last slice is current activity when not closed', () => {
    const blocks = [assistant('a1'), tool('t1', 'bash')]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, false)
    expect(slices[0].isCurrentActivity).toBe(true)
  })

  it('last slice is NOT current activity when closed', () => {
    const blocks = [assistant('a1'), tool('t1', 'bash')]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, true)
    expect(slices[0].isCurrentActivity).toBe(false)
  })

  it('skips empty segments (adjacent anchors)', () => {
    const blocks = [assistant('a1'), assistant('a2'), tool('t1', 'bash')]
    const classified = blocks.map(classifyBlock)
    const slices = splitByAssistantAnchors(classified, true)
    // a1->a2 is empty (skipped); a2->end has the tool
    expect(slices).toHaveLength(1)
    expect(slices[0].startIndex).toBe(2)
  })
})

describe('summarizeActivity (Set dedup)', () => {
  it('counts commands and web searches', () => {
    const units = [tool('b1', 'bash'), tool('b2', 'bash'), tool('ws1', 'web_search')].map(classifyBlock)
    const stats = summarizeActivity(units)
    expect(stats.commandCount).toBe(2)
    expect(stats.webSearchCount).toBe(1)
  })

  it('dedupes edited file paths (same file edited twice = 1)', () => {
    const units = [
      tool('e1', 'edit', { toolKind: 'file_change', filePath: 'src/a.ts' }),
      tool('e2', 'edit', { toolKind: 'file_change', filePath: 'src/a.ts' }),
      tool('e3', 'edit', { toolKind: 'file_change', filePath: 'src/b.ts' })
    ].map(classifyBlock)
    const stats = summarizeActivity(units)
    expect(stats.editedFileCount).toBe(2) // 2 unique paths, not 3 calls
  })

  it('tracks running counts separately', () => {
    const units = [
      tool('b1', 'bash', { status: 'running' }),
      tool('b2', 'bash'),
      tool('e1', 'edit', { toolKind: 'file_change', status: 'running', filePath: 'x.ts' }),
      tool('e2', 'edit', { toolKind: 'file_change', filePath: 'x.ts' })
    ].map(classifyBlock)
    const stats = summarizeActivity(units)
    expect(stats.runningCommandCount).toBe(1)
    expect(stats.commandCount).toBe(2)
    expect(stats.runningEditedFileCount).toBe(1)
    expect(stats.editedFileCount).toBe(1)
  })

  it('dedupes read paths', () => {
    const units = [
      tool('r1', 'read_file', { filePath: 'src/a.ts' }),
      tool('r2', 'read_file', { filePath: 'src/a.ts' })
    ].map(classifyBlock)
    expect(summarizeActivity(units).readCount).toBe(1)
  })

  it('distinguishes write (created) from edit (edited)', () => {
    const units = [
      tool('w1', 'write', { toolKind: 'file_change', filePath: 'new.ts' }),
      tool('e1', 'edit', { toolKind: 'file_change', filePath: 'old.ts' })
    ].map(classifyBlock)
    const stats = summarizeActivity(units)
    expect(stats.createdFileCount).toBe(1)
    expect(stats.editedFileCount).toBe(1)
  })

  it('empty accumulator projects to all zeros', () => {
    expect(projectActivitySummary(createActivityAccumulator())).toEqual({
      commandCount: 0,
      runningCommandCount: 0,
      editedFileCount: 0,
      runningEditedFileCount: 0,
      createdFileCount: 0,
      createdLineCount: 0,
      runningCreatedFileCount: 0,
      readCount: 0,
      runningReadCount: 0,
      webSearchCount: 0,
      runningWebSearchCount: 0
    })
  })

  it('accumulateActivity is incremental (matches summarize)', () => {
    const units = [tool('b1', 'bash'), tool('e1', 'edit', { toolKind: 'file_change', filePath: 'a.ts' })].map(
      classifyBlock
    )
    const acc = createActivityAccumulator()
    accumulateActivity(acc, units[0])
    accumulateActivity(acc, units[1])
    expect(projectActivitySummary(acc)).toEqual(summarizeActivity(units))
  })
})
