/**
 * Tool-category classification + duration helpers for the process timeline.
 *
 * The L2 (execution-flow) layer groups consecutive tool calls by a coarse
 * semantic category (terminal / search / read / edit / write / web / other) so
 * the collapsed timeline reads as a sequence of typed action nodes (e.g.
 * "Ran 4 commands ∨", "Searched the web ∨") instead of a single flat batch.
 *
 * These are pure functions so they can be unit-tested in isolation.
 */

import type { ToolActivityKind, ToolBlock } from '../../agent/types'

export type ToolCategory =
  | 'terminal'
  | 'search'
  | 'read'
  | 'edit'
  | 'write'
  | 'web'
  | 'mcp'
  | 'dynamic'
  | 'multi-agent'
  | 'other'

const TOOL_ACTIVITY_KINDS: ReadonlySet<ToolActivityKind> = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'dynamic_tool_call',
  'multi_agent_action',
  'web_search',
  'generic_tool'
])

/** toolName (lowercased, trimmed) → category. `web` is decided by sources first. */
const TOOL_CATEGORY_BY_NAME: ReadonlyMap<string, ToolCategory> = new Map([
  // terminal: any shell/bash/exec command
  ['bash', 'terminal'],
  ['shell', 'terminal'],
  ['exec', 'terminal'],
  ['run', 'terminal'],
  ['run_command', 'terminal'],
  ['terminal', 'terminal'],
  // search: code/file search
  ['grep', 'search'],
  ['grep_files', 'search'],
  ['search_files', 'search'],
  ['search', 'search'],
  ['find', 'search'],
  ['rg', 'search'],
  // read: file/directory inspection without mutation
  ['read', 'read'],
  ['read_file', 'read'],
  ['cat', 'read'],
  ['ls', 'read'],
  ['list', 'read'],
  // edit: in-place mutation of existing files
  ['edit', 'edit'],
  ['edit_file', 'edit'],
  ['patch', 'edit'],
  // write: creating/overwriting files
  ['write', 'write'],
  ['write_file', 'write'],
  ['create', 'write'],
  // web tools are primarily identified by sources, but name them so a running
  // fetch (no sources yet) still groups under `web`.
  ['web_search', 'web'],
  ['web_fetch', 'web'],
  ['fetch', 'web']
])

/** toolNames that count as `web` even before sources arrive. */
const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch', 'fetch', 'browse', 'curl'])

export function classifyToolActivityKind(block: ToolBlock): ToolActivityKind {
  const explicit = normalizeActivityKind(block.activityKind) ?? normalizeActivityKind(block.meta?.activityKind)
  if (explicit) return explicit
  if (block.toolKind === 'command_execution') return 'command_execution'
  if (block.toolKind === 'file_change') return 'file_change'
  const meta = block.meta ?? {}
  if (hasMetaSources(meta)) return 'web_search'
  const toolName = readMetaString(meta, 'toolName') ?? extractToolName(block.summary)
  const normalized = toolName.trim().toLowerCase()
  if (WEB_TOOL_NAMES.has(normalized) || normalized.startsWith('web_')) return 'web_search'
  if (normalized.startsWith('mcp_') || normalized.includes('_mcp_')) return 'mcp_tool_call'
  if (normalized === 'delegate_task' || normalized.startsWith('delegate_')) return 'multi_agent_action'
  return 'generic_tool'
}

/**
 * Classify a tool block into one of 7 semantic categories. `web` is decided by
 * the presence of `meta.sources` first (so any tool returning web citations
 * groups under web regardless of its name); otherwise falls back to the
 * toolName → category map, then `other`.
 */
export function classifyToolCategory(block: ToolBlock): ToolCategory {
  switch (classifyToolActivityKind(block)) {
    case 'command_execution':
      return 'terminal'
    case 'file_change':
      return fileChangeCategory(block)
    case 'mcp_tool_call':
      return 'mcp'
    case 'dynamic_tool_call':
      return 'dynamic'
    case 'multi_agent_action':
      return 'multi-agent'
    case 'web_search':
      return 'web'
    case 'generic_tool':
      if (normalizeActivityKind(block.activityKind) || normalizeActivityKind(block.meta?.activityKind)) {
        return 'other'
      }
      break
    default:
      break
  }

  const meta = block.meta ?? {}
  // web: any tool returning web sources is a web action.
  if (hasMetaSources(meta)) return 'web'

  const toolName = readMetaString(meta, 'toolName') ?? extractToolName(block.summary)
  const normalized = toolName.trim().toLowerCase()
  if (!normalized) return 'other'
  // web tool names with no sources yet (still running) still group as web.
  if (WEB_TOOL_NAMES.has(normalized)) return 'web'
  return TOOL_CATEGORY_BY_NAME.get(normalized) ?? 'other'
}

