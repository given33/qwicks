/**
 * Dream SQLite 存储实现(对齐 Python `SqliteStore`)。
 *
 * 用 better-sqlite3(同步,原生绑定),与 qwicks 现有 HybridThreadStore 同技术栈。
 * 表结构 1:1 对齐 Python SCHEMA_SQLITE;embedding 不存库(由向量库负责)。
 *
 * v3:新增 v3 列(normalized_facts/source_ids/temporal_state/valid_from/valid_until/
 * supersedes/superseded_by/is_top_of_mind/is_suppressed/user_corrected/salience/
 * topic/last_used_at/sensitivity/shareable)+ source_record 表 + suppression_rule 表。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MemoryItem,
  MemoryLifecycleStatus as Status,
  newMemoryId,
  nowIso,
  SourceRecord,
  SuppressionRule,
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
    schema_version INTEGER NOT NULL DEFAULT 2,
    -- v3 列(addV3ColumnsIfMissing 负责补齐)
    normalized_facts TEXT NOT NULL DEFAULT '[]',
    source_ids TEXT NOT NULL DEFAULT '[]',
    temporal_state TEXT NOT NULL DEFAULT 'current',
    valid_from TEXT,
    valid_until TEXT,
    supersedes TEXT NOT NULL DEFAULT '[]',
    superseded_by TEXT NOT NULL DEFAULT '[]',
    is_top_of_mind INTEGER NOT NULL DEFAULT 0,
    is_suppressed INTEGER NOT NULL DEFAULT 0,
    user_corrected INTEGER NOT NULL DEFAULT 0,
    salience REAL NOT NULL DEFAULT 0.5,
    topic TEXT,
    last_used_at TEXT,
    sensitivity TEXT NOT NULL DEFAULT 'normal',
    shareable INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_memory_user ON memory(user_id);
CREATE INDEX IF NOT EXISTS ix_memory_type ON memory(type);
CREATE INDEX IF NOT EXISTS ix_memory_scope ON memory(scope);
CREATE INDEX IF NOT EXISTS ix_memory_updated ON memory(updated_at);
CREATE INDEX IF NOT EXISTS ix_memory_status ON memory(status);
CREATE INDEX IF NOT EXISTS ix_memory_topic ON memory(topic);
CREATE INDEX IF NOT EXISTS ix_memory_top_of_mind ON memory(is_top_of_mind);

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

-- v3:来源记录(chat/file/gmail/custom_instruction/saved_memory/drive)
CREATE TABLE IF NOT EXISTS source_record (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    external_ref TEXT,
    title TEXT,
    content TEXT,
    attrs TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_source_user ON source_record(user_id);
CREATE INDEX IF NOT EXISTS ix_source_type ON source_record(source_type);
CREATE INDEX IF NOT EXISTS ix_source_extref ON source_record(user_id, source_type, external_ref);

-- v3:抑制规则("Don't mention this again")
CREATE TABLE IF NOT EXISTS suppression_rule (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, scope, target)
);
CREATE INDEX IF NOT EXISTS ix_suppression_user ON suppression_rule(user_id);
CREATE INDEX IF NOT EXISTS ix_suppression_scope ON suppression_rule(scope);

-- v3(报告 §7.3):规范化的 memory↔source 关联表。
-- 与 memory.source_ids JSON 列并存(JSON 列向后兼容,此表用于可靠 JOIN 查询)。
CREATE TABLE IF NOT EXISTS memory_source_link (
    memory_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (memory_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_msl_source ON memory_source_link(source_id);
CREATE INDEX IF NOT EXISTS ix_msl_user_source ON memory_source_link(user_id, source_id);
CREATE INDEX IF NOT EXISTS ix_msl_memory ON memory_source_link(memory_id);
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
  normalized_facts: string
  source_ids: string
  temporal_state: string
  valid_from: string | null
  valid_until: string | null
  supersedes: string
  superseded_by: string
  is_top_of_mind: number
  is_suppressed: number
  user_corrected: number
  salience: number
  topic: string | null
  last_used_at: string | null
  sensitivity: string
  shareable: number
}

interface SourceRow {
  id: string
  user_id: string
  source_type: string
  external_ref: string | null
  title: string | null
  content: string | null
  attrs: string
  created_at: string
  ingested_at: string
  deleted: number
}

interface SuppressionRow {
  id: string
  user_id: string
  scope: string
  target: string
  reason: string | null
  created_at: string
  active: number
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

    // 先确保 v1/v3 表的列存在(SCHEMA 用 IF NOT EXISTS 不会改老表),
    // 再建表/索引,最后跑 legacy→canonical 迁移(幂等)。
    this.addV2ColumnsIfMissing()
    this.addV3ColumnsIfMissing()
    this.db.exec(SCHEMA)
    try {
      this.migrateV1ToV2()
      this.migrateV2ToV3()
    } catch (err) {
      this.logEvent('migration_error', { payload: { error: String(err) } })
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
                            status, status_history, schema_version,
                            normalized_facts, source_ids, temporal_state, valid_from, valid_until,
                            supersedes, superseded_by, is_top_of_mind, is_suppressed, user_corrected,
                            salience, topic, last_used_at, sensitivity, shareable)
        VALUES (@id,@user_id,@type,@content,@scope,@tags,@importance,@confidence,
                @created_at,@updated_at,@expires_at,@provenance,@embedding_model,@related,@metadata,
                @status,@status_history,@schema_version,
                @normalized_facts,@source_ids,@temporal_state,@valid_from,@valid_until,
                @supersedes,@superseded_by,@is_top_of_mind,@is_suppressed,@user_corrected,
                @salience,@topic,@last_used_at,@sensitivity,@shareable)
        ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id, type=excluded.type, content=excluded.content,
            scope=excluded.scope, tags=excluded.tags, importance=excluded.importance,
            confidence=excluded.confidence, updated_at=excluded.updated_at,
            expires_at=excluded.expires_at, provenance=excluded.provenance,
            embedding_model=excluded.embedding_model, related=excluded.related,
            metadata=excluded.metadata, status=excluded.status,
            status_history=excluded.status_history, schema_version=excluded.schema_version,
            normalized_facts=excluded.normalized_facts, source_ids=excluded.source_ids,
            temporal_state=excluded.temporal_state, valid_from=excluded.valid_from,
            valid_until=excluded.valid_until, supersedes=excluded.supersedes,
            superseded_by=excluded.superseded_by, is_top_of_mind=excluded.is_top_of_mind,
            is_suppressed=excluded.is_suppressed, user_corrected=excluded.user_corrected,
            salience=excluded.salience, topic=excluded.topic, last_used_at=excluded.last_used_at,
            sensitivity=excluded.sensitivity, shareable=excluded.shareable
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
        schema_version: item.schemaVersion,
        temporal_state: item.temporalState,
        topic: item.topic
      }
    })
    // v3(报告 §7.3):同步 memory_source_link 规范化表(与 source_ids JSON 列并存)
    this.syncSourceLinks(item)
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
                          status, status_history, schema_version,
                          normalized_facts, source_ids, temporal_state, valid_from, valid_until,
                          supersedes, superseded_by, is_top_of_mind, is_suppressed, user_corrected,
                          salience, topic, last_used_at, sensitivity, shareable)
      VALUES (@id,@user_id,@type,@content,@scope,@tags,@importance,@confidence,
              @created_at,@updated_at,@expires_at,@provenance,@embedding_model,@related,@metadata,
              @status,@status_history,@schema_version,
              @normalized_facts,@source_ids,@temporal_state,@valid_from,@valid_until,
              @supersedes,@superseded_by,@is_top_of_mind,@is_suppressed,@user_corrected,
              @salience,@topic,@last_used_at,@sensitivity,@shareable)
      ON CONFLICT(id) DO UPDATE SET
          user_id=excluded.user_id, type=excluded.type, content=excluded.content,
          scope=excluded.scope, tags=excluded.tags, importance=excluded.importance,
          confidence=excluded.confidence, updated_at=excluded.updated_at,
          expires_at=excluded.expires_at, provenance=excluded.provenance,
          embedding_model=excluded.embedding_model, related=excluded.related,
          metadata=excluded.metadata, status=excluded.status,
          status_history=excluded.status_history, schema_version=excluded.schema_version,
          normalized_facts=excluded.normalized_facts, source_ids=excluded.source_ids,
          temporal_state=excluded.temporal_state, valid_from=excluded.valid_from,
          valid_until=excluded.valid_until, supersedes=excluded.supersedes,
          superseded_by=excluded.superseded_by, is_top_of_mind=excluded.is_top_of_mind,
          is_suppressed=excluded.is_suppressed, user_corrected=excluded.user_corrected,
          salience=excluded.salience, topic=excluded.topic, last_used_at=excluded.last_used_at,
          sensitivity=excluded.sensitivity, shareable=excluded.shareable
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
    // v3 filters
    if (filter.topic) {
      where.push('topic=?')
      params.push(filter.topic)
    }
    if (filter.onlyTopOfMind) {
      where.push('is_top_of_mind=1')
    }
    if (filter.hasSourceId) {
      // JSON array containment: source_ids LIKE '%"sourceId"%'
      where.push('source_ids LIKE ?')
      params.push(`%"${filter.hasSourceId.replace(/"/g, '\\"')}"%`)
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

  migrateV2ToV3(): { migratedCount: number } {
    // 把所有 schema_version<3 的记录提升到 3(v3 列已有默认值,无需补内容)。
    const res = this.db
      .prepare(/* sql */ `UPDATE memory SET schema_version=3 WHERE schema_version<3`)
      .run()
    return { migratedCount: res.changes }
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

  // ----------------------------------------------------------------
  // v3: source records
  // ----------------------------------------------------------------

  upsertSource(source: SourceRecord): SourceRecord {
    if (!source.id) source.id = 'src_' + this.newId().slice(4)
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO source_record (id, user_id, source_type, external_ref, title, content, attrs,
                                   created_at, ingested_at, deleted)
        VALUES (@id,@user_id,@source_type,@external_ref,@title,@content,@attrs,@created_at,@ingested_at,@deleted)
        ON CONFLICT(id) DO UPDATE SET
            user_id=excluded.user_id, source_type=excluded.source_type,
            external_ref=excluded.external_ref, title=excluded.title, content=excluded.content,
            attrs=excluded.attrs, ingested_at=excluded.ingested_at, deleted=excluded.deleted
      `
      )
      .run({
        id: source.id,
        user_id: source.userId,
        source_type: source.sourceType,
        external_ref: source.externalRef,
        title: source.title,
        content: source.content,
        attrs: JSON.stringify(source.attrs),
        created_at: source.createdAt,
        ingested_at: source.ingestedAt,
        deleted: source.deleted ? 1 : 0
      })
    this.logEvent('source_upsert', {
      recordId: source.id,
      userId: source.userId,
      payload: { source_type: source.sourceType, external_ref: source.externalRef, deleted: source.deleted }
    })
    return source
  }

  getSource(id: string): SourceRecord | null {
    const row = this.db
      .prepare(/* sql */ `SELECT * FROM source_record WHERE id=?`)
      .get(id) as SourceRow | undefined
    return row ? this.rowToSource(row) : null
  }

  listSources(userId: string, opts: { sourceType?: string; includeDeleted?: boolean } = {}): SourceRecord[] {
    const where: string[] = ['user_id=?']
    const params: unknown[] = [userId]
    if (opts.sourceType) {
      where.push('source_type=?')
      params.push(opts.sourceType)
    }
    if (!opts.includeDeleted) {
      where.push('deleted=0')
    }
    const rows = this.db
      .prepare(
        /* sql */ `SELECT * FROM source_record WHERE ${where.join(' AND ')} ORDER BY ingested_at DESC`
      )
      .all(...params) as SourceRow[]
    return rows.map((r) => this.rowToSource(r))
  }

  findSourceByExternalRef(userId: string, sourceType: string, externalRef: string): SourceRecord | null {
    const row = this.db
      .prepare(
        /* sql */ `SELECT * FROM source_record WHERE user_id=? AND source_type=? AND external_ref=? LIMIT 1`
      )
      .get(userId, sourceType, externalRef) as SourceRow | undefined
    return row ? this.rowToSource(row) : null
  }

  deleteSource(id: string, opts: { hard?: boolean } = {}): boolean {
    if (opts.hard) {
      const cur = this.db.prepare(/* sql */ `DELETE FROM source_record WHERE id=?`).run(id)
      this.logEvent('source_hard_delete', { recordId: id })
      return cur.changes > 0
    }
    const cur = this.db
      .prepare(/* sql */ `UPDATE source_record SET deleted=1 WHERE id=? AND deleted=0`)
      .run(id)
    if (cur.changes > 0) {
      this.logEvent('source_soft_delete', { recordId: id })
    }
    return cur.changes > 0
  }

  memoriesDerivedFromSource(userId: string, sourceId: string): MemoryItem[] {
    // v3(报告 §7.3):优先用规范化的 memory_source_link JOIN 表(更快、无 LIKE 注入风险);
    // 若 link 表为空(老数据迁移前),回退到 source_ids JSON LIKE。
    try {
      const linkRows = this.db
        .prepare(
          /* sql */ `SELECT m.* FROM memory m
                     JOIN memory_source_link l ON l.memory_id = m.id
                     WHERE l.user_id=? AND l.source_id=?
                     ORDER BY m.updated_at DESC`
        )
        .all(userId, sourceId) as MemoryRow[]
      if (linkRows.length > 0) {
        return linkRows.map((r) => this.rowToItem(r))
      }
    } catch {
      // link 表可能不存在(极老 DB)→ 回退 JSON LIKE
    }
    const rows = this.db
      .prepare(
        /* sql */ `SELECT * FROM memory WHERE user_id=? AND source_ids LIKE ? ORDER BY updated_at DESC`
      )
      .all(userId, `%"${sourceId.replace(/"/g, '\\"')}"%`) as MemoryRow[]
    return rows.map((r) => this.rowToItem(r))
  }

  /**
   * v3(报告 §7.3):同步 memory_source_link 规范化表。
   * 删除该 memory 的旧 link 行,按 sourceIds 重新插入(幂等)。
   */
  private syncSourceLinks(item: MemoryItem): void {
    try {
      const del = this.db.prepare(/* sql */ `DELETE FROM memory_source_link WHERE memory_id=?`)
      const ins = this.db.prepare(
        /* sql */ `INSERT OR IGNORE INTO memory_source_link(memory_id, source_id, user_id, created_at) VALUES (?,?,?,?)`
      )
      del.run(item.id)
      for (const sid of item.sourceIds) {
        ins.run(item.id, sid, item.userId, item.createdAt)
      }
    } catch {
      // link 表可能不存在(极老 DB,SCHEMA 未跑)→ 静默跳过(JSON 列仍可用)
    }
  }

  // ----------------------------------------------------------------
  // v3: suppression rules
  // ----------------------------------------------------------------

  upsertSuppression(rule: SuppressionRule): SuppressionRule {
    if (!rule.id) rule.id = 'sup_' + this.newId().slice(4)
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO suppression_rule (id, user_id, scope, target, reason, created_at, active)
        VALUES (@id,@user_id,@scope,@target,@reason,@created_at,@active)
        ON CONFLICT(id) DO UPDATE SET
            reason=excluded.reason, active=excluded.active
        ON CONFLICT(user_id, scope, target) DO UPDATE SET
            reason=excluded.reason, active=excluded.active
      `
      )
      .run({
        id: rule.id,
        user_id: rule.userId,
        scope: rule.scope,
        target: rule.target,
        reason: rule.reason,
        created_at: rule.createdAt,
        active: rule.active ? 1 : 0
      })
    this.logEvent('suppression_upsert', {
      recordId: rule.id,
      userId: rule.userId,
      payload: { scope: rule.scope, target: rule.target, active: rule.active }
    })
    return rule
  }

  getSuppression(id: string): SuppressionRule | null {
    const row = this.db
      .prepare(/* sql */ `SELECT * FROM suppression_rule WHERE id=?`)
      .get(id) as SuppressionRow | undefined
    return row ? this.rowToSuppression(row) : null
  }

  listSuppressions(userId: string, opts: { includeInactive?: boolean } = {}): SuppressionRule[] {
    const where: string[] = ['user_id=?']
    const params: unknown[] = [userId]
    if (!opts.includeInactive) {
      where.push('active=1')
    }
    const rows = this.db
      .prepare(
        /* sql */ `SELECT * FROM suppression_rule WHERE ${where.join(' AND ')} ORDER BY created_at DESC`
      )
      .all(...params) as SuppressionRow[]
    return rows.map((r) => this.rowToSuppression(r))
  }

  findSuppression(userId: string, scope: string, target: string): SuppressionRule | null {
    const row = this.db
      .prepare(
        /* sql */ `SELECT * FROM suppression_rule WHERE user_id=? AND scope=? AND target=? LIMIT 1`
      )
      .get(userId, scope, target) as SuppressionRow | undefined
    return row ? this.rowToSuppression(row) : null
  }

  deleteSuppression(id: string): boolean {
    const cur = this.db.prepare(/* sql */ `DELETE FROM suppression_rule WHERE id=?`).run(id)
    if (cur.changes > 0) this.logEvent('suppression_delete', { recordId: id })
    return cur.changes > 0
  }

  // ----------------------------------------------------------------
  // event log
  // ----------------------------------------------------------------

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

  /** v3:补齐所有 v3 列(对老库 ALTER TABLE)。 */
  private addV3ColumnsIfMissing(): void {
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
    const additions: ReadonlyArray<readonly [string, string]> = [
      ['normalized_facts', "TEXT NOT NULL DEFAULT '[]'"],
      ['source_ids', "TEXT NOT NULL DEFAULT '[]'"],
      ['temporal_state', "TEXT NOT NULL DEFAULT 'current'"],
      ['valid_from', 'TEXT'],
      ['valid_until', 'TEXT'],
      ['supersedes', "TEXT NOT NULL DEFAULT '[]'"],
      ['superseded_by', "TEXT NOT NULL DEFAULT '[]'"],
      ['is_top_of_mind', 'INTEGER NOT NULL DEFAULT 0'],
      ['is_suppressed', 'INTEGER NOT NULL DEFAULT 0'],
      ['user_corrected', 'INTEGER NOT NULL DEFAULT 0'],
      ['salience', 'REAL NOT NULL DEFAULT 0.5'],
      ['topic', 'TEXT'],
      ['last_used_at', 'TEXT'],
      ['sensitivity', "TEXT NOT NULL DEFAULT 'normal'"],
      ['shareable', 'INTEGER NOT NULL DEFAULT 1']
    ]
    for (const [col, def] of additions) {
      if (!cols.has(col)) {
        this.db.exec(/* sql */ `ALTER TABLE memory ADD COLUMN ${col} ${def}`)
      }
    }
    // 索引
    try {
      this.db.exec(/* sql */ `CREATE INDEX IF NOT EXISTS ix_memory_topic ON memory(topic)`)
      this.db.exec(
        /* sql */ `CREATE INDEX IF NOT EXISTS ix_memory_top_of_mind ON memory(is_top_of_mind)`
      )
    } catch {
      /* index creation non-fatal */
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
      schema_version: item.schemaVersion,
      normalized_facts: JSON.stringify(item.normalizedFacts),
      source_ids: JSON.stringify(item.sourceIds),
      temporal_state: item.temporalState,
      valid_from: item.validFrom,
      valid_until: item.validUntil,
      supersedes: JSON.stringify(item.supersedes),
      superseded_by: JSON.stringify(item.supersededBy),
      is_top_of_mind: item.isTopOfMind ? 1 : 0,
      is_suppressed: item.isSuppressed ? 1 : 0,
      user_corrected: item.userCorrected ? 1 : 0,
      salience: item.salience,
      topic: item.topic,
      last_used_at: item.lastUsedAt,
      sensitivity: item.sensitivity,
      shareable: item.shareable ? 1 : 0
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
      schema_version: row.schema_version,
      normalized_facts: parseJsonArray(row.normalized_facts),
      source_ids: parseJsonArray(row.source_ids),
      temporal_state: row.temporal_state,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      supersedes: parseJsonArray(row.supersedes),
      superseded_by: parseJsonArray(row.superseded_by),
      is_top_of_mind: boolFromInt(row.is_top_of_mind),
      is_suppressed: boolFromInt(row.is_suppressed),
      user_corrected: boolFromInt(row.user_corrected),
      salience: row.salience,
      topic: row.topic,
      last_used_at: row.last_used_at,
      sensitivity: row.sensitivity,
      shareable: boolFromInt(row.shareable)
    }
    return MemoryItem.fromDict(dict)
  }

  private rowToSource(row: SourceRow): SourceRecord {
    return SourceRecord.fromDict({
      id: row.id,
      user_id: row.user_id,
      source_type: row.source_type,
      external_ref: row.external_ref,
      title: row.title,
      content: row.content,
      attrs: parseJsonObject(row.attrs),
      created_at: row.created_at,
      ingested_at: row.ingested_at,
      deleted: boolFromInt(row.deleted)
    })
  }

  private rowToSuppression(row: SuppressionRow): SuppressionRule {
    return SuppressionRule.fromDict({
      id: row.id,
      user_id: row.user_id,
      scope: row.scope,
      target: row.target,
      reason: row.reason,
      created_at: row.created_at,
      active: boolFromInt(row.active)
    })
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

function boolFromInt(n: number | null | undefined): boolean {
  return n === 1
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

function defaultNewId(): string {
  return newMemoryId()
}
