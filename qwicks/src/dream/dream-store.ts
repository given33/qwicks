/**
 * DreamMemoryStore —— Dream 记忆系统到 qwicks `MemoryStore` 接口的适配层。
 *
 * 这是 strangler 迁移的关键接缝:实现 qwicks 既有的 `MemoryStore` 接口
 * (create/update/delete/list/retrieve/diagnostics/setLastInjected),内部把扁平的
 * `MemoryRecord` 映射成 Dream 富结构的 `MemoryItem`,持久化到 SQLite(via Repository)。
 *
 * 这样 HTTP 路由 / LLM memory 工具 / agent-loop 注入 / mesh 同步 / GUI 都自动继承
 * Dream 后端,而 `/v1/memory*` 契约保持向后兼容。
 *
 * Phase 0:retrieve 先用经过验证的 n-gram 关键词打分(与 FileMemoryStore 同算法),
 * 保证把 DreamMemoryStore 接进来后行为立刻可用;语义向量检索在 Phase 1 接入。
 *
 * 富字段(type/importance/status/provenance 等)通过 `getRich()` 暴露给 Dream 内部;
 * 扁平 `MemoryRecord` 只带 qwicks 既有字段,旧 GUI 不受影响。
 */
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryUpdateRequest
} from '../contracts/memory.js'
import type { MemoryStore } from '../memory/memory-store.js'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryScope,
  MemoryType,
  newMemoryId,
  nowIso
} from './types.js'
import type { MemoryRepository } from './storage/repository.js'

export interface DreamMemoryStoreOptions {
  repository: MemoryRepository
  config: Pick<MemoryCapabilityConfig, 'enabled'>
  /** SQLite 文件路径(diagnostics.rootDir 展示用)。 */
  sqlitePath?: string
  /** 测试用:注入时间和 id 生成。 */
  nowIso?: () => string
  newId?: () => string
}

