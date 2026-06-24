import { Router } from '../router.js'
import { healthJsonResponse } from './health.js'
import { buildWorkspaceStatusResponse } from './workspace.js'
import {
  createThread,
  clearThreadGoal,
  clearThreadTodos,
  deleteThread,
  forkThread,
  getThreadGoal,
  getThreadTodos,
  getThread,
  listThreads,
  setThreadGoal,
  setThreadTodos,
  updateThread
} from './threads.js'
import {
  compactTurn,
  getTurn,
  interruptTurn,
  rewindThread,
  startTurn,
  steerTurn
} from './turns.js'
import { startReview } from './review.js'
import { buildEventStreamResponse } from './events.js'
import { decideApproval } from './approvals.js'
import { resolveUserInput } from './user-inputs.js'
import { resumeSession } from './sessions.js'
import { usageJsonResponse } from './usage.js'
import { llmDebugRoundsResponse } from './debug-llm.js'
import { runtimeInfoJsonResponse, runtimeToolDiagnosticsJsonResponse } from './runtime-info.js'
import { listSkills } from './skills.js'
import {
  attachmentDiagnostics,
  getAttachmentContent,
  getAttachmentMetadata,
  uploadAttachment
} from './attachments.js'
import {
  createMemory,
  deleteMemory,
  listMemories,
  memoryDiagnostics,
  updateMemory
} from './memory.js'
import {
  dreamExport,
  dreamIngestDrive,
  dreamIngestGmail,
  dreamLedger,
  dreamOptIn,
  dreamOptOut,
  dreamPendingConfirm,
  dreamPendingDismiss,
  dreamPendingList,
  dreamPulse,
  dreamPurge,
  dreamRestore,
  dreamRevokeConnector,
  dreamSuppress,
  dreamSummary,
  dreamVersions,
  dreamListSources,
  dreamGetSource,
  dreamSourceLineage,
  dreamDeleteSourceAndDerived,
  dreamCreateSuppression,
  dreamListSuppressions,
  dreamUnsuppress,
  dreamDeleteSuppression,
  dreamMarkOccurred,
  dreamDisableReferenceChatHistory,
  dreamTriggerDreaming,
  dreamDreamingStatus,
  dreamEmbeddingHealth,
  dreamGetMemorySettings,
  dreamSetMemorySettings
} from './dream.js'
import {
  meshModelsResponse,
  meshPairInitiate,
  meshPairVerify,
  meshPeersResponse,
  meshPendingPairingsResponse,
  meshStatusResponse,
  requireMesh
} from './mesh.js'
import { isAuthorized, bearerToken } from '../auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Build the full router used by the HTTP server. The router exposes:
 * - `GET /health` (unauthenticated)
 * - `GET /v1/runtime/info` (auth)
 * - `GET /v1/runtime/tools` (auth)
 * - `GET /v1/skills` (auth)
 * - `POST /v1/attachments` (auth)
 * - `GET /v1/attachments/diagnostics` (auth)
 * - `GET /v1/attachments/{id}` and `{id}/content` (auth)
 * - `GET/POST /v1/memory`, `PATCH/DELETE /v1/memory/{id}`, diagnostics (auth)
 * - `GET /v1/workspace/status` (auth)
 * - `GET/POST /v1/threads` (auth)
 * - `GET/PATCH/DELETE /v1/threads/{id}` (auth)
 * - `POST /v1/threads/{id}/fork` (auth)
 * - `GET/POST/DELETE /v1/threads/{id}/goal` (auth)
 * - `GET/POST/DELETE /v1/threads/{id}/todos` (auth)
 * - `POST /v1/threads/{id}/turns` (auth)
 * - `POST /v1/threads/{id}/review` (auth)
 * - `GET /v1/threads/{id}/turns/{turnId}` (auth)
 * - `POST /v1/threads/{id}/turns/{turnId}/steer` (auth)
 * - `POST /v1/threads/{id}/turns/{turnId}/interrupt` (auth)
 * - `POST /v1/threads/{id}/compact` (auth)
 * - `GET /v1/threads/{id}/events` (auth)
 * - `POST /v1/approvals/{id}` (auth)
 * - `POST /v1/user-inputs/{id}` and `/v1/user-input/{id}` (auth)
 * - `POST /v1/sessions/{id}/resume-thread` (auth)
 * - `GET /v1/usage` (auth)
 * - `GET /v1/debug/llm-rounds` (auth)
 */
