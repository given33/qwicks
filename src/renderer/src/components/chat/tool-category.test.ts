import { describe, expect, it } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import {
  classifyToolCategory,
  categoryGroupKey,
  toolDurationMs,
  toolRunningDurationMs,
  toolExitCode,
  roundSeconds
} from './tool-category'

function tool(overrides: Partial<ToolBlock> & { meta?: Record<string, unknown> }): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    ...overrides
  }
}

describe('classifyToolCategory', () => {
  it('classifies terminal commands by toolName', () => {
    expect(classifyToolCategory(tool({ summary: 'bash: x', meta: { toolName: 'bash' } }))).toBe('terminal')
    expect(classifyToolCategory(tool({ meta: { toolName: 'shell' } }))).toBe('terminal')
    expect(classifyToolCategory(tool({ meta: { toolName: 'exec' } }))).toBe('terminal')
    expect(classifyToolCategory(tool({ meta: { toolName: 'run_command' } }))).toBe('terminal')
  })

  it('classifies search tools', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'grep' } }))).toBe('search')
    expect(classifyToolCategory(tool({ meta: { toolName: 'find' } }))).toBe('search')
    expect(classifyToolCategory(tool({ meta: { toolName: 'rg' } }))).toBe('search')
    expect(classifyToolCategory(tool({ meta: { toolName: 'search_files' } }))).toBe('search')
  })

  it('classifies read tools', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'read' } }))).toBe('read')
    expect(classifyToolCategory(tool({ meta: { toolName: 'read_file' } }))).toBe('read')
    expect(classifyToolCategory(tool({ meta: { toolName: 'ls' } }))).toBe('read')
    expect(classifyToolCategory(tool({ meta: { toolName: 'cat' } }))).toBe('read')
  })

  it('classifies edit vs write distinctly', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'edit' } }))).toBe('edit')
    expect(classifyToolCategory(tool({ meta: { toolName: 'edit_file' } }))).toBe('edit')
    expect(classifyToolCategory(tool({ meta: { toolName: 'patch' } }))).toBe('edit')
    expect(classifyToolCategory(tool({ meta: { toolName: 'write' } }))).toBe('write')
    expect(classifyToolCategory(tool({ meta: { toolName: 'write_file' } }))).toBe('write')
    expect(classifyToolCategory(tool({ meta: { toolName: 'create' } }))).toBe('write')
  })

  it('classifies web by sources first, regardless of toolName', () => {
    expect(
      classifyToolCategory(
        tool({
          summary: 'fetch: docs',
          meta: { toolName: 'fetch', sources: [{ url: 'https://example.com' }] }
        })
      )
    ).toBe('web')
    // Even a tool that would otherwise be `other` becomes web when it has sources.
    expect(
      classifyToolCategory(
        tool({
          meta: { toolName: 'some_custom_tool', sources: [{ title: 'A page' }] }
        })
      )
    ).toBe('web')
  })

  it('classifies web tool names without sources as web (still running)', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'web_search' } }))).toBe('web')
    expect(classifyToolCategory(tool({ meta: { toolName: 'web_fetch' } }))).toBe('web')
    expect(classifyToolCategory(tool({ meta: { toolName: 'fetch' } }))).toBe('web')
  })

  it('falls back to other for unknown tool names', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'recognize_image' } }))).toBe('other')
    expect(classifyToolCategory(tool({ summary: 'no toolName here', meta: {} }))).toBe('other')
  })

  it('is case-insensitive on toolName', () => {
    expect(classifyToolCategory(tool({ meta: { toolName: 'BASH' } }))).toBe('terminal')
    expect(classifyToolCategory(tool({ meta: { toolName: 'Read_File' } }))).toBe('read')
  })

  it('derives toolName from the summary prefix when meta.toolName is absent', () => {
    expect(classifyToolCategory(tool({ summary: 'grep: needle' }))).toBe('search')
    expect(classifyToolCategory(tool({ summary: 'bash: npm test' }))).toBe('terminal')
  })
})

describe('categoryGroupKey', () => {
  it('maps each category to a distinct i18n key', () => {
    expect(categoryGroupKey('terminal')).toBe('groupTerminal')
    expect(categoryGroupKey('search')).toBe('groupSearch')
    expect(categoryGroupKey('read')).toBe('groupRead')
    expect(categoryGroupKey('edit')).toBe('groupEdit')
    expect(categoryGroupKey('write')).toBe('groupWrite')
    expect(categoryGroupKey('web')).toBe('groupWeb')
    expect(categoryGroupKey('other')).toBe('groupOther')
  })
})

describe('toolDurationMs', () => {
  it('computes the delta from epoch-ms timestamps', () => {
    expect(toolDurationMs(tool({ meta: { started_at: 1000, finished_at: 2500 } }))).toBe(1500)
  })

  it('computes the delta from ISO strings', () => {
    expect(
      toolDurationMs(
        tool({
          meta: {
            started_at: '2026-06-25T00:00:00.000Z',
            finished_at: '2026-06-25T00:00:02.500Z'
          }
        })
      )
    ).toBe(2500)
  })

  it('returns 0 when timestamps are missing', () => {
    expect(toolDurationMs(tool({ meta: {} }))).toBe(0)
    expect(toolDurationMs(tool({ meta: { started_at: 1000 } }))).toBe(0)
    expect(toolDurationMs(tool({ meta: { finished_at: 1000 } }))).toBe(0)
  })

  it('returns 0 when finished is not after started', () => {
    expect(toolDurationMs(tool({ meta: { started_at: 2500, finished_at: 1000 } }))).toBe(0)
  })
})

describe('toolRunningDurationMs', () => {
  it('computes started_at → now', () => {
    expect(toolRunningDurationMs(tool({ meta: { started_at: 1000 } }), 5000)).toBe(4000)
  })

  it('returns 0 when started_at is missing', () => {
    expect(toolRunningDurationMs(tool({ meta: {} }), 5000)).toBe(0)
  })
})

describe('toolExitCode', () => {
  it('reads numeric exit codes', () => {
    expect(toolExitCode(tool({ meta: { exit_code: 0 } }))).toBe(0)
    expect(toolExitCode(tool({ meta: { exit_code: 127 } }))).toBe(127)
  })

  it('parses string exit codes', () => {
    expect(toolExitCode(tool({ meta: { exit_code: '2' } }))).toBe(2)
  })

  it('returns null when absent', () => {
    expect(toolExitCode(tool({ meta: {} }))).toBeNull()
    expect(toolExitCode(tool({ meta: { exit_code: 'abc' } }))).toBeNull()
  })
})

describe('roundSeconds', () => {
  it('rounds milliseconds to whole seconds', () => {
    expect(roundSeconds(1500)).toBe(2)
    expect(roundSeconds(1499)).toBe(1)
    expect(roundSeconds(0)).toBe(0)
    expect(roundSeconds(60_000)).toBe(60)
  })
})
