/**
 * Dream SQLite 存储实现(对齐 Python `SqliteStore`)。
 *
 * 用 better-sqlite3(同步,原生绑定),与 qwicks 现有 HybridThreadStore 同技术栈。
 * 表结构 1:1 对齐 Python SCHEMA_SQLITE;embedding 不存库(由向量库负责)。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MemoryItem,
  MemoryLifecycleStatus as Status,
  newMemoryId,
  nowIso,
  statusHistoryEntryFromDict,
  statusHistoryEntryToDict,
  type MemoryItemDict,
  type MemoryProvenance,
  type MemoryScope,
  type MemoryType,
  type StatusHistoryEntry
} from '../types.js'
import type { ListFilter, MemoryRepository } from './repository.js'

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    scope TEXT NOT NULL,
    tags TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.7,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    provenance TEXT NOT NULL,
    embedding_model TEXT,
    related TEXT NOT NULL,
    metadata TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    status_history TEXT NOT NULL DEFAULT '[]',
    schema_version INTEGER NOT NULL DEFAULT 2
);
CREATE INDEX IF NOT EXISTS ix_memory_user ON memory(user_id);
CREATE INDEX IF NOT EXISTS ix_memory_type ON memory(type);
CREATE INDEX IF NOT EXISTS ix_memory_scope ON memory(scope);
CREATE INDEX IF NOT EXISTS ix_memory_updated ON memory(updated_at);
CREATE INDEX IF NOT EXISTS ix_memory_status ON memory(status);

CREATE TABLE IF NOT EXISTS memory_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    record_id TEXT,
    payload TEXT
);
CREATE INDEX IF NOT EXISTS ix_event_kind ON memory_event(kind);
CREATE INDEX IF NOT EXISTS ix_event_user ON memory_event(user_id);
CREATE INDEX IF NOT EXISTS ix_event_record ON memory_event(record_id);

CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    thread_id TEXT,
    turn_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chat_user ON chat_log(user_id);

CREATE TABLE IF NOT EXISTS memory_user_state (
    user_id TEXT PRIMARY KEY,
    twin_json TEXT NOT NULL,
    generated_at TEXT NOT NULL
);
`

interface MemoryRow {
  id: string
  user_id: string
  type: string
  content: string
  scope: string
  tags: string
  importance: number
  confidence: number
  created_at: string
  updated_at: string
  expires_at: string | null
  provenance: string
  embedding_model: string | null
  related: string
  metadata: string
  status: string
  status_history: string
  schema_version: number
}

export interface SqliteMemoryRepositoryOptions {
  sqlitePath: string
  /** 注入时间(测试用)。 */
  nowIso?: () => string
  /** 注入 id 生成(测试用)。 */
  newId?: () => string
  echo?: boolean
}

export class SqliteMemoryRepository implements MemoryRepository {
  private readonly db: Database.Database
  private readonly now: () => string
  private readonly newId: () => string

  constructor(opts: SqliteMemoryRepositoryOptions) {
    mkdirSync(dirname(opts.sqlitePath), { recursive: true })
    this.db = new Database(opts.sqlitePath)
    this.db.pragma('journal_mode = WAL')
    this.now = opts.nowIso ?? nowIso
    this.newId = opts.newId ?? defaultNewId

    // 先确保 v1 表的 v2 列存在(SCHEMA 用 IF NOT EXISTS 不会改老表),
    // 再建表/索引,最后跑 legacy→canonical 迁移(幂等)。
    this.addV2ColumnsIfMissing()
    this.db.exec(SCHEMA)
    try {
      this.migrateV1ToV2()
    } catch {
      // 防御性:迁移失败不影响打开(对齐 Python 行为)。
    }
  }

  backendName(): string {
    return 'sqlite'
  }

