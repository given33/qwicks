import { invoke } from '@tauri-apps/api/core'
import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ThreadEventSink,
  ThreadListOptions,
  ToolBlock
} from './types'

type TeamflowRunSummary = {
  runId: string
  title: string
  projectGoal: string
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  status: string
}

type TeamflowAgentMessage = {
  id: number | string
  runId?: string
  sessionId?: string
  agent?: string
  role?: string
  kind?: string
  text?: string
  taskId?: string | null
  createdAt?: string
}

type TeamflowProcessEvent = {
  id: number | string
  sessionId?: string | null
  agent?: string | null
  type?: string
  message?: string
  payload?: unknown
  createdAt?: string
}

type TeamflowCodexProvider = {
  id: string
  label: string
  model: string
}

type TeamflowStatus = {
  currentRunId?: string
  projectGoal?: string
  workspace?: string
  dedupedAgentMessages?: TeamflowAgentMessage[]
  agentMessages?: TeamflowAgentMessage[]
  dedupedEvents?: TeamflowProcessEvent[]
  codexState?: string
  codexBridgeState?: {
    workerRunning?: boolean
    sleeping?: boolean
    sessionId?: string
  }
  codexRoundState?: {
    active?: boolean
    sessionId?: string
    status?: string
  }
  activeCodexSessionId?: string
  codexModelSelection?: {
    activeProvider?: TeamflowCodexProvider
  }
}

