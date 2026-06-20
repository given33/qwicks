/**
 * QWicks HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const QWICKS_HEALTH_PATH = '/health'
export const QWICKS_HEALTH_TEMPLATE = '/health'

export const QWICKS_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const QWICKS_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const QWICKS_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const QWICKS_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'

export const QWICKS_SKILLS_PATH = '/v1/skills'
export const QWICKS_SKILLS_TEMPLATE = '/v1/skills'

export const QWICKS_ATTACHMENTS_PATH = '/v1/attachments'
export const QWICKS_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const QWICKS_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const QWICKS_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const QWICKS_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function qwicksAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const QWICKS_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function qwicksAttachmentContentPath(attachmentId: string): string {
  return `${qwicksAttachmentPath(attachmentId)}/content`
}

export const QWICKS_MEMORY_PATH = '/v1/memory'
export const QWICKS_MEMORY_TEMPLATE = '/v1/memory'
export const QWICKS_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const QWICKS_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const QWICKS_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function qwicksMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const QWICKS_THREADS_PATH = '/v1/threads'
export const QWICKS_THREADS_TEMPLATE = '/v1/threads'

export const QWICKS_THREAD_TEMPLATE = '/v1/threads/{id}'
export function qwicksThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const QWICKS_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function qwicksThreadForkPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/fork`
}

export const QWICKS_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function qwicksThreadGoalPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/goal`
}

export const QWICKS_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function qwicksThreadTodosPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/todos`
}

export const QWICKS_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function qwicksThreadCompactPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/compact`
}

export const QWICKS_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function qwicksThreadReviewPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/review`
}

export const QWICKS_THREAD_REWIND_TEMPLATE = '/v1/threads/{id}/rewind'
export function qwicksThreadRewindPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/rewind`
}

export const QWICKS_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function qwicksThreadTurnsPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/turns`
}

export const QWICKS_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function qwicksThreadSteerPath(threadId: string, turnId: string): string {
  return `${qwicksThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/steer`
}

export const QWICKS_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function qwicksThreadInterruptPath(threadId: string, turnId: string): string {
  return `${qwicksThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/interrupt`
}

export const QWICKS_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function qwicksThreadEventsPath(threadId: string): string {
  return `${qwicksThreadPath(threadId)}/events`
}

export const QWICKS_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function qwicksApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const QWICKS_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function qwicksUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const QWICKS_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function qwicksSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const QWICKS_USAGE_PATH = '/v1/usage'
export const QWICKS_USAGE_TEMPLATE = '/v1/usage'

export const QWICKS_DEBUG_LLM_ROUNDS_PATH = '/v1/debug/llm-rounds'
export const QWICKS_DEBUG_LLM_ROUNDS_TEMPLATE = '/v1/debug/llm-rounds'

/** Thread mode shared with the QWicks contract. */
export type QWicksThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<QWicksThreadMode> = new Set<QWicksThreadMode>(['agent', 'plan'])

export function isQWicksThreadMode(value: unknown): value is QWicksThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): QWicksThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