export function buildRouter(runtime: ServerRuntime): Router {
  const router = new Router()
  router.add('GET', '/health', () => healthJsonResponse())
  router.add('GET', '/v1/runtime/info', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeInfoJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/tools', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeToolDiagnosticsJsonResponse(runtime)
  })
  router.add('GET', '/v1/skills', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listSkills(runtime)
  })
  router.add('POST', '/v1/attachments', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return uploadAttachment(runtime.attachmentStore, request)
  })
  router.add('GET', '/v1/attachments/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return attachmentDiagnostics(runtime.attachmentStore)
  })
  router.add('GET', '/v1/attachments/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentMetadata(runtime.attachmentStore, ctx.params.id)
  })
  router.add('GET', '/v1/attachments/:id/content', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentContent(runtime.attachmentStore, ctx.params.id, request)
  })
  router.add('GET', '/v1/memory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listMemories(runtime.memoryStore, request)
  })
  router.add('POST', '/v1/memory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createMemory(runtime.memoryStore, request)
  })
  router.add('GET', '/v1/memory/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return memoryDiagnostics(runtime.memoryStore)
  })
  router.add('PATCH', '/v1/memory/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateMemory(runtime.memoryStore, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/memory/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteMemory(runtime.memoryStore, ctx.params.id, request)
  })
  // Phase 3:Dream memory 用户控制路由(仅 backend=dream 时 runtime.dreamSystem 存在)
  router.add('GET', '/v1/dream/summary', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamSummary(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/ledger', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamLedger(runtime.dreamSystem, request)
  })
  // Batch B:高敏感待确认草稿(list / confirm / dismiss)
  router.add('GET', '/v1/dream/pending', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamPendingList(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/pending/:id/confirm', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamPendingConfirm(runtime.dreamSystem, ctx.params.id)
  })
  router.add('POST', '/v1/dream/pending/:id/dismiss', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamPendingDismiss(runtime.dreamSystem, ctx.params.id)
  })
  router.add('GET', '/v1/dream/memory/:id/versions', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamVersions(runtime.dreamSystem, ctx.params.id)
  })
  router.add('POST', '/v1/dream/memory/:id/restore', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamRestore(runtime.dreamSystem, ctx.params.id, request)
  })
  router.add('POST', '/v1/dream/memory/:id/suppress', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamSuppress(runtime.dreamSystem, ctx.params.id)
  })
  router.add('POST', '/v1/dream/opt-out', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamOptOut(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/opt-in', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamOptIn(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/dream/export', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamExport(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/purge', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamPurge(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/pulse', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamPulse(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/ingest/gmail', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamIngestGmail(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/ingest/drive', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamIngestDrive(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/revoke-connector', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamRevokeConnector(runtime.dreamSystem, request)
  })
  // v3:来源记录 / 抑制规则 / 级联删除 / 时间转换 / 状态提示
  router.add('GET', '/v1/dream/sources', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamListSources(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/dream/sources/:id', async (_request, ctx) => {
    if (!authorize(_request, runtime)) return ERRORS.unauthorized()
    return dreamGetSource(runtime.dreamSystem, ctx.params.id)
  })
  router.add('GET', '/v1/dream/sources/:id/lineage', async (_request, ctx) => {
    if (!authorize(_request, runtime)) return ERRORS.unauthorized()
    return dreamSourceLineage(runtime.dreamSystem, ctx.params.id)
  })
  router.add('DELETE', '/v1/dream/sources/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamDeleteSourceAndDerived(runtime.dreamSystem, ctx.params.id, request)
  })
  router.add('POST', '/v1/dream/suppressions', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamCreateSuppression(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/dream/suppressions', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamListSuppressions(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/suppressions/unsuppress', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamUnsuppress(runtime.dreamSystem, request)
  })
  router.add('DELETE', '/v1/dream/suppressions/:id', async (_request, ctx) => {
    if (!authorize(_request, runtime)) return ERRORS.unauthorized()
    return dreamDeleteSuppression(runtime.dreamSystem, ctx.params.id)
  })
  router.add('POST', '/v1/dream/memory/:id/mark-occurred', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamMarkOccurred(runtime.dreamSystem, ctx.params.id, request)
  })
  router.add('POST', '/v1/dream/disable-reference-chat-history', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamDisableReferenceChatHistory(runtime.dreamSystem, request)
  })
  // v3(P1-6):dreaming 手动触发 + 状态查询
  router.add('POST', '/v1/dream/dreaming/trigger', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamTriggerDreaming(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/dream/dreaming/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamDreamingStatus(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/dream/embedding/health', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamEmbeddingHealth(runtime.dreamSystem)
  })
  // 7(差距7):记忆三开关(saved/chat history/connectors)
  router.add('GET', '/v1/dream/memory-settings', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamGetMemorySettings(runtime.dreamSystem, request)
  })
  router.add('POST', '/v1/dream/memory-settings', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return dreamSetMemorySettings(runtime.dreamSystem, request)
  })
  router.add('GET', '/v1/workspace/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    return buildWorkspaceStatusResponse({ inspector: runtime.workspaceInspector, path })
  })
  router.add('GET', '/v1/threads', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listThreads(runtime.threadService, request)
  })
  router.add('POST', '/v1/threads', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createThread(runtime.threadService, request)
  })
  router.add('GET', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThread(runtime.threadService, ctx.params.id, runtime.sessionStore)
  })
  router.add('PATCH', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteThread(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/fork', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return forkThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadGoal(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadTodos(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/turns', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return startTurn(runtime.turnService, ctx.params.id, request, ({ threadId, turnId }) => {
      runtime.runTurn(threadId, turnId)
    })
  })
  router.add('POST', '/v1/threads/:id/rewind', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return rewindThread(runtime.turnService, ctx.params.id, request)
  })
  router.add('POST', '/v1/threads/:id/review', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.reviewService || !runtime.runReview) {
      return ERRORS.unavailable('review is not available')
    }
    return startReview(
      runtime.turnService,
      ctx.params.id,
      request,
      ({ threadId, turnId, reviewItemId }, target, model) => {
        runtime.runReview?.({ threadId, turnId, reviewItemId, target, model })
      }
    )
  })
  router.add('GET', '/v1/threads/:id/turns/:turnId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getTurn(runtime.turnService, ctx.params.id, ctx.params.turnId)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/steer', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return steerTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/interrupt', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return interruptTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/compact', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return compactTurn(runtime.turnService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/events', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return buildEventStreamResponse({
      request,
      threadId: ctx.params.id,
      eventBus: runtime.eventBus,
      sessionStore: runtime.sessionStore
    })
  })
  router.add('POST', '/v1/approvals/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return decideApproval({
      approvalId: ctx.params.id,
      request,
      gate: runtime.approvalGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/user-inputs/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/user-input/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/sessions/:id/resume-thread', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resumeSession(runtime.threadService, ctx.params.id, request)
  })
  router.add('GET', '/v1/usage', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return usageJsonResponse(request, runtime)
  })
  router.add('GET', '/v1/debug/llm-rounds', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return llmDebugRoundsResponse(runtime)
  })

  /* ---- Mesh (RFC 000 §10) — all routes 503 when mesh is disabled ---- */
  router.add('GET', '/v1/mesh/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshStatusResponse(r.mesh)
  })
  router.add('GET', '/v1/mesh/peers', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshPeersResponse(r.mesh)
  })
  router.add('GET', '/v1/mesh/models', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshModelsResponse(r.mesh)
  })
  router.add('GET', '/v1/mesh/pair/pending', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshPendingPairingsResponse(r.mesh)
  })
  router.add('POST', '/v1/mesh/pair/initiate', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshPairInitiate(r.mesh, request)
  })
  router.add('POST', '/v1/mesh/pair/verify', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const r = requireMesh(runtime)
    return r.kind === 'error' ? r.response : meshPairVerify(r.mesh, request)
  })
  return router
}

function authorize(request: Request, runtime: ServerRuntime): boolean {
  return isAuthorized(request.headers, runtime.runtimeToken, runtime.insecure)
}

void bearerToken
