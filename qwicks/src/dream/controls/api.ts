/**
 * Dream 记忆控制 / 隐私层 —— 1:1 对齐 Python `dream/controls/api.py`。
 *
 * 提供:listMemories / getMemory / editMemory / deleteMemory(soft/hard) /
 * suppressMemory(Don't-mention-again, ≠ 删除)/ optOut / optIn / isOptedOut /
 * export / purge。外加 Phase 3 新增的版本历史(editMemory 记录 snapshot,
 * versionHistory 列出,restoreVersion 按日期回滚)。
 *
 * 版本历史实现:每次 editMemory 把"改之前"的 item 快照写进 memory_event
 * (kind=version_snapshot),versionHistory 读这些事件,restoreVersion 把指定
 * 快照的内容/标签/重要度写回。
 */
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType,
  newSourceId,
  newSuppressionId,
  nowIso,
  parseMemoryType,
  SourceRecord,
  SourceType,
  SuppressionRule,
  SuppressionScope,
  TemporalState
} from '../types.js'
import type { MemoryRepository } from '../storage/repository.js'

const OPT_OUT_TAG = '__memory_opt_out__'

export interface UpsertDirectInput {
  id: string
  userId: string
  type: MemoryType
  content: string
  importance?: number
  confidence?: number
}

export interface ListMemoriesOptions {
  types?: readonly MemoryType[]
  scopes?: readonly MemoryScope[]
  includeDeleted?: boolean
  search?: string
}

export interface EditMemoryInput {
  content?: string
  importance?: number
  tags?: string[]
  type?: MemoryType
}

export interface VersionSnapshot {
  versionId: string
  at: string
  content: string
  importance: number
  tags: string[]
  type: MemoryType
}

export interface ExportResult {
  userId: string
  exportedAt: string
  memories: MemoryItem[]
  /** 1.3(工业级):分区输出 —— 显式保存的记忆(用户主动 remember)。 */
  savedMemories?: MemoryItem[]
  /** 1.3:从聊天历史推断的记忆。 */
  chatInferredMemories?: MemoryItem[]
  /** 1.3:从连接器(Gmail/Drive/File)推断的记忆。 */
  connectorMemories?: MemoryItem[]
  chats: Array<{ userId: string; threadId: string | null; turnId: string | null; role: string; content: string; ts: string }>
  twin: unknown
  twinGeneratedAt: string | null
}

export interface MemoryControlsOptions {
  repository: MemoryRepository
  nowIso?: () => string
  idGenerator?: () => string
}

export class MemoryControls {
  private readonly now: () => string
  private readonly newId: () => string

  constructor(private readonly opts: MemoryControlsOptions) {
    this.now = opts.nowIso ?? nowIso
    this.newId = opts.idGenerator ?? defaultVersionId
  }

  /** 直接 upsert(测试 / 内部注入用;不走 edit 版本快照)。 */
  upsertDirect(input: UpsertDirectInput): MemoryItem {
    const item = new MemoryItem(
      input.id,
      input.userId,
      input.type,
      input.content,
      MemoryScope.USER,
      [],
      input.importance ?? 0.5,
      input.confidence ?? 0.7,
      this.now(),
      this.now(),
      null,
      new MemoryProvenance('user')
    )
    return this.opts.repository.upsert(item)
  }

  listMemories(userId: string, opts: ListMemoriesOptions = {}): MemoryItem[] {
    let items = this.opts.repository.list(userId, {
      types: opts.types,
      scopes: opts.scopes,
      includeDeleted: opts.includeDeleted ?? false
    })
    if (opts.search) {
      const s = opts.search.toLowerCase()
      items = items.filter((it) => it.content.toLowerCase().includes(s) || it.tags.some((t) => t.toLowerCase().includes(s)))
    }
    return items
  }

  getMemory(memoryId: string): MemoryItem | null {
    return this.opts.repository.get(memoryId)
  }

