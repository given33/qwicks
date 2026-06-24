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
import type { SourceType, SuppressionScope } from '../../dream/types.js'
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

// ================================================================
// v3 路由:来源记录 / 抑制规则 / 级联删除 / 时间转换 / 状态提示
// ================================================================

/** v3:列出用户的来源记录(chat/file/gmail/custom_instruction/saved_memory)。 */
export async function dreamListSources(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? 'default'
  const sourceType = url.searchParams.get('source_type') ?? undefined
  const includeDeleted = url.searchParams.get('include_deleted') === 'true'
  const sources = dream.controls2.listSources(userId, {
    sourceType: sourceType as SourceType | undefined,
    includeDeleted
  })
  return jsonResponse({ sources: sources.map((s) => s.toDict()) })
}

/** v3:获取单个来源。 */
export async function dreamGetSource(system: DreamMemorySystem | undefined, id: string): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const source = dream.controls2.getSource(id)
  if (!source) return ERRORS.notFound('source not found')
  return jsonResponse({ source: source.toDict() })
}

/** v3:列出派生自某来源的 memory(谱系查询)。 */
export async function dreamSourceLineage(system: DreamMemorySystem | undefined, id: string): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const source = dream.controls2.getSource(id)
  if (!source) return ERRORS.notFound('source not found')
  const derived = dream.controls2.memoriesDerivedFromSource(source.userId, id)
  return jsonResponse({ source: source.toDict(), derivedMemories: derived.map((m) => m.toDict()) })
}

/** v3:级联删除来源 + 派生 memory(文档 §9 deletion lineage)。 */
export async function dreamDeleteSourceAndDerived(system: DreamMemorySystem | undefined, id: string, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  const hard = body.ok ? (body.value as { hard?: boolean }).hard === true : false
  const result = dream.controls2.deleteSourceAndDerived(id, { hard })
  if (!result.sourceDeleted) return ERRORS.notFound('source not found')
  return jsonResponse(result)
}

/** v3:创建抑制规则("Don't mention this again",≠ 删除)。 */
export async function dreamCreateSuppression(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { userId?: string; scope?: string; target?: string; reason?: string | null }
  if (!v.userId || !v.scope || !v.target) {
    return ERRORS.validation('userId, scope, target are required', [])
  }
  const rule = dream.controls2.suppress({
    userId: v.userId,
    scope: v.scope as SuppressionScope,
    target: v.target,
    reason: v.reason ?? null
  })
  return jsonResponse({ suppression: rule.toDict() })
}

/** v3:列出用户的抑制规则。 */
export async function dreamListSuppressions(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? 'default'
  const includeInactive = url.searchParams.get('include_inactive') === 'true'
  const rules = dream.controls2.listSuppressions(userId, { includeInactive })
  return jsonResponse({ suppressions: rules.map((r) => r.toDict()) })
}

/** v3:取消抑制(active=false,保留记录)。 */
export async function dreamUnsuppress(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { userId?: string; scope?: string; target?: string }
  if (!v.userId || !v.scope || !v.target) {
    return ERRORS.validation('userId, scope, target are required', [])
  }
  const ok = dream.controls2.unsuppress(v.userId, v.scope as SuppressionScope, v.target)
  return jsonResponse({ unsuppressed: ok })
}

/** v3:物理删除抑制规则。 */
export async function dreamDeleteSuppression(system: DreamMemorySystem | undefined, id: string): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const ok = dream.controls2.deleteSuppression(id)
  if (!ok) return ERRORS.notFound('suppression rule not found')
  return jsonResponse({ deleted: true })
}

/** v3:手动把 PLANNED memory 转为 OCCURRED(旅行结束 → 历史)。 */
export async function dreamMarkOccurred(system: DreamMemorySystem | undefined, id: string, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { historyContent?: string; reason?: string | null }
  if (typeof v.historyContent !== 'string') {
    return ERRORS.validation('historyContent is required', [])
  }
  const updated = dream.controls2.markOccurred(id, v.historyContent, { reason: v.reason ?? null })
  if (!updated) return ERRORS.notFound('memory not found')
  return jsonResponse({ memory: updated.toDict() })
}

/** v3:关闭 reference chat history(删除 chat-inferred memory,保留 saved + chat_log)。 */
export async function dreamDisableReferenceChatHistory(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? 'default'
  const result = dream.controls2.disableReferenceChatHistory(userId)
  return jsonResponse(result)
}

/**
 * v3(P1-6 报告 §9):手动触发一轮 dreaming(decay + temporal + top-of-mind)。
 * 返回各阶段的执行统计。
 */
export async function dreamTriggerDreaming(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? undefined
  dream.scheduler.markDirty(userId ?? '__all__')
  const result = dream.scheduler.tick({ ...(userId ? { userId } : {}) })
  return jsonResponse({
    ran: result.ran,
    temporalOccurred: result.temporal?.occurred ?? 0,
    temporalExpired: result.temporal?.expiredTemporal ?? 0,
    topOfMindPromoted: result.topOfMind?.promoted ?? 0,
    topOfMindDemoted: result.topOfMind?.demoted ?? 0,
    changedMemoryIds: result.temporal?.changedMemoryIds ?? []
  })
}

/**
 * v3(P1-6):查询 dreaming job 状态(dirty 标记 + 调度器信息)。
 */
export async function dreamDreamingStatus(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? undefined
  return jsonResponse({
    dirtyCount: dream.scheduler.dirtyCount(),
    ...(userId ? { isDirty: dream.scheduler.isDirty(userId) } : {})
  })
}

/**
 * v3(二轮报告 §5.4):embedding + vectorDB health endpoint。
 * 返回当前 embedding 后端、维度、降级状态、向量数。
 */
export async function dreamEmbeddingHealth(system: DreamMemorySystem | undefined): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const embedderHealth = dream.embedder.healthCheck()
  const vectorHealth = dream.vectorDb.healthCheck()
  return jsonResponse({
    embedding: {
      backend: embedderHealth.backend,
      dim: embedderHealth.dim,
      status: embedderHealth.status,
      degraded: embedderHealth.degraded,
      probeOk: embedderHealth.probeOk
    },
    vectorDb: {
      backend: vectorHealth.backend,
      dim: vectorHealth.dim,
      docCount: vectorHealth.docCount,
      status: vectorHealth.status
    }
  })
}

/**
 * 7(差距7):获取用户记忆设置(三开关:saved memories / chat history / connectors)。
 */
export async function dreamGetMemorySettings(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? 'default'
  const settings = dream.repository.getMemorySettings(userId)
  return jsonResponse({ userId, ...settings })
}

/**
 * 7(差距7):更新用户记忆设置。
 */
export async function dreamSetMemorySettings(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse | Response> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? 'default'
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const v = body.value as { savedMemoriesEnabled?: boolean; chatHistoryEnabled?: boolean; connectorsEnabled?: boolean }
  dream.repository.setMemorySettings(userId, v)
  return jsonResponse({ userId, ...dream.repository.getMemorySettings(userId) })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
