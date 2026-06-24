import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ReviewTarget,
  ThreadEventSink,
  ThreadListOptions,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import { getQWicksRuntimeSettings } from '@shared/app-settings'
import {
  QWICKS_ATTACHMENT_DIAGNOSTICS_PATH,
  QWICKS_ATTACHMENTS_PATH,
  QWICKS_MEMORY_DIAGNOSTICS_PATH,
  QWICKS_MEMORY_PATH,
  QWICKS_RUNTIME_INFO_PATH,
  QWICKS_RUNTIME_TOOLS_PATH,
  QWICKS_SKILLS_PATH,
  qwicksApprovalPath,
  qwicksThreadCompactPath,
  qwicksThreadEventsPath,
  qwicksThreadForkPath,
  qwicksThreadGoalPath,
  qwicksThreadReviewPath,
  qwicksThreadRewindPath,
  qwicksThreadTodosPath,
  qwicksThreadInterruptPath,
  qwicksThreadPath,
  qwicksThreadSteerPath,
  qwicksThreadTurnsPath,
  qwicksAttachmentContentPath,
  qwicksUserInputPath,
  qwicksMemoryRecordPath,
  qwicksSessionResumePath,
  normalizeThreadMode,
  type QWicksThreadMode
} from '@shared/qwicks-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeError } from '@shared/runtime-error'
import type {
  CoreAttachmentDiagnosticsJson,
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreAttachmentUploadResponseJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryListResponseJson,
  CoreMemoryRecordJson,
  CoreResumeSessionResponseJson,
  CoreRuntimeInfoJson,
  DreamMemorySummaryJson,
  DreamVersionJson,
  CoreRuntimeEventJson,
  CoreRuntimeSkillJson,
  CoreRuntimeSkillsResponseJson,
  CoreRuntimeToolDiagnosticsJson,
  CoreStartReviewResponseJson,
  CoreClearThreadGoalResponseJson,
  CoreClearThreadTodosResponseJson,
  CoreStartTurnResponseJson,
  CoreThreadGoalResponseJson,
  CoreThreadJson,
  CoreThreadSummaryJson,
  CoreThreadTodosResponseJson
} from './qwicks-contract'
import {
  buildQuery,
  chatBlockFromItem,
  dispatchQWicksRuntimeEvents,
  goalFromCore,
  mergeChatBlocks,
  todosFromCore,
  threadFromCore
} from './qwicks-mapper'
import { rendererRuntimeClient } from './runtime-client'

function createSseStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readRuntimeError(body: string, fallback: string): RuntimeError {
  return parseRuntimeErrorBody(body, fallback)
}

function normalizeApprovalPolicy(value: string | undefined): NormalizedThread['approvalPolicy'] {
  switch (value) {
    case 'auto':
    case 'on-request':
    case 'untrusted':
    case 'suggest':
    case 'never':
      return value
    default:
      return undefined
  }
}

function readRuntimeJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw runtimeErrorToError({ code: 'unknown', message: fallback })
  }
}

/**
 * GUI-side adapter for the QWicks HTTP/SSE contract.
 *
 * The provider owns renderer orchestration only: HTTP calls, SSE
 * reconnection, and approval policy decisions. DTO and chat-block
 * mapping live in `qwicks-contract.ts` and `qwicks-mapper.ts`.
 */
