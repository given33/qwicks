/**
 * Batch A (spec §1): FileMemoryStore -> Dream SQLite migration.
 *
 * Reads legacy JSON-per-record files, maps each to a Dream MemoryItem via the
 * same field mapping DreamMemoryStore uses, and upserts into the repository.
 * Idempotent (fingerprint dedup — already-migrated rows are skipped),
 * non-destructive (old JSON is never deleted).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryScope,
  MemoryType,
  MemoryProvenance,
  nowIso
} from '../types.js'
import { MemoryRecord } from '../../contracts/memory.js'
import type { SqliteMemoryRepository } from './sqlite-repository.js'

export interface MigrationReport {
  migratedCount: number
  skippedCount: number
  failedCount: number
  errors: string[]
}

export interface MigrateLegacyMemoryOptions {
  /** Directory holding the legacy `*.json` records (FileMemoryStore rootDir). */
  fileDir: string
  repository: SqliteMemoryRepository
  /** Dream user id the migrated records are attached to. */
  userId: string
  /** Test seam. */
  nowIso?: () => string
}

/**
 * Map a qwicks scope to a Dream scope. Mirrors DreamMemoryStore.scopeToDream,
 * duplicated here to avoid a circular import (dream-store imports repository).
 */
function scopeToDream(scope: 'user' | 'workspace' | 'project'): MemoryScope {
  if (scope === 'user') return MemoryScope.USER
  if (scope === 'project') return MemoryScope.PROJECT
  return MemoryScope.GLOBAL
}

/** Infer a MemoryType from content/tags (mirrors DreamMemoryStore.inferType). */
function inferType(content: string, tags: string[] = []): MemoryType {
  const text = `${content} ${tags.join(' ')}`.toLowerCase()
  if (/(偏好|喜欢|不要|prefer|like|dislike|avoid|vegetarian|vegan)/.test(text)) return MemoryType.PREFERENCE
  if (/(目标|计划|打算|goal|plan|aim|intend|going to)/.test(text)) return MemoryType.GOAL
  if (/(约束|必须|不能|constraint|must|cannot|limit)/.test(text)) return MemoryType.CONSTRAINT
  if (/(项目|工程|project|repo|repository)/.test(text)) return MemoryType.PROJECT
  if (/(技能|会|能|skill|can|able to)/.test(text)) return MemoryType.SKILL
  return MemoryType.FACT
}

function recordToItem(record: MemoryRecord, userId: string, now: string): MemoryItem {
  const item = new MemoryItem(
    record.id,
    userId,
    inferType(record.content, record.tags),
    record.content,
    scopeToDream(record.scope),
    [...record.tags],
    0.5,
    record.confidence,
    record.createdAt,
    record.updatedAt,
    null,
    new MemoryProvenance('file'),
    null,
    null,
    [],
    {},
    MemoryLifecycleStatus.ACTIVE,
    [],
    2
  )
  if (record.sourceThreadId) item.provenance.threadId = record.sourceThreadId
  if (record.sourceTurnId) item.provenance.turnId = record.sourceTurnId
  // Disabled -> SUPPRESSED (does not inject); Deleted -> DELETED.
  if (record.disabledAt) {
    item.transitionStatus(MemoryLifecycleStatus.SUPPRESSED, { actor: 'migration', reason: 'legacy disabled' })
    item.metadata.dont_mention_at = record.disabledAt
  }
  if (record.deletedAt) {
    item.transitionStatus(MemoryLifecycleStatus.DELETED, { actor: 'migration', reason: 'legacy deleted' })
    item.metadata.__deleted_at__ = record.deletedAt
  }
  return item
}

export async function migrateLegacyMemory(opts: MigrateLegacyMemoryOptions): Promise<MigrationReport> {
  const { fileDir, repository, userId } = opts
  const report: MigrationReport = { migratedCount: 0, skippedCount: 0, failedCount: 0, errors: [] }

  let entries: string[]
  try {
    entries = await readdir(fileDir)
  } catch {
    // Directory does not exist yet — nothing to migrate. Not an error.
    return report
  }

  // Pre-load existing fingerprints so we can skip without a per-row query.
  const existing = new Set(repository.list(userId).map((i) => i.fingerprint()))

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const text = await readFile(join(fileDir, entry), 'utf8')
      const record = MemoryRecord.parse(JSON.parse(text))
      const item = recordToItem(record, userId, new Date().toISOString())
      if (existing.has(item.fingerprint())) {
        report.skippedCount += 1
        continue
      }
      repository.upsert(item)
      existing.add(item.fingerprint())
      report.migratedCount += 1
    } catch (err) {
      report.failedCount += 1
      report.errors.push(`${entry}: ${String(err)}`)
    }
  }
  return report
}
