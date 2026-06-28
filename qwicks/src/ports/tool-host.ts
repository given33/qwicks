import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { ApprovalRequest } from '../domain/approval.js'
import type {
  ToolActionType,
  ToolActivityKind,
  ToolCategory,
  ToolProviderKind,
  TurnItem
} from '../contracts/items.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type {
  UserInputRequest,
  UserInputResolution
} from './user-input-gate.js'

const DYNAMIC_TOOL_PROVIDER_KINDS = new Set<ToolProviderKind>([
  'skill',
  'memory',
  'gui',
  'image',
  'audio',
  'video'
])

const COMMAND_TOOL_NAMES = new Set(['shell', 'bash', 'terminal', 'run_command', 'exec'])
const FILE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'write_file',
  'read_file',
  'edit_file',
  'apply_patch',
  'create_file',
  'create_plan'
])
const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch', 'search_web'])

export function inferToolActivityKind(input: {
  activityKind?: ToolActivityKind
  providerKind?: ToolProviderKind
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  toolName?: string
}): ToolActivityKind {
  if (input.activityKind) return input.activityKind
  if (input.providerKind === 'web') return 'web_search'
  if (input.providerKind === 'mcp') return 'mcp_tool_call'
  if (input.providerKind === 'delegation') return 'multi_agent_action'
  if (input.providerKind && DYNAMIC_TOOL_PROVIDER_KINDS.has(input.providerKind)) return 'dynamic_tool_call'
  if (input.toolKind === 'command_execution') return 'command_execution'
  if (input.toolKind === 'file_change') return 'file_change'
  const toolName = input.toolName?.trim().toLowerCase() ?? ''
  if (COMMAND_TOOL_NAMES.has(toolName)) return 'command_execution'
  if (FILE_TOOL_NAMES.has(toolName)) return 'file_change'
  if (WEB_TOOL_NAMES.has(toolName) || toolName.startsWith('web_')) return 'web_search'
  if (toolName.startsWith('mcp_')) return 'mcp_tool_call'
  if (toolName === 'delegate_task' || toolName.startsWith('delegate_')) return 'multi_agent_action'
  if (
    toolName.includes('image') ||
    toolName.includes('audio') ||
    toolName.includes('video') ||
    toolName.includes('speech') ||
    toolName.includes('computer')
  ) {
    return 'dynamic_tool_call'
  }
  return 'generic_tool'
}

export function inferToolCategory(input: {
  activityKind?: ToolActivityKind
  providerKind?: ToolProviderKind
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  toolName?: string
}): ToolCategory {
  const activityKind = inferToolActivityKind(input)
  switch (activityKind) {
    case 'command_execution':
      return 'command'
    case 'file_change':
      return 'file'
    case 'mcp_tool_call':
      return 'mcp'
    case 'dynamic_tool_call':
      return 'dynamic'
    case 'multi_agent_action':
      return 'multi_agent'
    case 'web_search':
      return 'web'
    default:
      return 'generic'
  }
}

export function inferToolActionType(input: {
  providerKind?: ToolProviderKind
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  toolName?: string
}): ToolActionType {
  if (input.providerKind === 'delegation') return 'delegate'
  if (input.providerKind === 'web') return 'search'
  if (input.toolKind === 'command_execution') return 'execute'
  if (input.toolKind === 'file_change') {
    const toolName = input.toolName?.trim().toLowerCase() ?? ''
    return toolName.includes('write') || toolName.includes('create') ? 'write' : 'edit'
  }
  const toolName = input.toolName?.trim().toLowerCase() ?? ''
  if (toolName === 'delegate_task' || toolName.startsWith('delegate_')) return 'delegate'
  if (toolName === 'grep' || toolName === 'find' || toolName.includes('search')) return 'search'
  if (toolName === 'ls' || toolName.includes('list')) return 'list_files'
  if (toolName === 'read' || toolName.includes('read')) return 'read'
  if (toolName.includes('write') || toolName.includes('create')) return 'write'
  if (toolName.includes('edit') || toolName.includes('patch')) return 'edit'
  if (toolName.startsWith('web_') || WEB_TOOL_NAMES.has(toolName)) return 'search'
  if (
    toolName.includes('image') ||
    toolName.includes('audio') ||
    toolName.includes('video') ||
    toolName.includes('speech') ||
    toolName.includes('music')
  ) {
    return 'generate'
  }
  return 'call'
}

export type ToolProviderPolicy = {
  id: string
  kind: ToolProviderKind
  enabled: boolean
  available: boolean
  reason?: string
}