  editMemory(memoryId: string, patch: EditMemoryInput): MemoryItem | null {
    const before = this.opts.repository.get(memoryId)
    if (!before) return null
    // 先存版本快照(改之前的状态)
    this.recordSnapshot(before)
    if (patch.content !== undefined) before.content = patch.content
    if (patch.importance !== undefined) before.importance = Math.max(0, Math.min(1, patch.importance))
    if (patch.tags !== undefined) before.tags = [...patch.tags]
    if (patch.type !== undefined) before.type = patch.type
    before.metadata.edited_at = this.now()
    return this.opts.repository.upsert(before)
  }

  deleteMemory(memoryId: string, opts: { hard?: boolean } = {}): boolean {
    return this.opts.repository.delete(memoryId, { hard: opts.hard ?? false })
  }

  /** "Don't mention this again" —— 抑制提及(≠ 删除)。transition 到 SUPPRESSED。 */
  suppressMemory(memoryId: string): MemoryItem | null {
    const item = this.opts.repository.get(memoryId)
    if (!item) return null
    if (item.status !== MemoryLifecycleStatus.SUPPRESSED) {
      item.transitionStatus(MemoryLifecycleStatus.SUPPRESSED, { actor: 'controls.suppress', reason: 'dont_mention' })
    }
    return this.opts.repository.upsert(item)
  }

  optOut(userId: string, reason = 'user_request'): void {
    const marker = new MemoryItem(
      `optout_${userId}`,
      userId,
      MemoryType.PREFERENCE,
      `Dream 记忆系统已被该用户禁用 (reason=${reason})`,
      MemoryScope.USER,
      [OPT_OUT_TAG, 'preference'],
      1,
      1,
      this.now(),
      this.now(),
      null,
      new MemoryProvenance('user', null, null, null, 1, undefined, `opt_out: ${reason}`),
      null,
      null,
      [],
      { opt_out: true, reason, opt_out_at: this.now() }
    )
    this.opts.repository.upsert(marker)
  }

  optIn(userId: string): number {
    const items = this.opts.repository.list(userId, { includeDeleted: true, includeSuppressed: true, includeExpired: true })
    let removed = 0
    for (const it of items) {
      if (it.tags.includes(OPT_OUT_TAG) || it.metadata.opt_out === true) {
        this.opts.repository.delete(it.id, { hard: true })
        removed += 1
      }
    }
    return removed
  }

  isOptedOut(userId: string): boolean {
    const items = this.opts.repository.list(userId, {})
    return items.some((it) => it.tags.includes(OPT_OUT_TAG) || it.metadata.opt_out === true)
  }

  /**
   * 1.3(工业级):导出记忆数据。
   * @param opts.shareableOnly - 仅导出可共享内容(过滤 shareable=false + sensitivity=restricted)。
   *   默认 false(完整导出,用于用户自己下载)。
   * @param opts.partitionBySource - 按 saved/chat/connector 分区输出(对齐文档"区分 saved 与 chat-inferred")。
   *   默认 true。
   */
  export(userId: string, opts: { shareableOnly?: boolean; partitionBySource?: boolean } = {}): ExportResult {
    const shareableOnly = opts.shareableOnly === true
    const partition = opts.partitionBySource !== false
    let memories = this.opts.repository.list(userId, { includeDeleted: true, includeSuppressed: true, includeExpired: true })
    // 隐私过滤
    if (shareableOnly) {
      memories = memories.filter((m) => m.shareable && m.sensitivity !== 'restricted')
    }
    const chats = this.opts.repository.loadRecentChats(userId, 10_000)
    const twin = this.opts.repository.loadTwin(userId)
    if (!partition) {
      return {
        userId,
        exportedAt: this.now(),
        memories,
        chats,
        twin: twin ? safeJsonParse(twin[0]) : null,
        twinGeneratedAt: twin ? twin[1] : null
      }
    }
    // 分区:savedMemories / chatInferredMemories / connectorMemories
    const savedMemories = memories.filter((m) => m.provenance.source === 'user')
    const chatInferredMemories = memories.filter((m) => m.provenance.source === 'chat')
    const connectorMemories = memories.filter((m) => m.provenance.source === 'connector' || m.provenance.source === 'file' || m.provenance.source === 'gmail' || m.provenance.source === 'drive')
    return {
      userId,
      exportedAt: this.now(),
      memories,
      savedMemories,
      chatInferredMemories,
      connectorMemories,
      chats,
      twin: twin ? safeJsonParse(twin[0]) : null,
      twinGeneratedAt: twin ? twin[1] : null
    } as ExportResult
  }

