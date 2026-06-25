/**
 * Batch B (spec §2.5): PendingSensitiveStore — physical isolation for
 * high-sensitivity drafts awaiting user confirmation.
 *
 * Defining property: a pending draft is unreachable by ANY memory mechanism
 * (retrieval/decay/conflict/export/share) before confirmation, because it lives
 * in a separate table and is never a MemoryItem. repo.list() cannot scan it.
 *
 * Sticky dismiss: writes a tombstone via the existing suppression_rule table
 * (scope = 'sensitive_fingerprint', target = fingerprint) so the same content is
 * never re-pended.
 */
import { randomUUID } from 'node:crypto'
import { MemoryItemDraft } from '../types.js'
import type { SqliteMemoryRepository } from './sqlite-repository.js'

const SENSITIVE_FP_SCOPE = 'sensitive_fingerprint'
const LIST_LIMIT = 1000

export interface PendingDraftRow {
  id: string
  userId: string
  draft: MemoryItemDraft
  category: string
  fingerprint: string
  createdAt: string
}

export interface EnqueueInput {
  userId: string
  draft: MemoryItemDraft
  category: string
  fingerprint: string
}

export class PendingSensitiveStore {
  constructor(private readonly repo: SqliteMemoryRepository) {}

  /**
   * Enqueue a pending draft. No-op (returns existing/empty id) if the fingerprint
   * already exists as a confirmed memory or as an active dismiss tombstone.
   * UNIQUE(user_id, fingerprint) makes re-enqueue of an already-pending row a no-op.
   */
  enqueue(input: EnqueueInput): string {
    if (this.repo.hasFingerprint(input.userId, input.fingerprint)) return ''
    if (this.isDismissed(input.userId, input.fingerprint)) return ''
    const id = `psd_${randomUUID().slice(0, 12)}`
    this.repo.rawExec(
      /* sql */ `INSERT OR IGNORE INTO pending_sensitive_draft (id, user_id, draft_json, category, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.userId, JSON.stringify(input.draft), input.category, input.fingerprint, new Date().toISOString()]
    )
    const row = this.repo.rawQueryOne<{ id: string }>(
      /* sql */ `SELECT id FROM pending_sensitive_draft WHERE user_id=? AND fingerprint=? LIMIT 1`,
      input.userId,
      input.fingerprint
    )
    return row?.id ?? id
  }

  list(userId: string): PendingDraftRow[] {
    return this.repo
      .rawQuery<{ id: string; user_id: string; draft_json: string; category: string; fingerprint: string; created_at: string }>(
        /* sql */ `SELECT * FROM pending_sensitive_draft WHERE user_id=? ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`,
        userId
      )
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        draft: MemoryItemDraft.fromDict(JSON.parse(r.draft_json)),
        category: r.category,
        fingerprint: r.fingerprint,
        createdAt: r.created_at
      }))
  }

  get(id: string): PendingDraftRow | null {
    const r = this.repo.rawQueryOne<{
      id: string
      user_id: string
      draft_json: string
      category: string
      fingerprint: string
      created_at: string
    }>(/* sql */ `SELECT * FROM pending_sensitive_draft WHERE id=?`, id)
    if (!r) return null
    return {
      id: r.id,
      userId: r.user_id,
      draft: MemoryItemDraft.fromDict(JSON.parse(r.draft_json)),
      category: r.category,
      fingerprint: r.fingerprint,
      createdAt: r.created_at
    }
  }

  delete(id: string): void {
    this.repo.rawExec(/* sql */ `DELETE FROM pending_sensitive_draft WHERE id=?`, [id])
  }

  /** Write a sticky dismiss tombstone (permanent: same content never re-pends). */
  recordDismissTombstone(userId: string, fingerprint: string): void {
    const id = `sup_${randomUUID().slice(0, 12)}`
    this.repo.rawExec(
      /* sql */ `INSERT OR IGNORE INTO suppression_rule (id, user_id, scope, target, reason, created_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, userId, SENSITIVE_FP_SCOPE, fingerprint, 'dismissed sensitive draft', new Date().toISOString()]
    )
  }

  /** Dismiss a pending draft: write tombstone + delete the row. */
  dismiss(userId: string, id: string, fingerprint: string): void {
    this.recordDismissTombstone(userId, fingerprint)
    this.delete(id)
  }

  isDismissed(userId: string, fingerprint: string): boolean {
    const r = this.repo.rawQueryOne<{ cnt: number }>(
      /* sql */ `SELECT COUNT(*) AS cnt FROM suppression_rule WHERE user_id=? AND scope=? AND target=? AND active=1`,
      userId,
      SENSITIVE_FP_SCOPE,
      fingerprint
    )
    return (r?.cnt ?? 0) > 0
  }

  /** Aging cleanup (dreaming job): remove rows older than maxAgeDays. Returns count. */
  purgeStale(maxAgeDays: number): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString()
    const stale = this.repo.rawQueryOne<{ cnt: number }>(
      /* sql */ `SELECT COUNT(*) AS cnt FROM pending_sensitive_draft WHERE created_at < ?`,
      cutoff
    )
    const count = stale?.cnt ?? 0
    if (count > 0) {
      this.repo.rawExec(/* sql */ `DELETE FROM pending_sensitive_draft WHERE created_at < ?`, [cutoff])
    }
    return count
  }
}