type TeamflowRealtimeEnvelope = {
  seq?: number
  emittedAt?: string
  runId?: string
  sessionId?: string
  agent?: string
  topic?: string
  eventType?: string
  payload?: unknown
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function runTitle(run: TeamflowRunSummary): string {
  return run.title?.trim() || run.projectGoal?.trim() || run.runId.slice(0, 8)
}

function statusLooksRunning(status: TeamflowStatus | undefined): boolean {
  return (
    status?.codexRoundState?.active === true ||
    status?.codexBridgeState?.workerRunning === true ||
    status?.codexState === 'RUNNING'
  )
}

function threadFromRun(run: TeamflowRunSummary): NormalizedThread {
  return {
    id: run.runId,
    title: runTitle(run),
    updatedAt: run.lastActivityAt || run.updatedAt || run.createdAt,
    model: 'gpt-5.5',
    mode: 'agent',
    status: run.status === 'RUNNING' ? 'running' : 'idle',
    preview: run.projectGoal || run.title
  }
}

function threadFromStatus(status: TeamflowStatus, fallbackId?: string): NormalizedThread {
  const id = status.currentRunId || fallbackId || ''
  const provider = status.codexModelSelection?.activeProvider
  return {
    id,
    title: status.projectGoal?.trim() || id.slice(0, 8),
    updatedAt: new Date().toISOString(),
    model: provider?.model || 'gpt-5.5',
    mode: 'agent',
    workspace: status.workspace,
    status: statusLooksRunning(status) ? 'running' : 'idle',
    latestTurnId: latestTurnId(status),
    preview: status.projectGoal
  }
}

function latestTurnId(status: TeamflowStatus): string | undefined {
  return (
    status.codexRoundState?.sessionId ||
    status.codexBridgeState?.sessionId ||
    status.activeCodexSessionId ||
    [...(status.dedupedAgentMessages ?? status.agentMessages ?? [])].reverse().find((message) => message.sessionId)
      ?.sessionId
  )
}

function messageId(message: TeamflowAgentMessage): string {
  return `msg-${message.id}`
}

function eventId(event: TeamflowProcessEvent): string {
  return `event-${event.id}`
}

function toolBlockFromMessage(message: TeamflowAgentMessage): ToolBlock {
  return {
    kind: 'tool',
    id: messageId(message),
    createdAt: message.createdAt,
    summary: message.kind || message.agent || 'tool',
    status: 'success',
    toolKind: message.kind === 'file_change' ? 'file_change' : 'tool_call',
    detail: message.text,
    meta: {
      source: 'teamflow-agent-message',
      agent: message.agent,
      sessionId: message.sessionId,
      taskId: message.taskId
    }
  }
}

function blockFromMessage(message: TeamflowAgentMessage): ChatBlock | null {
  const text = message.text ?? ''
  if (!text.trim()) return null
  const role = message.role?.toLowerCase()
  const kind = message.kind?.toLowerCase()
  if (role === 'user') {
    return {
      kind: 'user',
      id: messageId(message),
      turnId: message.sessionId,
      createdAt: message.createdAt,
      text
    }
  }
  if (role === 'assistant') {
    return {
      kind: 'assistant',
      id: messageId(message),
      turnId: message.sessionId,
      createdAt: message.createdAt,
      text
    }
  }
  if (kind?.includes('tool') || kind?.includes('file') || kind?.includes('command')) {
    return toolBlockFromMessage(message)
  }
  return {
    kind: 'system',
    id: messageId(message),
    createdAt: message.createdAt,
    text,
    severity: kind?.includes('error') || kind?.includes('failed') ? 'error' : 'info',
    detail: message.agent ? `Agent: ${message.agent}` : undefined
  }
}

function blockFromEvent(event: TeamflowProcessEvent): ChatBlock | null {
  const text = event.message ?? ''
  if (!text.trim()) return null
  const type = event.type ?? 'status'
  if (
    type.includes('tool') ||
    type.includes('command') ||
    type.includes('file') ||
    type.includes('mcp')
  ) {
    return {
      kind: 'tool',
      id: eventId(event),
      createdAt: event.createdAt,
      summary: type,
      status: type.includes('failed') || type.includes('error') ? 'error' : 'success',
      toolKind: type.includes('file') ? 'file_change' : 'tool_call',
      detail: text,
      meta: {
        source: 'teamflow-process-event',
        payload: event.payload,
        sessionId: event.sessionId,
        agent: event.agent
      }
    }
  }
  return {
    kind: 'system',
    id: eventId(event),
    createdAt: event.createdAt,
    text,
    severity: type.includes('failed') || type.includes('error') ? 'error' : 'info',
    code: type,
    detail: event.payload ? JSON.stringify(event.payload, null, 2) : undefined
  }
}

function blocksFromStatus(status: TeamflowStatus): ChatBlock[] {
  const messages = status.dedupedAgentMessages ?? status.agentMessages ?? []
  const seen = new Set<string>()
  const blocks: ChatBlock[] = []
  for (const message of messages) {
    const block = blockFromMessage(message)
    if (!block || seen.has(block.id)) continue
    seen.add(block.id)
    blocks.push(block)
  }
  return blocks
}

function statusThreadStatus(status: TeamflowStatus): string {
  return statusLooksRunning(status) ? 'running' : 'idle'
}

function isTeamflowAgentMessage(value: unknown): value is TeamflowAgentMessage {
  return !!value && typeof value === 'object' && ('text' in value || 'role' in value)
}

function isTeamflowStatus(value: unknown): value is TeamflowStatus {
  return !!value && typeof value === 'object' && ('currentRunId' in value || 'dedupedAgentMessages' in value)
}

function isTeamflowProcessEvent(value: unknown): value is TeamflowProcessEvent {
  return !!value && typeof value === 'object' && ('message' in value || 'type' in value)
}

function emitMessageEvent(
  envelope: TeamflowRealtimeEnvelope,
  message: TeamflowAgentMessage,
  sink: ThreadEventSink
): void {
  const seq = envelope.seq
  const role = message.role?.toLowerCase()
  if (role === 'user') {
    sink.onUserMessage({
      itemId: messageId(message),
      turnId: message.sessionId || envelope.sessionId,
      createdAt: message.createdAt || envelope.emittedAt,
      text: message.text ?? ''
    })
    return
  }
  if (role === 'assistant') {
    const text = message.text ?? ''
    if (text) {
      sink.onDeltas([{ text, kind: 'agent_message', seq }])
    }
    return
  }
  const block = blockFromMessage(message)
  if (block?.kind === 'tool') {
    sink.onTool({
      itemId: block.id,
      summary: block.summary,
      status: block.status,
      toolKind: block.toolKind,
      detail: block.detail,
      filePath: block.filePath,
      meta: block.meta
    })
  } else if (block?.kind === 'system') {
    sink.onRuntimeError?.({
      itemId: block.id,
      createdAt: block.createdAt,
      message: block.text,
      code: block.code,
      severity: block.severity
    })
  }
}

function emitStatusEvent(status: TeamflowStatus, sink: ThreadEventSink): void {
  const running = statusLooksRunning(status)
  if (!running) sink.onTurnComplete()
}

function dispatchRealtimeEvent(envelope: TeamflowRealtimeEnvelope, sink: ThreadEventSink): void {
  if (typeof envelope.seq === 'number') sink.onSeq(envelope.seq)
  if (envelope.topic === 'agent_message' && isTeamflowAgentMessage(envelope.payload)) {
    emitMessageEvent(envelope, envelope.payload, sink)
    return
  }
  if (envelope.topic === 'status' && isTeamflowStatus(envelope.payload)) {
    emitStatusEvent(envelope.payload, sink)
    return
  }
  if (isTeamflowProcessEvent(envelope.payload)) {
    const block = blockFromEvent(envelope.payload)
    if (block?.kind === 'tool') {
      sink.onTool({
        itemId: block.id,
        summary: block.summary,
        status: block.status,
        toolKind: block.toolKind,
        detail: block.detail,
        filePath: block.filePath,
        meta: block.meta
      })
    }
  }
}

export class TeamflowProvider implements AgentProvider {
  readonly id = 'kun' as const
  readonly displayName = 'Teamflow'

  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review: boolean
  } {
    return { interrupt: true, stream: true, approvals: false, attachFiles: false, review: false }
  }

  async connect(): Promise<void> {
    await invoke<TeamflowStatus>('get_status')
  }

  async listThreads(options: ThreadListOptions = {}): Promise<NormalizedThread[]> {
    const runs = await invoke<TeamflowRunSummary[]>('list_runs', { limit: options.limit ?? 50 })
    const search = options.search?.trim().toLowerCase()
    const threads = runs.map(threadFromRun)
    if (!search) return threads
    return threads.filter((thread) =>
      `${thread.title} ${thread.preview ?? ''} ${thread.workspace ?? ''}`.toLowerCase().includes(search)
    )
  }

  async createThread(input: { workspace?: string; title?: string; mode?: string }): Promise<NormalizedThread> {
    const created = await invoke<{ currentRunId: string; createdAt: string }>('create_run')
    const status = await invoke<TeamflowStatus>('get_status', { runId: created.currentRunId })
    return {
      ...threadFromStatus(status, created.currentRunId),
      title: input.title?.trim() || threadFromStatus(status, created.currentRunId).title,
      workspace: input.workspace || status.workspace,
      mode: input.mode || 'agent',
      updatedAt: created.createdAt || new Date().toISOString()
    }
  }

  async getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
  }> {
    const status = await invoke<TeamflowStatus>('get_status', { runId: threadId })
    const blocks = blocksFromStatus(status)
    const latestUserMessage = [...blocks].reverse().find((block) => block.kind === 'user')
    return {
      blocks,
      latestSeq: 0,
      threadStatus: statusThreadStatus(status),
      latestTurnId: latestTurnId(status),
      latestUserMessageId: latestUserMessage?.id
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const sessionId = await invoke<string>('send_codex_message', { text, runId: threadId })
    return { threadId, turnId: sessionId }
  }

  async interruptTurn(_threadId: string, turnId: string): Promise<void> {
    await invoke('interrupt_codex_session', { sessionId: turnId || undefined })
  }

  async renameThread(): Promise<void> {
    return undefined
  }

  async deleteThread(threadId: string): Promise<void> {
    await invoke('delete_run', { runId: threadId })
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const streamId = `teamflow-provider-${crypto.randomUUID()}`
    const offEvent = window.kunGui.onSseEvent((payload) => {
      if (payload.streamId !== streamId) return
      for (const raw of payload.events ?? []) {
        if (raw && typeof raw === 'object') {
          dispatchRealtimeEvent(raw as TeamflowRealtimeEnvelope, sink)
        }
      }
    })
    const offError = window.kunGui.onSseError((payload) => {
      if (payload.streamId !== streamId) return
      sink.onError(new Error(payload.message ?? 'Teamflow realtime stream failed'))
    })
    const offEnd = window.kunGui.onSseEnd((payload) => {
      if (payload.streamId !== streamId) return
      sink.onTurnComplete()
    })
    const cleanup = (): void => {
      offEvent()
      offError()
      offEnd()
      void window.kunGui.stopSse(streamId)
    }
    if (signal.aborted) {
      cleanup()
      return
    }
    signal.addEventListener('abort', cleanup, { once: true })
    try {
      await window.kunGui.startSse(threadId, sinceSeq, streamId)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } catch (error) {
      sink.onError(asError(error))
      cleanup()
    }
  }
}