/**
 * Optional GUI plan context advertised by the renderer when starting
 * draft or refine plan turns. When present, QWicks exposes the
 * `create_plan` tool to the model and gates the corresponding tool
 * adapter to this exact path/workspace. The struct is stable across
 * reconnects so replays reproduce the same gating.
 */
export type GuiPlanContext = {
  /** Operation that triggered the plan tool exposure. */
  operation: 'draft' | 'refine'
  /** Workspace root the plan must be written under. */
  workspaceRoot: string
  /** Reserved plan relative path the tool is allowed to write to. */
  relativePath: string
  /** Stable plan id; matches `GuiPlanArtifact.id` on the GUI side. */
  planId: string
  /** Original user request that originated the plan turn. */
  sourceRequest?: string
  /** Display title for the plan. */
  title?: string
  /** Optional turn id for debugging. */
  turnId?: string
}

export type ToolHostContext = {
  threadId: string
  turnId: string
  workspace: string
  /**
   * Thread mode advertised by the GUI. QWicks restricts plan tools
   * to `plan` threads plus `planDraft`/`planRefine` turn kinds. The
   * field is optional for backward compatibility with older call sites.
   */
  threadMode?: 'agent' | 'plan'
  /** Optional GUI plan context (see above). */
  guiPlan?: GuiPlanContext
  /** Active model capability metadata used by capability-aware providers. */
  model?: ModelCapabilityMetadata
  /** Skill ids activated for this turn, if the Skill runtime is enabled. */
  activeSkillIds?: readonly string[]
  /** Optional memory recall/mutation policy for this turn. */
  memoryPolicy?: {
    enabled: boolean
    scopes?: readonly string[]
  }
  /** Optional delegation policy for this turn. */
  delegationPolicy?: {
    enabled: boolean
    maxParallel?: number
    maxChildRuns?: number
  }
  /** Optional provider allow-list. When set, other providers are not advertised or executed. */
  allowedProviderIds?: readonly string[]
  /** Optional tool-name allow-list. When set, other tools are not advertised or executed. */
  allowedToolNames?: readonly string[]
  /**
   * v3(P1-3 报告 §10):记忆改写后的查询 —— 当 Dream beforeTurn 基于用户偏好
   * (diet/location)改写了搜索查询时,web_search 等工具可用此增强查询。
   */
  memoryRewrite?: {
    originalQuery: string
    rewrittenQuery: string
    appliedMemoryIds: readonly string[]
  }
  approvalPolicy: ApprovalPolicy
  /** Filesystem/command sandbox selected for this turn. Defaults at execution time for old callers. */
  sandboxMode?: SandboxMode
  abortSignal: AbortSignal
  /** Resolves a pending approval with the user's decision. */
  awaitApproval: (approval: ApprovalRequest) => Promise<'allow' | 'deny'>
  /** Resolves structured GUI input requested by a tool call. */
  awaitUserInput?: (
    input: Omit<UserInputRequest, 'threadId' | 'turnId'>
  ) => Promise<UserInputResolution>
}

export type ToolCallLike = {
  callId: string
  toolName: string
  providerId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  activityKind?: ToolActivityKind
  toolCategory?: ToolCategory
  providerKind?: ToolProviderKind
  actionType?: ToolActionType
  arguments: Record<string, unknown>
}

export type ToolExecutionUpdate = {
  output: unknown
  isError?: boolean
}

export type ToolHostResult = {
  item: TurnItem
  /** True if the call was decided by an approval. */
  approved: boolean
}

/**
 * Port for executing tool calls. The local tool host uses approval
 * boundaries and abort-signal cancellation; a remote host can fan out
 * to a sandboxed environment. The loop and tests only see the port.
 */
export interface ToolHost {
  readonly id: string
  /**
   * List tools available for the current turn. Tool hosts MAY scope
   * the list by mode/GUI plan context (e.g. only expose `create_plan`
   * during plan turns) so the model is not tempted to call gated
   * tools in normal agent turns.
   */
  listTools(context?: ToolHostContext): Promise<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    toolKind?: 'tool_call' | 'command_execution' | 'file_change'
    activityKind?: ToolActivityKind
    toolCategory?: ToolCategory
    actionType?: ToolActionType
    providerId?: string
    providerKind?: ToolProviderKind
  }[]>
  execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void
  ): Promise<ToolHostResult>
  /** Optional runtime hygiene hook used when compaction/discard invalidates read context. */
  clearReadTracker?(threadId?: string): void
}