function fileChangeCategory(block: ToolBlock): Extract<ToolCategory, 'edit' | 'write'> {
  const meta = block.meta ?? {}
  const toolName = readMetaString(meta, 'toolName') ?? extractToolName(block.summary)
  const normalized = toolName.trim().toLowerCase()
  return TOOL_CATEGORY_BY_NAME.get(normalized) === 'write' ? 'write' : 'edit'
}

/** lucide-react icon component name per category (imported by the renderer). */
export const CATEGORY_ICON: Record<ToolCategory, string> = {
  terminal: 'Terminal',
  search: 'SearchCode',
  read: 'FileText',
  edit: 'FileEdit',
  write: 'FilePlus',
  web: 'Globe',
  mcp: 'Cable',
  dynamic: 'Sparkles',
  'multi-agent': 'Network',
  other: 'Wrench'
}

/** i18n key for the collapsed L2 label of a category (takes {{count}}). */
export function categoryGroupKey(category: ToolCategory): string {
  switch (category) {
    case 'terminal':
      return 'groupTerminal'
    case 'search':
      return 'groupSearch'
    case 'read':
      return 'groupRead'
    case 'edit':
      return 'groupEdit'
    case 'write':
      return 'groupWrite'
    case 'web':
      return 'groupWeb'
    case 'mcp':
      return 'groupMcp'
    case 'dynamic':
      return 'groupDynamic'
    case 'multi-agent':
      return 'groupMultiAgent'
    default:
      return 'groupOther'
  }
}

/**
 * Duration of a single tool call in ms, computed from `meta.started_at` /
 * `meta.finished_at`. Returns 0 when either timestamp is missing or not a valid
 * number (the runtime does not always populate these for non-command tools).
 *
 * Both ISO strings and epoch-ms numbers are accepted; the mapper copies raw
 * runtime values through, so the format depends on the upstream payload.
 */
export function toolDurationMs(block: ToolBlock): number {
  const meta = block.meta ?? {}
  const started = toEpochMs(meta.started_at)
  const finished = toEpochMs(meta.finished_at)
  if (started === null || finished === null) return 0
  const delta = finished - started
  return delta > 0 ? delta : 0
}

/** Live duration for a still-running tool: started_at → now (epoch ms). */
export function toolRunningDurationMs(block: ToolBlock, now: number): number {
  const meta = block.meta ?? {}
  const started = toEpochMs(meta.started_at)
  if (started === null) return 0
  const delta = now - started
  return delta > 0 ? delta : 0
}

/** Exit code from a command-execution tool, or null when absent/non-numeric. */
export function toolExitCode(block: ToolBlock): number | null {
  const raw = block.meta?.exit_code
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Round a millisecond duration to whole seconds for display. */
export function roundSeconds(ms: number): number {
  return Math.round(ms / 1000)
}

// ---- internal helpers (re-implemented locally to keep this module pure) ----

function hasMetaSources(meta: Record<string, unknown>): boolean {
  const value = meta.sources
  if (!Array.isArray(value)) return false
  return value.some(
    (entry) => entry && typeof entry === 'object' &&
      (typeof (entry as Record<string, unknown>).url === 'string' ||
        typeof (entry as Record<string, unknown>).title === 'string')
  )
}

function readMetaString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeActivityKind(value: unknown): ToolActivityKind | undefined {
  return typeof value === 'string' && TOOL_ACTIVITY_KINDS.has(value as ToolActivityKind)
    ? value as ToolActivityKind
    : undefined
}

function extractToolName(summary: string): string {
  const match = summary.trim().match(/^([a-z0-9_-]+)\s*:/i)
  return match?.[1] ?? ''
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
    const asDate = Date.parse(value)
    if (Number.isFinite(asDate)) return asDate
  }
  return null
}