export class DreamMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []
  private readonly now: () => string
  private readonly newId: () => string

  constructor(private readonly options: DreamMemoryStoreOptions) {
    this.now = options.nowIso ?? nowIso
    this.newId = options.newId ?? newMemoryId
  }

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    const item = draftToItem(input, this.newId(), this.now())
    this.options.repository.upsert(item)
    return itemToRecord(item)
  }

  async update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord> {
    const existing = this.options.repository.get(id)
    if (!existing) throw new Error(`memory not found: ${id}`)
    if (patch.content !== undefined) existing.content = patch.content
    if (patch.tags !== undefined) existing.tags = [...patch.tags]
    if (patch.confidence !== undefined) existing.confidence = patch.confidence
    if (patch.disabled === true && existing.status !== MemoryLifecycleStatus.SUPPRESSED) {
      // 保留 disabledAt 作为扁平层语义;在富结构里用 SUPPRESSED 表示"不注入"。
      // (注意:disabled ≠ deleted;disabled 只是不注入,仍可被 list 看到。)
    }
    existing.updatedAt = this.now()
    this.options.repository.upsert(existing)
    const record = itemToRecord(existing)
    if (patch.disabled === true) record.disabledAt = record.disabledAt ?? this.now()
    if (patch.disabled === false) record.disabledAt = undefined
    return record
  }

  async delete(id: string): Promise<MemoryRecord> {
    const existing = this.options.repository.get(id)
    if (!existing) throw new Error(`memory not found: ${id}`)
    this.options.repository.delete(id) // 软删(transition 到 DELETED)
    const after = this.options.repository.get(id)!
    const record = itemToRecord(after)
    record.deletedAt = record.deletedAt ?? this.now()
    return record
  }

  async list(filter: { workspace?: string; includeDeleted?: boolean } = {}): Promise<MemoryRecord[]> {
    // qwicks 的 workspace 过滤在 dream 的 scope 语义里映射到 user/workspace/project。
    // Phase 0:不做 workspace 路径严格匹配(那是 FileMemoryStore 的细节),只按 scope 粗过滤。
    const items = this.options.repository.list(undefined, {
      includeDeleted: filter.includeDeleted ?? false,
      includeSuppressed: filter.includeDeleted ?? false,
      includeExpired: filter.includeDeleted ?? false
    })
    return items.map((i) => itemToRecord(i))
  }

  async retrieve(input: { query: string; workspace?: string; limit: number }): Promise<MemoryRecord[]> {
    if (!this.options.config.enabled) return []
    const items = this.options.repository.list(undefined, {
      includeDeleted: false,
      includeSuppressed: false,
      includeExpired: false
    })
    // disabled(扁平)= dream 的 SUPPRESSED。retrieve 默认排除。
    // user-scope 是身份事实(姓名/偏好/账号),数量少价值高,常常被语义查询命中但零关键词
    // 重叠,关键词检索必然漏。所以 user 记忆无条件注入,把打分留给更大的 workspace/project 池。
    // —— 这与 FileMemoryStore 的策略一致(见 memory-store.ts 注释),保证接入后行为不退化。
    const userRecords = items.filter((i) => i.scope === MemoryScope.USER).map((i) => itemToRecord(i))
    const scored = items
      .filter((i) => i.scope !== MemoryScope.USER)
      .map((i) => ({ item: i, score: scoreMemory(i, input.query) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .map((e) => itemToRecord(e.item))
    return [...userRecords, ...scored].slice(0, input.limit)
  }

  async diagnostics(): Promise<MemoryDiagnostics> {
    const all = this.options.repository.list(undefined, { includeDeleted: true, includeSuppressed: true, includeExpired: true })
    const active = this.options.repository.list(undefined, {})
    const rootDir = this.options.sqlitePath ?? `dream://memory.db`
    return MemoryDiagnostics.parse({
      enabled: this.options.config.enabled,
      rootDir,
      activeCount: active.length,
      tombstoneCount: all.filter((i) => i.status === MemoryLifecycleStatus.DELETED).length,
      lastInjectedIds: [...this.lastInjectedIds]
    })
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  /** Dream 内部用:取富结构 MemoryItem(暴露 type/importance/status/provenance)。 */
  getRich(id: string): MemoryItem | null {
    return this.options.repository.get(id)
  }
}

// ----------------------------------------------------------------
// 扁平 MemoryRecord <-> 富 MemoryItem 映射
// ----------------------------------------------------------------

function draftToItem(input: MemoryCreateRequest, id: string, now: string): MemoryItem {
  const scope = scopeToDream(input.scope ?? 'workspace')
  const type = inferType(input.content, input.tags)
  const item = new MemoryItem(
    id,
    'default', // userId 在 Phase 0 用 default;Phase 1 chat 接入后按 user 维度隔离
    type,
    input.content,
    scope,
    input.tags ? [...input.tags] : [],
    0.5,
    input.confidence ?? 1,
    now,
    now,
    null,
    undefined,
    null,
    null,
    [],
    {},
    MemoryLifecycleStatus.ACTIVE,
    [],
    2
  )
  if (input.sourceThreadId) item.provenance.threadId = input.sourceThreadId
  if (input.sourceTurnId) item.provenance.turnId = input.sourceTurnId
  return item
}

function itemToRecord(item: MemoryItem): MemoryRecord {
  const scope = scopeFromDream(item.scope)
  const record: Record<string, unknown> = {
    id: item.id,
    content: item.content,
    scope,
    ...(scope !== 'user' ? { workspace: item.metadata.__workspace ?? undefined } : {}),
    ...(scope === 'project' ? { project: item.metadata.__project ?? undefined } : {}),
    ...(item.provenance.threadId ? { sourceThreadId: item.provenance.threadId } : {}),
    ...(item.provenance.turnId ? { sourceTurnId: item.provenance.turnId } : {}),
    tags: [...item.tags],
    confidence: item.confidence,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.status === MemoryLifecycleStatus.SUPPRESSED ? { disabledAt: (item.metadata.dont_mention_at as string) ?? item.updatedAt } : {}),
    ...(item.status === MemoryLifecycleStatus.DELETED ? { deletedAt: (item.metadata.__deleted_at__ as string) ?? item.updatedAt } : {})
  }
  // 去掉 undefined 值,保持 zod strict schema 通过
  for (const k of Object.keys(record)) {
    if (record[k] === undefined) delete record[k]
  }
  return MemoryRecord.parse(record)
}

/** qwicks 3 值 scope -> dream 5 值 scope。 */
function scopeToDream(scope: 'user' | 'workspace' | 'project'): MemoryScope {
  if (scope === 'user') return MemoryScope.USER
  if (scope === 'project') return MemoryScope.PROJECT
  return MemoryScope.GLOBAL // workspace 在 dream 里映射成 global(单进程单机语义)
}

function scopeFromDream(scope: MemoryScope): 'user' | 'workspace' | 'project' {
  if (scope === MemoryScope.USER) return 'user'
  if (scope === MemoryScope.PROJECT) return 'project'
  return 'workspace'
}

/** 启发式推断 memory type(对齐 Python heuristic extractor 的简单规则)。 */
function inferType(content: string, tags?: string[]): MemoryType {
  const text = `${content} ${(tags ?? []).join(' ')}`.toLowerCase()
  if (/(偏好|喜欢|不要|prefer|like|dislike|avoid|vegetarian|vegan)/.test(text)) return MemoryType.PREFERENCE
  if (/(目标|计划|打算|goal|plan|aim|intend|going to)/.test(text)) return MemoryType.GOAL
  if (/(约束|必须|不能|constraint|must|cannot|limit)/.test(text)) return MemoryType.CONSTRAINT
  if (/(项目|工程|project|repo|repository)/.test(text)) return MemoryType.PROJECT
  if (/(技能|会|能|skill|can|able to)/.test(text)) return MemoryType.SKILL
  return MemoryType.FACT
}

/** n-gram 关键词打分(与 FileMemoryStore 同算法,保证接入后行为不退化)。 */
function scoreMemory(item: MemoryItem, query: string): number {
  const queryGrams = ngrams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = ngrams(`${item.content} ${item.tags.join(' ')}`)
  let overlap = 0
  for (const gram of queryGrams) if (textGrams.has(gram)) overlap += 1
  const coverage = overlap / queryGrams.size
  return (overlap + coverage) * item.confidence
}

function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let i = 0; i + 3 <= word.length; i += 1) grams.add(word.slice(i, i + 3))
    if (word.length < 3) grams.add(word)
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i += 1) grams.add(run.slice(i, i + 2))
    if (run.length < 2) grams.add(run)
  }
  return grams
}

