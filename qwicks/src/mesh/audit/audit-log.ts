import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

/**
 * Append-only audit log for every cross-device action (RFC 006 §8).
 *
 * Stored in a standalone sqlite database (`mesh-audit.db`), isolated from the
 * rest of QWicks' data. The store exposes ONLY append (`record`) and read
 * (`list`) — no update or delete surface, so a compromised peer cannot rewrite
 * history. Records are local-only; no peer ever receives read/write access.
 */

export interface AuditEvent {
  kind: string
  from: string
  to: string
  outcome: 'success' | 'failure' | 'denied' | 'timeout'
  traceId: string
  taskId?: string
  timestamp: string
  detail?: Record<string, unknown>
}

export interface AuditRecord extends AuditEvent {
  auditId: string
}

interface Row {
  auditId: string
  traceId: string
  taskId: string | null
  fromDevice: string
  toDevice: string
  kind: string
  outcome: string
  detail: string
  timestamp: string
}

export class AuditLog {
  private readonly db: Database.Database
  private readonly insertStmt: Database.Statement
  private readonly listStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        auditId    TEXT PRIMARY KEY,
        traceId    TEXT NOT NULL,
        taskId     TEXT,
        fromDevice TEXT NOT NULL,
        toDevice   TEXT NOT NULL,
        kind       TEXT NOT NULL,
        outcome    TEXT NOT NULL,
        detail     TEXT NOT NULL,
        timestamp  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_events(traceId);
      CREATE INDEX IF NOT EXISTS idx_audit_task  ON audit_events(taskId);
    `)
    this.insertStmt = this.db.prepare(
      'INSERT INTO audit_events (auditId, traceId, taskId, fromDevice, toDevice, kind, outcome, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    this.listStmt = this.db.prepare('SELECT * FROM audit_events ORDER BY rowid ASC')
  }

  async record(event: AuditEvent): Promise<void> {
    this.insertStmt.run(
      randomUUID(),
      event.traceId,
      event.taskId ?? null,
      event.from,
      event.to,
      event.kind,
      event.outcome,
      JSON.stringify(event.detail ?? {}),
      event.timestamp
    )
  }

  async list(filter: { traceId?: string; taskId?: string }): Promise<AuditRecord[]> {
    const rows = this.listStmt.all() as Row[]
    return rows
      .filter((r) => (filter.traceId ? r.traceId === filter.traceId : true))
      .filter((r) => (filter.taskId ? r.taskId === filter.taskId : true))
      .map(toRecord)
  }

  close(): void {
    this.db.close()
  }
}

function toRecord(r: Row): AuditRecord {
  return {
    auditId: r.auditId,
    kind: r.kind,
    from: r.fromDevice,
    to: r.toDevice,
    outcome: r.outcome as AuditEvent['outcome'],
    traceId: r.traceId,
    ...(r.taskId ? { taskId: r.taskId } : {}),
    timestamp: r.timestamp,
    detail: safeParse(r.detail)
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}
