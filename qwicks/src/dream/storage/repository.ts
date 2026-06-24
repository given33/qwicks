/**
 * Dream 存储层接口(对齐 Python `StructuredMemoryStore` 协议)。
 *
 * 决策:仅 SQLite 实现(better-sqlite3),不移植有 bug 的 Postgres 后端。所有调用方
 * 都只看 `MemoryRepository` 接口;未来若需要别的后端,实现此接口即可。
 *
 * v3:扩展 ListFilter(topic/onlyTopOfMind/hasSourceId)+ source record / suppression rule 方法。
 */
import type {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryScope,
  MemoryType,
  SourceRecord,
  SuppressionRule
} from '../types.js'

export interface ListFilter {
  types?: readonly MemoryType[]
  scopes?: readonly MemoryScope[]
  /** 显式只返回这些 status(优先于 includeSuppressed/includeExpired/includeDeleted)。 */
  onlyStatus?: readonly MemoryLifecycleStatus[]
  includeDeleted?: boolean
  includeSuppressed?: boolean
  includeExpired?: boolean
  /** v3:按 topic 过滤。 */
  topic?: string
  /** v3:只返回 top-of-mind。 */
  onlyTopOfMind?: boolean
  /** v3:按 source_ids 包含某 source 过滤。 */
  hasSourceId?: string
}

export interface MemoryRepository {
  backendName(): string

  /** 插入或更新。无 id 时分配;总是刷新 updatedAt。返回落库后的 item。 */
  upsert(item: MemoryItem): MemoryItem
  /** 批量 upsert,单事务(对齐 Python upsert_batch)。返回与输入同序。 */
  upsertBatch(items: MemoryItem[]): MemoryItem[]

  get(id: string): MemoryItem | null

  /**
   * 列出 memory。默认排除 deleted/suppressed/expired(对齐 Python list)。
   * onlyStatus 优先:给出时只返回这些 status,不再做默认排除。
   */
  list(userId?: string, filter?: ListFilter): MemoryItem[]

  /** 软删(transition 到 DELETED)或硬删(删行)。返回是否命中。 */
  delete(id: string, opts?: { hard?: boolean }): boolean

  /** 渐进迁移:旧 schema(无 status) → v2,返回统计。幂等。 */
  migrateV1ToV2(): {
    migratedCount: number
    deletedCount: number
    suppressedCount: number
    expiredCount: number
  }

  /** v3 迁移:补 v3 列默认值,把 schema_version<3 的记录提升到 3。幂等。 */
  migrateV2ToV3(): { migratedCount: number }

  // ---- chat log ----
  saveChat(
    userId: string,
    role: string,
    content: string,
    opts?: { threadId?: string | null; turnId?: string | null; ts?: string }
  ): void
  loadRecentChats(userId: string, limit?: number): Array<{
    userId: string
    threadId: string | null
    turnId: string | null
    role: string
    content: string
    ts: string
  }>

  // ---- digital twin ----
  saveTwin(userId: string, twinJson: string, generatedAt: string): void
  loadTwin(userId: string): [twinJson: string, generatedAt: string] | null

  // ---- v3: source records ----
  upsertSource(source: SourceRecord): SourceRecord
  getSource(id: string): SourceRecord | null
  listSources(userId: string, opts?: { sourceType?: string; includeDeleted?: boolean }): SourceRecord[]
  /** 按 external_ref(如 chat threadId/turnId / gmail messageId)查来源。 */
  findSourceByExternalRef(userId: string, sourceType: string, externalRef: string): SourceRecord | null
  /** 软删来源(标记 deleted=true;保留以供派生谱系查询)。 */
  deleteSource(id: string, opts?: { hard?: boolean }): boolean
  /** 列出派生自某 source 的所有 memory(按 source_ids 包含 sourceId)。 */
  memoriesDerivedFromSource(userId: string, sourceId: string): MemoryItem[]

  // ---- v3: suppression rules ----
  upsertSuppression(rule: SuppressionRule): SuppressionRule
  getSuppression(id: string): SuppressionRule | null
  listSuppressions(userId: string, opts?: { includeInactive?: boolean }): SuppressionRule[]
  /** 按 scope+target 查规则(去重用)。 */
  findSuppression(userId: string, scope: string, target: string): SuppressionRule | null
  /** 删除抑制规则(物理删除,与 memory 的软删不同:规则就是规则,删=移除)。 */
  deleteSuppression(id: string): boolean

  // ---- event log ----
  logEvent(
    kind: string,
    opts?: { recordId?: string | null; userId?: string | null; payload?: unknown }
  ): void
  recentEvents(
    kind?: string,
    opts?: { limit?: number }
  ): Array<{ at: string; userId: string | null; kind: string; recordId: string | null; payload: unknown }>

  close(): void

  /** 直接执行裸 SQL(供 purge/cleanup 使用)。 */
  rawExec(sql: string, params?: readonly unknown[]): void

  // ---- 2.1(工业级):用户记忆设置(持久化双开关) ----
  getMemorySettings(userId: string): { savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }
  setMemorySettings(userId: string, settings: Partial<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }>): void

  // ---- 3.1(工业级):durable dream job queue ----
  enqueueDreamJob(job: { type: string; userId: string; payload?: unknown; dueAt?: string }): string
  claimDueDreamJobs(limit?: number): Array<{ id: string; type: string; userId: string; payload: unknown; attempts: number }>
  completeDreamJob(jobId: string): void
  failDreamJob(jobId: string, error: string, opts?: { maxRetries?: number; baseDelayMs?: number }): void
  dreamJobStats(userId?: string): { pending: number; running: number; retrying: number; dead: number; completed: number; lastCompletedAt: string | null }
}

/** 内部辅助:直接执行裸 SQL(仅供测试/迁移使用)。 */
export interface RawExec {
  rawExec(sql: string, params?: readonly unknown[]): void
}
