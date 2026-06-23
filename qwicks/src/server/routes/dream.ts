/**
 * Phase 3:Dream memory 的用户控制 HTTP 路由(Memory Summary / Memory Sources /
 * 版本历史 / 恢复 / 抑制)。仅当 runtime.dreamSystem 存在时可用。
 *
 * 路由:
 *   GET    /v1/dream/summary?user_id=          — 7 区 Memory Summary
 *   POST   /v1/dream/ledger                    — 本次回答的 Memory Sources ledger
 *   GET    /v1/dream/memory/:id/versions       — 版本历史
 *   POST   /v1/dream/memory/:id/restore        — 按版本恢复
 *   POST   /v1/dream/memory/:id/suppress       — Don't-mention-again(≠ 删除)
 *   POST   /v1/dream/opt-out?user_id=          — opt-out
 *   POST   /v1/dream/opt-in?user_id=           — opt-in
 *   GET    /v1/dream/export?user_id=           — 导出
 *   POST   /v1/dream/purge?user_id=            — 永久清空
 */
import type { DreamMemorySystem } from '../../dream/chat/pipeline.js'
import type { ObservableDecision } from '../../dream/retrieval/observable-gate.js'
import type { RetrievalHit } from '../../dream/retrieval/pipeline.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

function requireDream(system: DreamMemorySystem | undefined): DreamMemorySystem | null {
  return system ?? null
}

export async function dreamSummary(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable (set capabilities.memory.backend=dream)')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  return jsonResponse({ summary: dream.buildSummary(userId).toDict() })
}

export async function dreamLedger(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as {
    userId?: string
    queryText?: string
    hits?: RetrievalHit[]
    decisions?: ObservableDecision[]
  }
  if (!v.userId || typeof v.queryText !== 'string') {
    return ERRORS.validation('userId and queryText are required', [])
  }
  const ledger = dream.buildLedger({
    userId: v.userId,
    queryText: v.queryText,
    hits: Array.isArray(v.hits) ? v.hits : [],
    decisions: Array.isArray(v.decisions) ? v.decisions : []
  })
  return jsonResponse({ ledger: ledger.toDict() })
}

export async function dreamVersions(system: DreamMemorySystem | undefined, id: string): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  return jsonResponse({ versions: dream.controls2.versionHistory(id) })
}

export async function dreamRestore(system: DreamMemorySystem | undefined, id: string, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { versionId?: string }
  if (typeof v.versionId !== 'string') return ERRORS.validation('versionId is required', [])
  const restored = dream.controls2.restoreVersion(id, v.versionId)
  if (!restored) return ERRORS.notFound('memory or version not found')
  return jsonResponse({ memory: restored.toDict() })
}

export async function dreamSuppress(system: DreamMemorySystem | undefined, id: string): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const suppressed = dream.controls2.suppressMemory(id)
  if (!suppressed) return ERRORS.notFound('memory not found')
  return jsonResponse({ memory: suppressed.toDict() })
}

export async function dreamOptOut(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  dream.controls2.optOut(userId)
  return jsonResponse({ optedOut: true, userId })
}

export async function dreamOptIn(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  const removed = dream.controls2.optIn(userId)
  return jsonResponse({ optedIn: true, userId, removedMarkers: removed })
}

export async function dreamExport(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  return jsonResponse({ export: dream.controls2.export(userId) })
}

export async function dreamPurge(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  const count = dream.controls2.purge(userId)
  return jsonResponse({ purged: count, userId })
}

/** Phase 4:Pulse 夜间异步研究(可注入 research;无 research 时返回主题占位摘要)。 */
export async function dreamPulse(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'default'
  const digest = await dream.runPulse(userId)
  return jsonResponse({ digest: digest.toDict() })
}

/** Phase 5:从 Gmail 拉取邮件抽取记忆(需先存 OAuth token)。 */
export async function dreamIngestGmail(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { account?: string; maxResults?: number }
  if (!v.account) return ERRORS.validation('account is required', [])
  try {
    const result = await dream.ingestGmail(v.account, { maxResults: v.maxResults })
    return jsonResponse(result)
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

/** Phase 5:从 Drive 拉取文件抽取记忆。 */
export async function dreamIngestDrive(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { account?: string; maxResults?: number }
  if (!v.account) return ERRORS.validation('account is required', [])
  try {
    const result = await dream.ingestDrive(v.account, { maxResults: v.maxResults })
    return jsonResponse(result)
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

/** Phase 5:撤销连接器授权(→ CONNECTOR_REVOKED tombstone)。 */
export async function dreamRevokeConnector(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const account = url.searchParams.get('account')
  const userId = url.searchParams.get('user_id') ?? 'default'
  if (!account) return ERRORS.validation('account is required', [])
  const result = dream.revokeConnector(account, userId)
  return jsonResponse(result)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