  /**
   * 1.2(工业级 GDPR):彻底清空用户全部记忆数据。
   * 清理 memory + source_record + suppression_rule + memory_source_link + chat_log + memory_user_state + memory_event。
   */
  purge(userId: string): number {
    const items = this.opts.repository.list(userId, { includeDeleted: true, includeSuppressed: true, includeExpired: true })
    const count = items.length
    for (const it of items) {
      this.opts.repository.delete(it.id, { hard: true })
    }
    // 清理其余表(对齐 GDPR 全量擦除)
    this.opts.repository.rawExec(`DELETE FROM source_record WHERE user_id=?`, [userId])
    this.opts.repository.rawExec(`DELETE FROM suppression_rule WHERE user_id=?`, [userId])
    this.opts.repository.rawExec(`DELETE FROM memory_source_link WHERE user_id=?`, [userId])
    this.opts.repository.rawExec(`DELETE FROM chat_log WHERE user_id=?`, [userId])
    this.opts.repository.rawExec(`DELETE FROM memory_user_state WHERE user_id=?`, [userId])
    this.opts.repository.rawExec(`DELETE FROM memory_event WHERE user_id=?`, [userId])
    this.opts.repository.logEvent('purge', { userId, payload: { memory_count: count } })
    return count
  }

  // ----------------------------------------------------------------
  // 版本历史(对齐文档 §5.2 "查看 saved memories 历史版本并按日期恢复")
  // ----------------------------------------------------------------

  /** 列出某条 memory 的所有历史快照(newest-first)。 */
  versionHistory(memoryId: string): VersionSnapshot[] {
    const events = this.opts.repository.recentEvents('version_snapshot', { limit: 500 })
    const snaps: VersionSnapshot[] = []
    for (const e of events) {
      const p = e.payload as { memory_id?: string; content?: string; importance?: number; tags?: string[]; type?: string; version_id?: string } | null
      if (!p || p.memory_id !== memoryId) continue
      snaps.push({
        versionId: p.version_id ?? '',
        at: e.at,
        content: String(p.content ?? ''),
        importance: typeof p.importance === 'number' ? p.importance : 0.5,
        tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
        type: typeof p.type === 'string' ? parseMemoryType(p.type) : MemoryType.FACT
      })
    }
    return snaps
  }

  /** 把指定版本快照的内容回滚写回(创建一个新快照保存当前,然后写入旧版本)。 */
  restoreVersion(memoryId: string, versionId: string): MemoryItem | null {
    const history = this.versionHistory(memoryId)
    const target = history.find((s) => s.versionId === versionId)
    if (!target) return null
    const current = this.opts.repository.get(memoryId)
    // 1.2(工业级):状态守卫 —— DELETED/CONNECTOR_REVOKED 的记忆不可恢复,
    // 防止通过版本回滚复活已删除/已撤销的隐私数据。
    if (current && (current.status === MemoryLifecycleStatus.DELETED || current.status === MemoryLifecycleStatus.CONNECTOR_REVOKED)) {
      return null
    }
    if (!current) return null
    // 先保存当前状态为新快照(回滚也是一种 edit)
    this.recordSnapshot(current)
    current.content = target.content
    current.importance = target.importance
    current.tags = [...target.tags]
    current.type = target.type
    current.metadata.restored_at = this.now()
    return this.opts.repository.upsert(current)
  }

  private recordSnapshot(item: MemoryItem): void {
    this.opts.repository.logEvent('version_snapshot', {
      recordId: item.id,
      payload: {
        memory_id: item.id,
        version_id: this.newId(),
        at: this.now(),
        content: item.content,
        importance: item.importance,
        tags: [...item.tags],
        type: item.type
      }
    })
  }

