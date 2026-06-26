import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  classifyBlock,
  isCollapsible,
  splitByAssistantAnchors
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