  upsert(item: MemoryItem): MemoryItem {
    if (!item.id) item.id = this.newId()
    item.updatedAt = this.now()
    const params = this.itemToRowParams(item)
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO memory (id, user_id, type, content, scope, tags, importance, confidence,
                            created_at, updated_at, expires_at, provenance, embedding_model, related, metadata,
                            status, status_history, schema_version)
        VALUES (@id,@user_id,@type,@content,@scope,@tags,@importance,@confidence,
                @created_at,@updated_at,@expires_at,@provenance,@embedding_model,@related,@metadata,
                @status,@status_history,@schema_version)
        ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id, type=excluded.type, content=excluded.content,
            scope=excluded.scope, tags=excluded.tags, importance=excluded.importance,
            confidence=excluded.confidence, updated_at=excluded.updated_at,
            expires_at=excluded.expires_at, provenance=excluded.provenance,
            embedding_model=excluded.embedding_model, related=excluded.related,
            metadata=excluded.metadata, status=excluded.status,
            status_history=excluded.status_history, schema_version=excluded.schema_version
      `
      )
      .run(params)
    this.logEvent('upsert', {
      recordId: item.id,
      userId: item.userId,
      payload: {
        type: item.type,
        content_preview: item.content.slice(0, 120),
        status: item.status,
        schema_version: item.schemaVersion
      }
    })
    return item
  }

  upsertBatch(items: MemoryItem[]): MemoryItem[] {
    if (items.length === 0) return []
    const now = this.now()
    const rows: Record<string, unknown>[] = []
    const events: Array<{ at: string; user_id: string; kind: string; record_id: string; payload: string }> = []
    for (const item of items) {
      if (!item.id) item.id = this.newId()
      item.updatedAt = now
      rows.push(this.itemToRowParams(item))
      events.push({
        at: now,
        user_id: item.userId,
        kind: 'upsert',
        record_id: item.id,
        payload: JSON.stringify({
          type: item.type,
          content_preview: item.content.slice(0, 120),
          status: item.status,
          schema_version: item.schemaVersion,
          batch_size: items.length
        })
      })
    }
    const insertMemory = this.db.prepare(
      /* sql */ `
      INSERT INTO memory (id, user_id, type, content, scope, tags, importance, confidence,
                          created_at, updated_at, expires_at, provenance, embedding_model, related, metadata,
                          status, status_history, schema_version)
      VALUES (@id,@user_id,@type,@content,@scope,@tags,@importance,@confidence,
              @created_at,@updated_at,@expires_at,@provenance,@embedding_model,@related,@metadata,
              @status,@status_history,@schema_version)
      ON CONFLICT(id) DO UPDATE SET
          user_id=excluded.user_id, type=excluded.type, content=excluded.content,
          scope=excluded.scope, tags=excluded.tags, importance=excluded.importance,
          confidence=excluded.confidence, updated_at=excluded.updated_at,
          expires_at=excluded.expires_at, provenance=excluded.provenance,
          embedding_model=excluded.embedding_model, related=excluded.related,
          metadata=excluded.metadata, status=excluded.status,
          status_history=excluded.status_history, schema_version=excluded.schema_version
    `
    )
    const insertEvent = this.db.prepare(
      /* sql */ `INSERT INTO memory_event(at, user_id, kind, record_id, payload) VALUES (@at,@user_id,@kind,@record_id,@payload)`
    )
    const tx = this.db.transaction(() => {
      for (const row of rows) insertMemory.run(row)
      for (const e of events) insertEvent.run(e)
    })
    tx()
    return items
  }

  get(id: string): MemoryItem | null {
    const row = this.db.prepare(/* sql */ `SELECT * FROM memory WHERE id=?`).get(id) as
      | MemoryRow
      | undefined
    return row ? this.rowToItem(row) : null
  }

  list(userId?: string, filter: ListFilter = {}): MemoryItem[] {
    const where: string[] = ['1=1']
    const params: unknown[] = []
    if (userId) {
      where.push('user_id=?')
      params.push(userId)
    }
    if (filter.types?.length) {
      where.push(`type IN (${placeholders(filter.types.length)})`)
      params.push(...filter.types)
    }
    if (filter.scopes?.length) {
      where.push(`scope IN (${placeholders(filter.scopes.length)})`)
      params.push(...filter.scopes)
    }
    if (filter.onlyStatus?.length) {
      where.push(`status IN (${placeholders(filter.onlyStatus.length)})`)
      params.push(...filter.onlyStatus)
    } else {
      const excluded: Status[] = []
      if (!filter.includeDeleted) excluded.push(Status.DELETED)
      if (!filter.includeSuppressed) excluded.push(Status.SUPPRESSED)
      if (!filter.includeExpired) excluded.push(Status.EXPIRED)
      if (excluded.length) {
        where.push(`status NOT IN (${placeholders(excluded.length)})`)
        params.push(...excluded)
      }
    }
    const sql = `SELECT * FROM memory WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`
    const rows = this.db.prepare(sql).all(...params) as MemoryRow[]
    return rows.map((row) => this.rowToItem(row))
  }

  delete(id: string, opts: { hard?: boolean } = {}): boolean {
    if (opts.hard) {
      const cur = this.db.prepare(/* sql */ `DELETE FROM memory WHERE id=?`).run(id)
      this.logEvent('hard_delete', { recordId: id })
      return cur.changes > 0
    }
    const existing = this.get(id)
    if (!existing) return false
    if (existing.status !== Status.DELETED) {
      existing.transitionStatus(Status.DELETED, { actor: 'store.delete', reason: 'user_request' })
    }
    this.upsert(existing)
    this.logEvent('tombstone', { recordId: id, userId: existing.userId })
    return true
  }

  migrateV1ToV2(): {
    migratedCount: number
    deletedCount: number
    suppressedCount: number
    expiredCount: number
  } {
    const cols = new Set(
      (this.db.prepare(/* sql */ `PRAGMA table_info(memory)`).all() as Array<{ name: string }>).map(
        (r) => r.name
      )
    )
    if (!cols.has('status')) {
      this.db.exec(/* sql */ `ALTER TABLE memory ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
      this.db.exec(
        /* sql */ `ALTER TABLE memory ADD COLUMN status_history TEXT NOT NULL DEFAULT '[]'`
      )
      this.db.exec(
        /* sql */ `ALTER TABLE memory ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`
      )
      this.db.exec(/* sql */ `CREATE INDEX IF NOT EXISTS ix_memory_status ON memory(status)`)
    }
    const rows = this.db
      .prepare(/* sql */ `SELECT id, metadata, tags, expires_at FROM memory WHERE schema_version < 2`)
      .all() as Array<{ id: string; metadata: string; tags: string; expires_at: string | null }>
    const stats = { migratedCount: 0, deletedCount: 0, suppressedCount: 0, expiredCount: 0 }
    const now = this.now()
    const update = this.db.prepare(
      /* sql */ `UPDATE memory SET status=?, schema_version=2 WHERE id=?`
    )
    for (const row of rows) {
      let md: Record<string, unknown> = {}
      try {
        md = JSON.parse(row.metadata || '{}')
      } catch {
        md = {}
      }
      let tags: unknown[] = []
      try {
        tags = JSON.parse(row.tags || '[]')
      } catch {
        tags = []
      }
      let newStatus: Status
      if (md.__deleted__ === true) {
        newStatus = Status.DELETED
        stats.deletedCount += 1
      } else if (md.do_not_inject === true || tags.includes('__do_not_inject__')) {
        newStatus = Status.SUPPRESSED
        stats.suppressedCount += 1
      } else if (row.expires_at && row.expires_at <= now) {
        newStatus = Status.EXPIRED
        stats.expiredCount += 1
      } else {
        newStatus = Status.ACTIVE
      }
      update.run(newStatus, row.id)
      stats.migratedCount += 1
    }
    return stats
  }

  saveChat(
    userId: string,
    role: string,
    content: string,
    opts: { threadId?: string | null; turnId?: string | null; ts?: string } = {}
  ): void {
    this.db
      .prepare(
        /* sql */ `INSERT INTO chat_log(user_id, thread_id, turn_id, role, content, ts) VALUES (?,?,?,?,?,?)`
      )
      .run(userId, opts.threadId ?? null, opts.turnId ?? null, role, content, opts.ts ?? this.now())
  }

  loadRecentChats(userId: string, limit = 20): Array<{
    userId: string
    threadId: string | null
    turnId: string | null
    role: string
    content: string
    ts: string
  }> {
    const rows = this.db
      .prepare(
        /* sql */ `SELECT user_id, thread_id, turn_id, role, content, ts FROM chat_log WHERE user_id=? ORDER BY id DESC LIMIT ?`
      )
      .all(userId, limit) as Array<{
      user_id: string
      thread_id: string | null
      turn_id: string | null
      role: string
      content: string
      ts: string
    }>
    return rows.reverse().map((r) => ({
      userId: r.user_id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      role: r.role,
      content: r.content,
      ts: r.ts
    }))
  }

  saveTwin(userId: string, twinJson: string, generatedAt: string): void {
    this.db
      .prepare(
        /* sql */ `INSERT INTO memory_user_state(user_id, twin_json, generated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET twin_json=excluded.twin_json, generated_at=excluded.generated_at`
      )
      .run(userId, twinJson, generatedAt)
    this.logEvent('twin_saved', { userId, payload: { bytes: twinJson.length } })
  }

  loadTwin(userId: string): [string, string] | null {
    const row = this.db
      .prepare(
        /* sql */ `SELECT twin_json, generated_at FROM memory_user_state WHERE user_id=?`
      )
      .get(userId) as { twin_json: string; generated_at: string } | undefined
    return row ? [row.twin_json, row.generated_at] : null
  }

  logEvent(
    kind: string,
    opts: { recordId?: string | null; userId?: string | null; payload?: unknown } = {}
  ): void {
    this.db
      .prepare(
        /* sql */ `INSERT INTO memory_event(at, user_id, kind, record_id, payload) VALUES (?,?,?,?,?)`
      )
      .run(
        this.now(),
        opts.userId ?? null,
        kind,
        opts.recordId ?? null,
        opts.payload === undefined ? null : JSON.stringify(opts.payload)
      )
  }

  recentEvents(
    kind?: string,
    opts: { limit?: number } = {}
  ): Array<{ at: string; userId: string | null; kind: string; recordId: string | null; payload: unknown }> {
    const limit = opts.limit ?? 50
    const rows = (kind
      ? this.db
          .prepare(
            /* sql */ `SELECT at, user_id, kind, record_id, payload FROM memory_event WHERE kind=? ORDER BY id DESC LIMIT ?`
          )
          .all(kind, limit)
      : this.db
          .prepare(
            /* sql */ `SELECT at, user_id, kind, record_id, payload FROM memory_event ORDER BY id DESC LIMIT ?`
          )
          .all(limit)) as Array<{
      at: string
      user_id: string | null
      kind: string
      record_id: string | null
      payload: string | null
    }>
    return rows.map((r) => {
      let payload: unknown = null
      if (r.payload) {
        try {
          payload = JSON.parse(r.payload)
        } catch {
          payload = r.payload
        }
      }
      return { at: r.at, userId: r.user_id, kind: r.kind, recordId: r.record_id, payload }
    })
  }

  rawExec(sql: string, params: readonly unknown[] = []): void {
    this.db.prepare(sql).run(...params)
  }

  close(): void {
    this.db.close()
  }

  // ----------------------------------------------------------------
  // 私有辅助
  // ----------------------------------------------------------------

  private addV2ColumnsIfMissing(): void {
    const table = this.db
      .prepare(
        /* sql */ `SELECT name FROM sqlite_master WHERE type='table' AND name='memory'`
      )
      .get() as { name: string } | undefined
    if (!table) return // 还没建表,SCHEMA 会建
    const cols = new Set(
      (this.db.prepare(/* sql */ `PRAGMA table_info(memory)`).all() as Array<{ name: string }>).map(
        (r) => r.name
      )
    )
    if (!cols.has('status')) {
      this.db.exec(/* sql */ `ALTER TABLE memory ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
    }
    if (!cols.has('status_history')) {
      this.db.exec(
        /* sql */ `ALTER TABLE memory ADD COLUMN status_history TEXT NOT NULL DEFAULT '[]'`
      )
    }
    if (!cols.has('schema_version')) {
      this.db.exec(
        /* sql */ `ALTER TABLE memory ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`
      )
    }
  }

  private itemToRowParams(item: MemoryItem): Record<string, unknown> {
    return {
      id: item.id,
      user_id: item.userId,
      type: item.type,
      content: item.content,
      scope: item.scope,
      tags: JSON.stringify(item.tags),
      importance: item.importance,
      confidence: item.confidence,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      expires_at: item.expiresAt,
      provenance: JSON.stringify(item.provenance.toDict()),
      embedding_model: item.embeddingModel,
      related: JSON.stringify(item.related),
      metadata: JSON.stringify(item.metadata),
      status: item.status,
      status_history: JSON.stringify(item.statusHistory.map(statusHistoryEntryToDict)),
      schema_version: item.schemaVersion
    }
  }

  private rowToItem(row: MemoryRow): MemoryItem {
    const dict: MemoryItemDict = {
      id: row.id,
      user_id: row.user_id,
      type: row.type,
      content: row.content,
      scope: row.scope,
      tags: parseJsonArray(row.tags),
      importance: row.importance,
      confidence: row.confidence,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      provenance: parseJsonObject(row.provenance) as unknown as MemoryProvenance,
      embedding: null, // embedding 不入库(由向量库负责),对齐 Python
      embedding_model: row.embedding_model,
      related: parseJsonArray(row.related),
      metadata: parseJsonObject(row.metadata),
      status: row.status,
      status_history: parseStatusHistory(row.status_history),
      schema_version: row.schema_version
    }
    return MemoryItem.fromDict(dict)
  }
}

// 注:MemoryItem/MemoryLifecycleStatus 作为值导入(类/枚举),其余类型用 type-only。

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseStatusHistory(raw: string | null | undefined): StatusHistoryEntry[] {
  const arr = parseJsonArray(raw) as Array<Record<string, unknown>>
  return arr.map((e) => statusHistoryEntryFromDict(e))
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

function defaultNewId(): string {
  return newMemoryId()
}