export class QWicksRuntimeProvider implements AgentProvider {
  readonly id = 'qwicks' as const
  readonly displayName = 'QWicks'

  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review: boolean
  } {
    return { interrupt: true, stream: true, approvals: true, attachFiles: true, review: true }
  }

  async connect(): Promise<void> {
    const health = await rendererRuntimeClient.runtimeRequest('/health', 'GET')
    if (!health.ok) {
      throw runtimeErrorToError(readRuntimeError(health.body, `runtime unhealthy (${health.status || 0})`))
    }
    const threads = await rendererRuntimeClient.runtimeRequest('/v1/threads?limit=1', 'GET')
    if (!threads.ok) {
      throw runtimeErrorToError(readRuntimeError(threads.body, `failed to list threads (${threads.status || 0})`))
    }
  }

  async listThreads(options: ThreadListOptions = {}): Promise<NormalizedThread[]> {
    const query = buildQuery({
      limit: options.limit ?? 50,
      search: options.search,
      include_archived: options.includeArchived,
      archived_only: options.archivedOnly
    })
    const response = await rendererRuntimeClient.runtimeRequest(`/v1/threads${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list threads'))
    }
    const body = readRuntimeJson<{ threads: CoreThreadSummaryJson[] }>(
      response.body,
      'runtime returned an invalid thread list response'
    )
    return body.threads.map(threadFromCore)
  }

  async createThread(input: {
    workspace?: string
    title?: string
    mode?: QWicksThreadMode
  }): Promise<NormalizedThread> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getQWicksRuntimeSettings(settings)
    const response = await rendererRuntimeClient.runtimeRequest(
      '/v1/threads',
      'POST',
      JSON.stringify({
        workspace: input.workspace || settings.workspaceRoot || '~',
        title: input.title,
        model: runtime.model,
        mode: normalizeThreadMode(input.mode),
        approvalPolicy: runtime.approvalPolicy,
        sandboxMode: runtime.sandboxMode
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to create thread'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    goal?: NormalizedThread['goal']
    todos?: NormalizedThread['todos']
  }> {
    const response = await rendererRuntimeClient.runtimeRequest(qwicksThreadPath(threadId), 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread'))
    }
    const thread = readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    )
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const items = turns.flatMap((turn) =>
      (turn.items ?? []).map((item) => ({
        ...item,
        attachmentIds: turn.attachmentIds,
        activeSkillIds: turn.activeSkillIds,
        injectedMemoryIds: turn.injectedMemoryIds,
        skillInjectionBytes: turn.skillInjectionBytes,
        workspaceCheckpointId: item.workspaceCheckpointId ?? turn.workspaceCheckpointId
      }))
    )
    const blocks = mergeChatBlocks(items.flatMap((item) => {
      const block = chatBlockFromItem(item)
      return block ? [block] : []
    }))
    const latestTurn = turns.at(-1)
    const latestUserMessageId = [...items].reverse().find((item) => item.kind === 'user_message')?.id
    return {
      blocks,
      latestSeq: thread.latestSeq ?? 0,
      threadStatus: thread.status ?? latestTurn?.status,
      latestTurnId: latestTurn?.id,
      latestUserMessageId,
      goal: thread.goal ? goalFromCore(thread.goal) : null,
      todos: thread.todos ? todosFromCore(thread.todos) : null
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: QWicksThreadMode
      model?: string
      reasoningEffort?: string
      displayText?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      attachmentIds?: string[]
      workspaceCheckpointId?: string
      fileReferences?: Array<{ path: string; relativePath: string; name: string; kind?: 'file' | 'directory' }>
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getQWicksRuntimeSettings(settings)
    const body: Record<string, unknown> = {
      prompt: text,
      model: options?.model,
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode
    }
    if (options?.reasoningEffort?.trim()) {
      body.reasoningEffort = options.reasoningEffort.trim()
    }
    if (options?.displayText?.trim() && options.displayText.trim() !== text.trim()) {
      body.displayText = options.displayText.trim()
    }
    const mode = options?.mode
    if (mode === 'agent' || mode === 'plan') {
      body.mode = mode
    }
    if (options?.guiPlan) {
      body.guiPlan = {
        operation: options.guiPlan.operation,
        workspaceRoot: options.guiPlan.workspaceRoot,
        relativePath: options.guiPlan.relativePath,
        planId: options.guiPlan.planId,
        sourceRequest: options.guiPlan.sourceRequest,
        title: options.guiPlan.title
      }
    }
    if (options?.attachmentIds?.length) {
      body.attachmentIds = options.attachmentIds
    }
    if (options?.workspaceCheckpointId?.trim()) {
      body.workspaceCheckpointId = options.workspaceCheckpointId.trim()
    }
    if (options?.fileReferences?.length) {
      body.fileReferences = options.fileReferences
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadTurnsPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start turn'))
    }
    const parsed = readRuntimeJson<CoreStartTurnResponseJson>(
      response.body,
      'runtime returned an invalid turn response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId
    }
  }

  async rewindThread(threadId: string, turnId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadRewindPath(threadId),
      'POST',
      JSON.stringify({ turnId })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to rewind thread'))
    }
  }

  async reviewThread(
    threadId: string,
    target: ReviewTarget,
    options?: { model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }> {
    const body: Record<string, unknown> = { target }
    if (options?.model?.trim()) {
      body.model = options.model.trim()
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadReviewPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start review'))
    }
    const parsed = readRuntimeJson<CoreStartReviewResponseJson>(
      response.body,
      'runtime returned an invalid review response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId,
      reviewItemId: parsed.reviewItemId
    }
  }

  async steerUserMessage(threadId: string, turnId: string, text: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadSteerPath(threadId, turnId),
      'POST',
      JSON.stringify({ text })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to queue message'))
    }
  }

  async interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadInterruptPath(threadId, turnId),
      'POST',
      JSON.stringify({ discard: options?.discard === true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to interrupt turn'))
    }
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadPath(threadId),
      'PATCH',
      JSON.stringify({ title })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'rename thread failed'))
    }
  }

  async updateThreadWorkspace(threadId: string, workspace: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadPath(threadId),
      'PATCH',
      JSON.stringify({ workspace })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'update thread workspace failed'))
    }
  }

  async archiveThread(threadId: string, archived: boolean): Promise<void> {
    const response = await window.qwicksGui.runtimeRequest(
      qwicksThreadPath(threadId),
      'PATCH',
      JSON.stringify({ status: archived ? 'archived' : 'idle' })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'archive thread failed'))
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(qwicksThreadPath(threadId), 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'delete thread failed'))
    }
  }

  async compactThread(threadId: string, reason?: string): Promise<{ replacedTokens: number }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadCompactPath(threadId),
      'POST',
      JSON.stringify({ reason: reason?.trim() || undefined })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'compact thread failed'))
    }
    // Surface the folded token count so the UI can drop the context gauge
    // immediately. Heuristic compaction has no usage event, and model-summary
    // usage can arrive separately from the compact response. Best-effort: a
    // parse hiccup must not turn a successful compaction into a thrown error.
    try {
      const body = readRuntimeJson<{ replacedTokens?: number }>(
        response.body,
        'runtime returned an invalid compact response'
      )
      return { replacedTokens: Math.max(0, Math.floor(body.replacedTokens ?? 0)) }
    } catch {
      return { replacedTokens: 0 }
    }
  }

  async getThreadGoal(threadId: string): Promise<NonNullable<NormalizedThread['goal']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadGoalPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    return body.goal ? goalFromCore(body.goal) : null
  }

  async setThreadGoal(
    threadId: string,
    patch: {
      objective?: string
      status?: NonNullable<NormalizedThread['goal']>['status']
      tokenBudget?: number | null
    }
  ): Promise<NonNullable<NormalizedThread['goal']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadGoalPath(threadId),
      'POST',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    if (!body.goal) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread goal returned an invalid response'
      })
    }
    return goalFromCore(body.goal)
  }

  async clearThreadGoal(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadGoalPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread goal'))
    }
    return readRuntimeJson<CoreClearThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid clear thread goal response'
    ).cleared
  }

  async getThreadTodos(threadId: string): Promise<NonNullable<NormalizedThread['todos']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadTodosPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    return body.todos ? todosFromCore(body.todos) : null
  }

  async setThreadTodos(
    threadId: string,
    todos: Parameters<NonNullable<AgentProvider['setThreadTodos']>>[1]
  ): Promise<NonNullable<NormalizedThread['todos']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadTodosPath(threadId),
      'POST',
      JSON.stringify({ todos })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    if (!body.todos) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread todos returned an invalid response'
      })
    }
    return todosFromCore(body.todos)
  }

  async clearThreadTodos(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksThreadTodosPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread todos'))
    }
    return readRuntimeJson<CoreClearThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid clear thread todos response'
    ).cleared
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny'
  ): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksApprovalPath(approvalId),
      'POST',
      JSON.stringify({ decision })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'approval decision failed'))
    }
  }

  async submitUserInputResponse(inputId: string, answers: UserInputAnswer[]): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksUserInputPath(inputId),
      'POST',
      JSON.stringify({ answers })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input response failed'))
    }
  }

  async cancelUserInput(inputId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksUserInputPath(inputId),
      'POST',
      JSON.stringify({ cancelled: true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input cancel failed'))
    }
  }

  async getRuntimeInfo(): Promise<CoreRuntimeInfoJson> {
    const response = await rendererRuntimeClient.runtimeRequest(QWICKS_RUNTIME_INFO_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime info'))
    }
    return readRuntimeJson<CoreRuntimeInfoJson>(
      response.body,
      'runtime returned an invalid runtime info response'
    )
  }

  async getToolDiagnostics(): Promise<CoreRuntimeToolDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(QWICKS_RUNTIME_TOOLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime diagnostics'))
    }
    return readRuntimeJson<CoreRuntimeToolDiagnosticsJson>(
      response.body,
      'runtime returned an invalid runtime diagnostics response'
    )
  }

  async listSkills(): Promise<CoreRuntimeSkillJson[]> {
    const response = await rendererRuntimeClient.runtimeRequest(QWICKS_SKILLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list skills'))
    }
    return readRuntimeJson<CoreRuntimeSkillsResponseJson>(
      response.body,
      'runtime returned an invalid skills response'
    ).skills ?? []
  }

  async uploadAttachment(input: {
    name: string
    mimeType?: string
    dataBase64: string
    localFilePath?: string
    textFallback?: CoreAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<CoreAttachmentMetadataJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      QWICKS_ATTACHMENTS_PATH,
      'POST',
      JSON.stringify(input)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'attachment upload failed'))
    }
    return readRuntimeJson<CoreAttachmentUploadResponseJson>(
      response.body,
      'runtime returned an invalid attachment upload response'
    ).attachment
  }

  async getAttachmentDiagnostics(): Promise<CoreAttachmentDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(QWICKS_ATTACHMENT_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment diagnostics'))
    }
    return readRuntimeJson<CoreAttachmentDiagnosticsJson>(
      response.body,
      'runtime returned an invalid attachment diagnostics response'
    )
  }

  async getAttachmentContent(
    attachmentId: string,
    options: { threadId?: string; workspace?: string } = {}
  ): Promise<CoreAttachmentContentResponseJson> {
    const query = buildQuery({
      thread_id: options.threadId,
      workspace: options.workspace
    })
    const response = await rendererRuntimeClient.runtimeRequest(
      `${qwicksAttachmentContentPath(attachmentId)}${query}`,
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment content'))
    }
    return readRuntimeJson<CoreAttachmentContentResponseJson>(
      response.body,
      'runtime returned an invalid attachment content response'
    )
  }

  async listMemories(options: { workspace?: string; includeDeleted?: boolean } = {}): Promise<CoreMemoryRecordJson[]> {
    const query = buildQuery({
      workspace: options.workspace,
      include_deleted: options.includeDeleted
    })
    const response = await rendererRuntimeClient.runtimeRequest(`${QWICKS_MEMORY_PATH}${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list memories'))
    }
    return readRuntimeJson<CoreMemoryListResponseJson>(
      response.body,
      'runtime returned an invalid memory list response'
    ).memories ?? []
  }

  async createMemory(input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
  }): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      QWICKS_MEMORY_PATH,
      'POST',
      JSON.stringify(input)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to create memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async updateMemory(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean },
    options: { workspace?: string } = {}
  ): Promise<CoreMemoryRecordJson> {
    const query = buildQuery({ workspace: options.workspace })
    const response = await rendererRuntimeClient.runtimeRequest(
      `${qwicksMemoryRecordPath(memoryId)}${query}`,
      'PATCH',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to update memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async deleteMemory(memoryId: string, options: { workspace?: string } = {}): Promise<CoreMemoryRecordJson> {
    const query = buildQuery({ workspace: options.workspace })
    const response = await rendererRuntimeClient.runtimeRequest(`${qwicksMemoryRecordPath(memoryId)}${query}`, 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to delete memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async getMemoryDiagnostics(): Promise<CoreMemoryDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(QWICKS_MEMORY_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load memory diagnostics'))
    }
    return readRuntimeJson<CoreMemoryDiagnosticsJson>(
      response.body,
      'runtime returned an invalid memory diagnostics response'
    )
  }

  // ---- Phase 3: Dream memory user-control surfaces (summary/ledger/versions/opt-out) ----

  async getDreamSummary(userId = 'default'): Promise<DreamMemorySummaryJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/summary?user_id=${encodeURIComponent(userId)}`,
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load dream memory summary'))
    }
    return readRuntimeJson<{ summary: DreamMemorySummaryJson }>(
      response.body,
      'runtime returned an invalid dream summary response'
    ).summary
  }

  async getDreamMemoryVersions(memoryId: string): Promise<DreamVersionJson[]> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/memory/${encodeURIComponent(memoryId)}/versions`,
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load dream memory versions'))
    }
    return readRuntimeJson<{ versions: DreamVersionJson[] }>(
      response.body,
      'runtime returned an invalid dream versions response'
    ).versions ?? []
  }

  async restoreDreamMemoryVersion(memoryId: string, versionId: string): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/memory/${encodeURIComponent(memoryId)}/restore`,
      'POST',
      JSON.stringify({ versionId })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to restore dream memory version'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid dream restore response'
    ).memory
  }

  async suppressDreamMemory(memoryId: string): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/memory/${encodeURIComponent(memoryId)}/suppress`,
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to suppress dream memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid dream suppress response'
    ).memory
  }

  async setDreamOptOut(userId = 'default', optOut: boolean): Promise<void> {
    const path = optOut ? '/v1/dream/opt-out' : '/v1/dream/opt-in'
    const response = await rendererRuntimeClient.runtimeRequest(
      `${path}?user_id=${encodeURIComponent(userId)}`,
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set dream opt-out'))
    }
  }

  // v3(P1-2/4/5/6):新增 dream 控制面方法
  async disableDreamReferenceChatHistory(userId = 'default'): Promise<{ removedInferred: number }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/disable-reference-chat-history?user_id=${encodeURIComponent(userId)}`,
      'POST'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to disable reference chat history'))
    const body = readRuntimeJson<{ removedInferred?: number }>(response.body, 'invalid disable-response')
    return { removedInferred: body.removedInferred ?? 0 }
  }

  async triggerDreamDreaming(userId = 'default'): Promise<{ ran: boolean; temporalOccurred: number; topOfMindPromoted: number }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/dreaming/trigger?user_id=${encodeURIComponent(userId)}`,
      'POST'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to trigger dreaming'))
    const body = readRuntimeJson<{ ran: boolean; temporalOccurred: number; topOfMindPromoted: number }>(response.body, 'invalid dreaming-trigger response')
    return body
  }

  async getDreamDreamingStatus(userId = 'default'): Promise<{ dirtyCount: number; isDirty: boolean }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/dreaming/status?user_id=${encodeURIComponent(userId)}`,
      'GET'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to get dreaming status'))
    const body = readRuntimeJson<{ dirtyCount: number; isDirty?: boolean }>(response.body, 'invalid dreaming-status response')
    return { dirtyCount: body.dirtyCount ?? 0, isDirty: body.isDirty ?? false }
  }

  async getDreamSources(userId = 'default', sourceType?: string): Promise<Array<{ id: string; source_type: string; title: string | null; external_ref: string | null; deleted: boolean }>> {
    const params = new URLSearchParams({ user_id: userId })
    if (sourceType) params.set('source_type', sourceType)
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/sources?${params.toString()}`,
      'GET'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to get dream sources'))
    return readRuntimeJson<{ sources: Array<{ id: string; source_type: string; title: string | null; external_ref: string | null; deleted: boolean }> }>(response.body, 'invalid sources response').sources ?? []
  }

  async getDreamSuppressions(userId = 'default'): Promise<Array<{ id: string; scope: string; target: string; reason: string | null; active: boolean }>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/suppressions?user_id=${encodeURIComponent(userId)}`,
      'GET'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to get dream suppressions'))
    return readRuntimeJson<{ suppressions: Array<{ id: string; scope: string; target: string; reason: string | null; active: boolean }> }>(response.body, 'invalid suppressions response').suppressions ?? []
  }

  // 7(差距7):记忆三开关
  async getDreamMemorySettings(userId = 'default'): Promise<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/memory-settings?user_id=${encodeURIComponent(userId)}`, 'GET'
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to get memory settings'))
    const body = readRuntimeJson<{ savedMemoriesEnabled?: boolean; chatHistoryEnabled?: boolean; connectorsEnabled?: boolean }>(response.body, 'invalid settings response')
    return { savedMemoriesEnabled: body.savedMemoriesEnabled ?? true, chatHistoryEnabled: body.chatHistoryEnabled ?? true, connectorsEnabled: body.connectorsEnabled ?? true }
  }

  async setDreamMemorySettings(userId: string, settings: Partial<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }>): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      `/v1/dream/memory-settings?user_id=${encodeURIComponent(userId)}`, 'POST', JSON.stringify(settings)
    )
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set memory settings'))
  }

  async forkThread(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string; turnId?: string }
  ): Promise<NormalizedThread> {
    const body: Record<string, unknown> = {}
    if (options?.relation) body.relation = options.relation
    if (options?.title) body.title = options.title
    if (options?.turnId) body.turnId = options.turnId
    const url = qwicksThreadForkPath(threadId)
    const response =
      Object.keys(body).length > 0
        ? await rendererRuntimeClient.runtimeRequest(url, 'POST', JSON.stringify(body))
        : await rendererRuntimeClient.runtimeRequest(url, 'POST')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'fork thread failed'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async resumeSession(
    sessionId: string,
    options?: { model?: string; mode?: QWicksThreadMode }
  ): Promise<{ threadId: string; sessionId: string }> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getQWicksRuntimeSettings(settings)
    const response = await rendererRuntimeClient.runtimeRequest(
      qwicksSessionResumePath(sessionId),
      'POST',
      JSON.stringify({
        workspace: settings.workspaceRoot || undefined,
        model: options?.model?.trim() || runtime.model,
        mode: options?.mode
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'resume session failed'))
    }
    const body = readRuntimeJson<CoreResumeSessionResponseJson>(
      response.body,
      'runtime returned an invalid resume session response'
    )
    const threadId = body.thread_id ?? body.threadId
    if (!threadId) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'resume session returned an invalid response'
      })
    }
    return { threadId, sessionId: body.session_id ?? body.sessionId ?? sessionId }
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const streamId = createSseStreamId()
    await new Promise<void>(async (resolve) => {
      let settled = false
      const pendingDispatches = new Set<Promise<void>>()
      const finish = (): void => {
        if (settled) return
        settled = true
        offData()
        offEnd()
        offErr()
        signal.removeEventListener('abort', onAbort)
        void Promise.allSettled([...pendingDispatches]).then(() => resolve())
      }
      const offData = rendererRuntimeClient.onSseEvent((payload) => {
        if (payload.streamId !== streamId) return
        // Older main processes (pre-batching) deliver a single event under
        // `data`; accept both shapes so a stale main/renderer pair during a
        // dev reload or partial update degrades gracefully instead of
        // silently dropping the stream.
        const legacySingle = (payload as { data?: unknown }).data
        const rawEvents = Array.isArray(payload.events)
          ? payload.events
          : legacySingle !== undefined
            ? [legacySingle]
            : []
        const batch = rawEvents.map((entry): CoreRuntimeEventJson =>
          entry && typeof entry === 'object' ? (entry as CoreRuntimeEventJson) : {}
        )
        if (batch.length === 0) return
        let maxSeq: number | null = null
        for (const event of batch) {
          if (typeof event.seq === 'number') {
            maxSeq = maxSeq === null ? event.seq : Math.max(maxSeq, event.seq)
          }
        }
        if (maxSeq !== null) {
          sink.onSeq(maxSeq)
        }
        const task = dispatchQWicksRuntimeEvents(batch, sink, (runtimeEvent, eventSink) =>
          this.handleApprovalRequest(runtimeEvent, eventSink)
        ).finally(() => {
          pendingDispatches.delete(task)
        })
        pendingDispatches.add(task)
      })
      const offErr = rendererRuntimeClient.onSseError(({ streamId: sid, message, status }) => {
        if (sid !== streamId) return
        sink.onError(new Error(message ?? `sse error ${status ?? ''}`))
        finish()
      })
      const offEnd = rendererRuntimeClient.onSseEnd(({ streamId: sid }) => {
        if (sid !== streamId) return
        finish()
      })
      const onAbort = (): void => {
        void rendererRuntimeClient.stopSse(streamId)
        finish()
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await rendererRuntimeClient.startSse(threadId, sinceSeq, streamId)
      } catch (error) {
        sink.onError(error instanceof Error ? error : new Error(String(error)))
        finish()
      }
    })
    void rendererRuntimeClient.stopSse(streamId)
  }

  private async handleApprovalRequest(event: CoreRuntimeEventJson, sink: ThreadEventSink): Promise<void> {
    const approvalId = event.approvalId ?? event.itemId ?? ''
    if (!approvalId) return
    try {
      const eventPolicy = normalizeApprovalPolicy(event.approvalPolicy)
      const policy = eventPolicy ?? getQWicksRuntimeSettings(await rendererRuntimeClient.getSettings()).approvalPolicy
      switch (policy) {
        case 'auto':
          await this.submitApprovalDecision(approvalId, 'allow')
          return
        case 'never':
          await this.submitApprovalDecision(approvalId, 'deny')
          return
        case 'on-request':
        case 'suggest':
        case 'untrusted':
          break
      }
    } catch {
      /* Fall through and render the approval card. */
    }
    sink.onApproval({
      approvalId,
      summary: event.summary ?? 'Approval required',
      toolName: event.toolName,
      ...(event.child ? { meta: { child: event.child } } : {})
    })
  }
}

export { qwicksThreadEventsPath }