  // ================================================================
  // v3: Source Records(文档 §6 Memory Sources / §1 source lineage)
  // ================================================================

  /**
   * 创建/更新来源记录。若同 (userId, sourceType, externalRef) 已存在则复用其 id,
   * 实现 chat/file/gmail 来源的幂等摄入。
   */
  upsertSource(input: {
    userId: string
    sourceType: SourceType
    externalRef?: string | null
    title?: string | null
    content?: string | null
    attrs?: Record<string, unknown>
    id?: string
  }): SourceRecord {
    // 去重:同 (user, type, externalRef) 复用 id
    let id = input.id
    if (!id && input.externalRef) {
      const existing = this.opts.repository.findSourceByExternalRef(
        input.userId,
        input.sourceType,
        input.externalRef
      )
      if (existing) id = existing.id
    }
    const source = new SourceRecord(
      id ?? newSourceId(),
      input.userId,
      input.sourceType,
      input.externalRef ?? null,
      input.title ?? null,
      input.content ?? null,
      input.attrs ?? {}
    )
    return this.opts.repository.upsertSource(source)
  }

  getSource(sourceId: string): SourceRecord | null {
    return this.opts.repository.getSource(sourceId)
  }

  listSources(userId: string, opts: { sourceType?: SourceType; includeDeleted?: boolean } = {}): SourceRecord[] {
    return this.opts.repository.listSources(userId, opts)
  }

  /**
   * 删除来源。软删(默认)保留行以便谱系查询;hard=true 物理删除。
   * 注意:此方法只删 source 本身,不级联删派生 memory —— 用 deleteSourceAndDerived
   * 做级联删除(文档 §9 "删除由来源派生出的 inferred memories")。
   */
  deleteSource(sourceId: string, opts: { hard?: boolean } = {}): boolean {
    return this.opts.repository.deleteSource(sourceId, opts)
  }

  /**
   * 级联删除:删来源 + 所有派生自它的 inferred memory(文档 §9 deletion lineage)。
   * 返回受影响的 memory 数。saved memory 类型不级联(用户显式保存的需单独删)。
   */
  deleteSourceAndDerived(sourceId: string, opts: { hard?: boolean } = {}): {
    sourceDeleted: boolean
    derivedDeleted: number
    derivedMemoryIds: string[]
  } {
    const source = this.opts.repository.getSource(sourceId)
    if (!source) {
      return { sourceDeleted: false, derivedDeleted: 0, derivedMemoryIds: [] }
    }
    const derived = this.opts.repository.memoriesDerivedFromSource(source.userId, sourceId)
    const derivedIds: string[] = []
    for (const m of derived) {
      // 跳过用户显式保存的(saved memory 类型)—— 文档要求保留除非用户单独删
      if (m.provenance.source === 'user' && source.sourceType === SourceType.SAVED_MEMORY) {
        continue
      }
      this.opts.repository.delete(m.id, opts)
      derivedIds.push(m.id)
    }
    const sourceDeleted = this.opts.repository.deleteSource(sourceId, opts)
    this.opts.repository.logEvent('cascade_delete', {
      recordId: sourceId,
      userId: source.userId,
      payload: {
        source_type: source.sourceType,
        derived_count: derivedIds.length,
        derived_memory_ids: derivedIds,
        hard: opts.hard === true
      }
    })
    return { sourceDeleted, derivedDeleted: derivedIds.length, derivedMemoryIds: derivedIds }
  }

  /** 列出派生自某来源的 memory(谱系查询,文档 §1 memory source lineage)。 */
  memoriesDerivedFromSource(userId: string, sourceId: string): MemoryItem[] {
    return this.opts.repository.memoriesDerivedFromSource(userId, sourceId)
  }

  // ================================================================
  // v3: Suppression Rules(文档 §8 Don't mention this again)
  // ================================================================

