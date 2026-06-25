import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { groupProcessSections } from './message-timeline-process'

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

function reasoning(id: string, text = 'thinking'): ChatBlock {
  return { kind: 'reasoning', id, text }
}

describe('groupProcessSections — typed grouping', () => {
  it('merges consecutive same-category tool calls into one section', () => {
    const blocks: ChatBlock[] = [tool('r1', 'read'), tool('r2', 'read'), tool('r3', 'read')]
    const sections = groupProcessSections(blocks)
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('execution')
    expect(sections[0].category).toBe('read')
    expect(sections[0].blocks).toHaveLength(3)
  })

  it('breaks into separate sections when the category changes (preserves order)', () => {
    // read -> read -> edit -> read  =>  3 sections: read(2), edit(1), read(1)
    const blocks: ChatBlock[] = [
      tool('r1', 'read'),
      tool('r2', 'read'),
      tool('e1', 'edit'),
      tool('r3', 'read')
    ]
    const sections = groupProcessSections(blocks)
    expect(sections).toHaveLength(3)
    expect(sections.map((s) => s.category)).toEqual(['read', 'edit', 'read'])
    expect(sections[0].blocks).toHaveLength(2)
    expect(sections[1].blocks).toHaveLength(1)
    expect(sections[2].blocks).toHaveLength(1)
  })

  it('classifies web by sources regardless of toolName', () => {
    const blocks: ChatBlock[] = [
      tool('w1', 'some_custom', { meta: { toolName: 'some_custom', sources: [{ url: 'https://x' }] } })
    ]
    const sections = groupProcessSections(blocks)
    expect(sections[0].category).toBe('web')
  })

  it('groups terminal commands together', () => {
    const blocks: ChatBlock[] = [tool('b1', 'bash'), tool('b2', 'shell'), tool('b3', 'bash')]
    const sections = groupProcessSections(blocks)
    expect(sections).toHaveLength(1)
    expect(sections[0].category).toBe('terminal')
    expect(sections[0].blocks).toHaveLength(3)
  })

  it('groups reasoning blocks into their own section (separate from execution)', () => {
    const blocks: ChatBlock[] = [
      reasoning('re1'),
      tool('r1', 'read'),
      tool('r2', 'read'),
      reasoning('re2')
    ]
    const sections = groupProcessSections(blocks)
    // reasoning forms its own section; read tools merge into one execution section
    expect(sections.map((s) => s.kind)).toEqual(['reasoning', 'execution', 'reasoning'])
    expect(sections[1].category).toBe('read')
    expect(sections[1].blocks).toHaveLength(2)
  })

  it('merges consecutive reasoning blocks into one section', () => {
    const blocks: ChatBlock[] = [reasoning('re1'), reasoning('re2')]
    const sections = groupProcessSections(blocks)
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('reasoning')
    expect(sections[0].blocks).toHaveLength(2)
  })

  it('flags the last section keepExpanded when keepLatestLiveActivity and it has a running tool', () => {
    const blocks: ChatBlock[] = [
      tool('r1', 'read'),
      tool('r2', 'read'),
      tool('b1', 'bash', { status: 'running' })
    ]
    const sections = groupProcessSections(blocks, true)
    // read(2) merged, then terminal(1, running) — last section flagged
    expect(sections).toHaveLength(2)
    expect(sections[1].category).toBe('terminal')
    expect(sections[1].keepExpanded).toBe(true)
    // first (finished read) section NOT flagged
    expect(sections[0].keepExpanded).toBeUndefined()
  })

  it('does not flag keepExpanded when keepLatestLiveActivity is false', () => {
    const blocks: ChatBlock[] = [tool('b1', 'bash', { status: 'running' })]
    const sections = groupProcessSections(blocks, false)
    expect(sections[0].keepExpanded).toBeUndefined()
  })

  it('keeps non-tool execution blocks (approval) ungrouped by category', () => {
    const approval: ChatBlock = {
      kind: 'approval',
      id: 'appr_1',
      approvalId: 'appr_1',
      status: 'pending',
      toolName: 'edit',
      summary: 'Run edit'
    }
    const blocks: ChatBlock[] = [tool('r1', 'read'), approval]
    const sections = groupProcessSections(blocks)
    // read tool section, then approval section (no category)
    expect(sections).toHaveLength(2)
    expect(sections[0].category).toBe('read')
    expect(sections[1].category).toBeUndefined()
  })
})