  /**
   * 创建/更新抑制规则(≠ 删除)。幂等:同 (user, scope, target) 复用。
   * 返回落库后的规则。用户明确询问时系统仍可解释相关信息。
   */
  suppress(input: {
    userId: string
    scope: SuppressionScope
    target: string
    reason?: string | null
  }): SuppressionRule {
    const existing = this.opts.repository.findSuppression(
      input.userId,
      input.scope,
      input.target
    )
    const rule = new SuppressionRule(
      existing?.id ?? newSuppressionId(),
      input.userId,
      input.scope,
      input.target,
      input.reason ?? null,
      undefined,
      true
    )
    const saved = this.opts.repository.upsertSuppression(rule)
    // MEMORY scope:同时同步 memory.isSuppressed flag(便于检索快速过滤)
    if (input.scope === SuppressionScope.MEMORY) {
      const m = this.opts.repository.get(input.target)
      if (m) {
        m.isSuppressed = true
        this.opts.repository.upsert(m)
      }
    }
    return saved
  }

  /** 列出用户的所有活跃抑制规则。 */
  listSuppressions(userId: string, opts: { includeInactive?: boolean } = {}): SuppressionRule[] {
    return this.opts.repository.listSuppressions(userId, opts)
  }

  /** 恢复(取消)抑制 —— 不删除规则记录,只置 active=false。 */
  unsuppress(userId: string, scope: SuppressionScope, target: string): boolean {
    const existing = this.opts.repository.findSuppression(userId, scope, target)
    if (!existing) return false
    existing.active = false
    this.opts.repository.upsertSuppression(existing)
    if (scope === SuppressionScope.MEMORY) {
      const m = this.opts.repository.get(target)
      if (m) {
        m.isSuppressed = false
        this.opts.repository.upsert(m)
      }
    }
    return true
  }

  /** 物理删除抑制规则(彻底移除,与 unsuppress 区分:后者保留记录)。 */
  deleteSuppression(ruleId: string): boolean {
    return this.opts.repository.deleteSuppression(ruleId)
  }

  /** 判断某 memory/topic 是否被抑制(检索/注入前过滤用)。 */
  isSuppressed(
    userId: string,
    scope: SuppressionScope,
    target: string
  ): boolean {
    const rule = this.opts.repository.findSuppression(userId, scope, target)
    return rule !== null && rule.active
  }

  // ================================================================
  // v3: Temporal state controls(文档 §4 dreaming 时间转换)
  // ================================================================

  /**
   * 手动把一条 PLANNED memory 转为 OCCURRED(旅行结束 → 历史)。
   * 返回更新后的 memory 或 null。也供 dreaming 自动调用。
   */
  markOccurred(
    memoryId: string,
    historyContent: string,
    opts: { reason?: string | null } = {}
  ): MemoryItem | null {
    const m = this.opts.repository.get(memoryId)
    if (!m) return null
    m.transitionToOccurred(historyContent, { reason: opts.reason ?? 'manual_mark_occurred' })
    return this.opts.repository.upsert(m)
  }

  // ================================================================
  // v3: Reference chat history 控制(文档 §3)
  // ================================================================

  /**
   * 关闭"reference chat history":删除所有由 chat 推断的 inferred memory,
   * 保留显式 saved memory + 原始 chat_log(文档 §3 "关闭时停止使用并标记/删除
   * 由历史聊天推断出的 inferred memories")。
   * 返回删除的 memory 数。
   */
  disableReferenceChatHistory(userId: string): { removedInferred: number; removedIds: string[] } {
    const all = this.opts.repository.list(userId, {
      includeDeleted: true,
      includeSuppressed: true,
      includeExpired: true
    })
    const removedIds: string[] = []
    for (const m of all) {
      // 只删 provenance.source 为 chat 的 inferred memory
      if (m.provenance.source === 'chat') {
        this.opts.repository.delete(m.id, { hard: true })
        removedIds.push(m.id)
      }
    }
    this.opts.repository.logEvent('disable_reference_chat_history', {
      userId,
      payload: { removed_count: removedIds.length, removed_ids: removedIds }
    })
    return { removedInferred: removedIds.length, removedIds }
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function defaultVersionId(): string {
  return `ver_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}
