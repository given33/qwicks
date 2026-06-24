# Dream Memory Batch A — Main Path Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GUI「记忆引擎 / Memory engine」switch (File → Dream) and a non-destructive, idempotent File→Dream migration so the 90% of Dream code that currently sleeps actually runs, without losing any existing memories.

**Architecture:** A new `memoryBackend` field threads through `QWicksRuntimeSettingsV1` → `syncGuiManagedQWicksConfig` → `capabilities.memory.backend` (the existing `runtime-factory` already branches on `backend==='dream'`). When the user switches to Dream, a pure `migrateLegacyMemory()` reads the old `FileMemoryStore` JSON records, maps each to a `MemoryItem` via the existing `draftToItem`, and upserts into SQLite — deduped by `fingerprint()`, recorded in a `migration_log` table so it only runs once. On any failure the runtime falls back to `FileMemoryStore` and surfaces a red banner; old JSON is never deleted.

**Tech Stack:** TypeScript, zod (settings schema), React + lucide-react (GUI), better-sqlite3 (migration_log table), vitest (TDD), existing `FileMemoryStore` / `SqliteMemoryRepository` / `MemoryItem`.

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §1 (Batch A). Read it before starting.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/shared/app-settings-types.ts` | Modify | Add `memoryBackend` to `QWicksRuntimeSettingsV1` + the storage-backend union |
| `src/shared/app-settings-qwicks.ts` | Modify | Default `memoryBackend: 'file'`; migrate old settings; add to patch merge |
| `src/shared/app-settings-provider.ts` | Modify (if needed) | Ensure `memoryBackend` flows through patch resolution |
| `qwicks/src/dream/storage/migrate-legacy-memory.ts` | Create | Pure `migrateLegacyMemory()` + `MigrationReport` |
| `qwicks/src/dream/storage/migrate-legacy-memory.test.ts` | Create | TDD tests for migration |
| `qwicks/src/dream/storage/sqlite-repository.ts` | Modify | `migration_log` table + `lastMigration()`/`recordMigration()` |
| `qwicks/src/server/runtime-factory.ts` | Modify | Call migration in the dream branch; fall back to FileMemoryStore on failure |
| `src/main/qwicks-process.ts` | Modify | Wire `backend: runtime.memoryBackend` into the memory capability config |
| `src/main/qwicks-process.test.ts` | Modify (if exists) | Assert memory backend in written config |
| `src/renderer/src/components/settings-section-memory.tsx` | Modify | Add Memory engine switch + confirm dialog |
| `src/renderer/src/locales/en/settings.json` | Modify | English strings |
| `src/renderer/src/locales/zh/settings.json` | Modify | Chinese strings |

---

## Task 1: Add `memoryBackend` to the runtime settings type

**Files:**
- Modify: `src/shared/app-settings-types.ts` (around line 359, `QWicksStorageSettingsV1`)
- Modify: `src/shared/app-settings-types.ts` (around line 229-230, `QWicksRuntimeSettingsV1`)

The Dream backend is a *memory* concern, but it shares the same "GUI pick → written into QWicks config" lifecycle as `storage.backend`. Mirror that exact pattern as a top-level field on `QWicksRuntimeSettingsV1`.

- [ ] **Step 1: Add the type alias and field**

In `src/shared/app-settings-types.ts`, find the `QWicksStorageSettingsV1` block (line ~359) and add a new union type right above it:

```ts
/** Which long-term memory backend the QWicks runtime uses. `file` = legacy JSON-per-record FileMemoryStore; `dream` = Dream memory system (SQLite + lifecycle + embeddings). */
export type QWicksMemoryBackend = 'file' | 'dream'
```

Then in the `QWicksRuntimeSettingsV1` type (line ~186), add a field right after `memoryEnabled: boolean` (line 230):

```ts
  /** Whether long-term memory is enabled in the QWicks runtime. */
  memoryEnabled: boolean
  /** Long-term memory backend. `file` (default) keeps the legacy JSON store; `dream` switches to the Dream memory system. */
  memoryBackend: QWicksMemoryBackend
```

- [ ] **Step 2: Verify it compiles**

Run: `cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: Errors only about `memoryBackend` missing from `defaultQWicksRuntimeSettings` and the patch merge (these are fixed in Task 2). No other new errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/app-settings-types.ts
git commit -m "feat(settings): add memoryBackend field to QWicksRuntimeSettingsV1"
```

---

## Task 2: Default `memoryBackend: 'file'` + migrate old settings

**Files:**
- Modify: `src/shared/app-settings-qwicks.ts` (line ~115 `defaultQWicksRuntimeSettings`, line ~269 default, and patch merges)

- [ ] **Step 1: Add the default and field to `defaultQWicksRuntimeSettings`**

In `src/shared/app-settings-qwicks.ts`, in `defaultQWicksRuntimeSettings` (line ~115), add `memoryBackend` right after `memoryEnabled: false,` (line ~144):

```ts
    memoryEnabled: false,
    memoryBackend: 'file',
```

- [ ] **Step 2: Backfill `memoryBackend` when reading old saved settings**

First, find every merge site. Run:

```bash
cd D:\teamflow-desktop-v2 && grep -n "memoryEnabled" src/shared/app-settings-qwicks.ts
```

The field flows exactly the same way as `memoryEnabled` (it is a peer field on the same type). Two cases:
- **If `memoryEnabled` survives into the resolved settings via object spread** (i.e. no special-casing): then `memoryBackend` does too — do nothing extra here, and verify with the test in Step 3 (an old object without `memoryBackend` must still produce `memoryBackend: 'file'` after resolution because the default supplies it).
- **If `memoryEnabled` is explicitly copied field-by-field** in any merge/resolve function: add `memoryBackend: resolveMemoryBackend(existing)` at the same spot.

Add this helper near `defaultQWicksRuntimeSettings` regardless, so the explicit case has something to call and the test in Step 3 has a target:

```ts
/** Resolve a possibly-absent memoryBackend from saved settings (old installs predate the field). */
export function resolveMemoryBackend(raw: { memoryBackend?: unknown } | undefined): QWicksMemoryBackend {
  return raw?.memoryBackend === 'dream' ? 'dream' : 'file'
}
```

Import `QWicksMemoryBackend` from `./app-settings-types.js` (already imported if the type lives there; check the existing imports at the top of the file).

- [ ] **Step 3: Write a failing test that an old settings object without `memoryBackend` resolves to `'file'`**

Create or extend the existing app-settings test. First find the test file:

```bash
cd D:\teamflow-desktop-v2 && git ls-files "*app-settings*test*" "*app-settings*.test.*"
```

In the matching test file (create `src/shared/app-settings-qwicks.test.ts` if none targets `resolveMemoryBackend`):

```ts
import { describe, expect, it } from 'vitest'
import { resolveMemoryBackend } from './app-settings-qwicks'

describe('resolveMemoryBackend', () => {
  it('defaults to file when absent (old install)', () => {
    expect(resolveMemoryBackend(undefined)).toBe('file')
    expect(resolveMemoryBackend({})).toBe('file')
  })
  it('returns dream when explicitly set', () => {
    expect(resolveMemoryBackend({ memoryBackend: 'dream' })).toBe('dream')
  })
  it('coerces garbage back to file', () => {
    expect(resolveMemoryBackend({ memoryBackend: 'weird' })).toBe('file')
  })
})
```

- [ ] **Step 4: Run the test**

Run: `cd D:\teamflow-desktop-v2 && npx vitest run src/shared/app-settings-qwicks.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole repo**

Run: `cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/app-settings-qwicks.ts src/shared/app-settings-qwicks.test.ts
git commit -m "feat(settings): default memoryBackend=file + resolve absent field from old installs"
```

---

## Task 3: Add the `migration_log` table to the SQLite repository

**Files:**
- Modify: `qwicks/src/dream/storage/sqlite-repository.ts` (SCHEMA around line 31; add methods near the other public methods)
- Test: `qwicks/src/dream/storage/migrate-legacy-memory.test.ts` (uses these methods — created in Task 5)

The migration must only run once per database. We record each run in a `migration_log` table and check it before re-running.

- [ ] **Step 1: Add the table to SCHEMA**

In `qwicks/src/dream/storage/sqlite-repository.ts`, find the `SCHEMA` template string (line ~31). Add this table at the end of the SCHEMA string (after the existing tables, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS migration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    migrated_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    failed_count INTEGER NOT NULL,
    error TEXT,
    ran_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_migration_kind ON migration_log(kind);
```

- [ ] **Step 2: Add `lastMigration(kind)` and `recordMigration(...)` methods**

In the `SqliteMemoryRepository` class (line ~244), add these public methods near the other public methods (e.g. after `backfillSourceLinks()` around line ~601):

```ts
  /** Read the most recent successful migration of a given kind, or null if none. */
  lastMigration(kind: string): { kind: string; migratedCount: number; skippedCount: number; failedCount: number; ranAt: string } | null {
    const row = this.db
      .prepare(/* sql */ `SELECT kind, migrated_count, skipped_count, failed_count, ran_at FROM migration_log WHERE kind = ? ORDER BY id DESC LIMIT 1`)
      .get(kind) as { kind: string; migrated_count: number; skipped_count: number; failed_count: number; ran_at: string } | undefined
    if (!row) return null
    return {
      kind: row.kind,
      migratedCount: row.migrated_count,
      skippedCount: row.skipped_count,
      failedCount: row.failed_count,
      ranAt: row.ran_at
    }
  }

  /** Record a migration run (successful or failed). */
  recordMigration(entry: { kind: string; migratedCount: number; skippedCount: number; failedCount: number; error?: string }): void {
    this.db
      .prepare(/* sql */ `INSERT INTO migration_log (kind, migrated_count, skipped_count, failed_count, error, ran_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(entry.kind, entry.migratedCount, entry.skippedCount, entry.failedCount, entry.error ?? null, this.now())
  }
```

- [ ] **Step 3: Verify the existing dream tests still pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/`
Expected: All existing storage tests PASS (the new table is additive).

- [ ] **Step 4: Commit**

```bash
git add qwicks/src/dream/storage/sqlite-repository.ts
git commit -m "feat(dream): add migration_log table + lastMigration/recordMigration"
```

---

## Task 4: Implement `migrateLegacyMemory()` (TDD — tests first)

**Files:**
- Create: `qwicks/src/dream/storage/migrate-legacy-memory.test.ts`
- Create: `qwicks/src/dream/storage/migrate-legacy-memory.ts`

This is the core of Batch A. Write the tests first, then implement. The function reads `FileMemoryStore` JSON records and upserts them into the Dream SQLite repository.

- [ ] **Step 1: Write the failing tests**

Create `qwicks/src/dream/storage/migrate-legacy-memory.test.ts`:

```ts
/**
 * Batch A (spec §1): migrateLegacyMemory — read FileMemoryStore JSON -> Dream SQLite.
 * Idempotent (fingerprint dedup), non-destructive (old JSON untouched), skip-bad-rows.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRecord } from '../../contracts/memory.js'
import { MemoryItem, MemoryType, MemoryScope, MemoryLifecycleStatus } from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'
import { migrateLegacyMemory } from './migrate-legacy-memory.js'

function makeRecord(overrides: Partial<Record<string, unknown>> = {}): MemoryRecord {
  return MemoryRecord.parse({
    id: 'mem_1',
    content: 'user prefers concise answers',
    scope: 'workspace',
    tags: ['concise'],
    confidence: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })
}

async function seedFileStore(dir: string, records: MemoryRecord[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  for (const r of records) {
    await writeFile(join(dir, `${r.id}.json`), JSON.stringify(r), 'utf8')
  }
}

describe('migrateLegacyMemory', () => {
  let fileDir: string
  let sqlitePath: string
  let repo: SqliteMemoryRepository

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'dream-migrate-'))
    fileDir = join(root, 'memory')
    sqlitePath = join(root, 'dream.db')
    repo = new SqliteMemoryRepository({ sqlitePath })
  })
  afterEach(async () => {
    repo.close()
    await rm(join(sqlitePath, '..'), { recursive: true, force: true })
  })

  it('migrates N records into SQLite with matching content', async () => {
    const records = [
      makeRecord({ id: 'mem_1', content: 'prefers concise answers', scope: 'user' }),
      makeRecord({ id: 'mem_2', content: 'works on project X', scope: 'workspace', tags: ['project'] }),
      makeRecord({ id: 'mem_3', content: 'deadline Friday', scope: 'project', workspace: '/repo', project: '/repo' })
    ]
    await seedFileStore(fileDir, records)

    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report.migratedCount).toBe(3)
    expect(report.failedCount).toBe(0)
    const items = repo.list('default')
    expect(items).toHaveLength(3)
    expect(items.some((i) => i.content === 'prefers concise answers')).toBe(true)
  })

  it('is idempotent — running twice does not duplicate', async () => {
    await seedFileStore(fileDir, [makeRecord({ id: 'mem_1' }), makeRecord({ id: 'mem_2' })])

    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const report2 = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report2.migratedCount).toBe(0)
    expect(report2.skippedCount).toBe(2)
    expect(repo.list('default')).toHaveLength(2)
  })

  it('skips corrupted JSON rows and reports failedCount', async () => {
    await mkdir(fileDir, { recursive: true })
    await writeFile(join(fileDir, 'mem_good.json'), JSON.stringify(makeRecord({ id: 'mem_good' })), 'utf8')
    await writeFile(join(fileDir, 'mem_bad.json'), '{not valid json', 'utf8')

    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report.migratedCount).toBe(1)
    expect(report.failedCount).toBe(1)
    expect(repo.list('default')).toHaveLength(1)
  })

  it('handles empty directory — migratedCount 0, no throw', async () => {
    await mkdir(fileDir, { recursive: true })
    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    expect(report.migratedCount).toBe(0)
    expect(report.failedCount).toBe(0)
  })

  it('maps qwicks scope -> dream scope (user->user, workspace->global, project->project)', async () => {
    await seedFileStore(fileDir, [
      makeRecord({ id: 'u1', scope: 'user', content: 'name is Alice' }),
      makeRecord({ id: 'w1', scope: 'workspace', content: 'uses dark theme' }),
      makeRecord({ id: 'p1', scope: 'project', content: 'builds app', workspace: '/repo', project: '/repo' })
    ])
    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const byId = new Map(repo.list('default').map((i) => [i.id, i]))
    expect(byId.get('u1')?.scope).toBe(MemoryScope.USER)
    expect(byId.get('w1')?.scope).toBe(MemoryScope.GLOBAL)
    expect(byId.get('p1')?.scope).toBe(MemoryScope.PROJECT)
  })

  it('preserves disabled/deleted state as lifecycle status', async () => {
    await seedFileStore(fileDir, [
      makeRecord({ id: 'd1', disabledAt: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ id: 'x1', deletedAt: '2026-02-01T00:00:00.000Z' })
    ])
    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const byId = new Map(repo.list('default', { includeSuppressed: true, onlyStatus: [MemoryLifecycleStatus.SUPPRESSED, MemoryLifecycleStatus.DELETED] }).map((i) => [i.id, i]))
    expect(byId.get('d1')?.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
    expect(byId.get('x1')?.status).toBe(MemoryLifecycleStatus.DELETED)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/migrate-legacy-memory.test.ts`
Expected: FAIL — `migrate-legacy-memory.js` module not found / `migrateLegacyMemory` not a function.

- [ ] **Step 3: Implement `migrate-legacy-memory.ts`**

Create `qwicks/src/dream/storage/migrate-legacy-memory.ts`:

```ts
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
  newMemoryId,
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
    undefined,
    null,
    new MemoryProvenance('file'),
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
  const now = opts.nowIso ?? nowIso
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
      const item = recordToItem(record, userId, now())
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/migrate-legacy-memory.test.ts`
Expected: All 6 tests PASS.

> **Note:** `recordToItem` intentionally duplicates the field-mapping logic from `DreamMemoryStore.draftToItem`/`inferType` to avoid a circular import (`dream-store.ts` already imports the repository). After this task lands, a follow-up refactor can extract the shared mapping into a tiny `record-mapping.ts` module imported by both — but do NOT do that in this batch (keep the diff focused; the duplication is small and mirrors existing code exactly).

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/storage/migrate-legacy-memory.ts qwicks/src/dream/storage/migrate-legacy-memory.test.ts
git commit -m "feat(dream): idempotent FileMemoryStore -> Dream SQLite migration (Batch A)"
```

---

## Task 5: Wire migration + fallback into `runtime-factory`

**Files:**
- Modify: `qwicks/src/server/runtime-factory.ts` (the `buildMemoryStore` dream branch, line ~799-842)

The dream branch must run the migration once (guarded by `migration_log`) before instantiating `DreamMemorySystem`, and fall back to `FileMemoryStore` + return a `migrationError` if migration throws.

- [ ] **Step 1: Read the current dream branch**

Read `qwicks/src/server/runtime-factory.ts` lines 794-842 to see the exact current shape of `buildMemoryStore`.

- [ ] **Step 2: Add the migration import**

At the top of `runtime-factory.ts`, add to the existing dream imports (near line 81-83):

```ts
import { migrateLegacyMemory } from '../dream/storage/migrate-legacy-memory.js'
```

- [ ] **Step 3: Modify the dream branch to run migration with fallback**

Replace the body of the `if (config.backend === 'dream')` block (the part that builds `sqlitePath` ... returns `{ store, dreamSystem, close }`) with:

```ts
  if (config.backend === 'dream') {
    const sqlitePath = join(legacyRootDir, 'dream_memory.db')
    // 构建完整 DreamMemorySystem(facade),这样 HTTP 路由能暴露 summary/ledger/versions。
    // v3(P2-1 报告 §4.8):若提供 modelClient,注入 LLM chat 适配器,使
    // LlmExtractor/LlmSynthesizer 在真实 runtime 用真实模型而非 heuristic。
    const chat = modelClient ? adaptModelClientToDreamChat(modelClient) : undefined
    // 5(差距5):注入真实 pulseResearch —— 用 modelClient 的 chat 做研究摘要。
    const pulseResearch = chat ? async (query: string) => {
      try {
        const result = await chat({
          system: 'You are a research assistant. Given a topic, provide a concise summary with 3 key insights and 2 follow-up questions. Respond in JSON: {"summary": "...", "followUps": ["q1", "q2"]}',
          user: query
        })
        const parsed = JSON.parse(result.text || '{}')
        return {
          query,
          summary: parsed.summary || result.text.slice(0, 500),
          sources: [],
          followUps: Array.isArray(parsed.followUps) ? parsed.followUps : []
        }
      } catch {
        return { query, summary: '(research failed)', sources: [], followUps: [] }
      }
    } : undefined

    // Batch A: migrate legacy FileMemoryStore JSON -> Dream SQLite (idempotent, once).
    // The legacy JSON lives next to the SQLite db in <legacyRootDir>/memory/*.json.
    let migrationError: string | undefined
    try {
      // We need the repository to (a) run the migration and (b) check migration_log.
      // Build a throwaway repo to inspect/run the migration, then hand the same
      // SQLite file to DreamMemorySystem (which opens the same path).
      const probe = new SqliteMemoryRepository({ sqlitePath })
      try {
        const MIGRATION_KIND = 'file_to_dream'
        const prior = probe.lastMigration(MIGRATION_KIND)
        if (!prior) {
          const report = await migrateLegacyMemory({
            fileDir: join(legacyRootDir, 'memory'),
            repository: probe,
            userId: 'default'
          })
          probe.recordMigration({
            kind: MIGRATION_KIND,
            migratedCount: report.migratedCount,
            skippedCount: report.skippedCount,
            failedCount: report.failedCount,
            error: report.failedCount > 0 ? `${report.failedCount} rows failed: ${report.errors.slice(0, 3).join('; ')}` : undefined
          })
        }
      } finally {
        probe.close()
      }
    } catch (err) {
      migrationError = String(err)
    }

    // If migration threw, fall back to FileMemoryStore so the user is never left
    // with an empty Dream DB. The GUI surfaces migrationError as a red banner.
    if (migrationError) {
      return {
        store: new FileMemoryStore({ rootDir: legacyRootDir, config }),
        close: () => {},
        migrationError
      }
    }

    const dreamSystem = new DreamMemorySystem({
      dataDir: legacyRootDir,
      ...(chat ? { chat } : {}),
      ...(pulseResearch ? { pulseResearch } : {})
    })
    const store = dreamSystem.dreamStore
    return {
      store,
      dreamSystem,
      close: () => {
        try {
          dreamSystem.close()
        } catch {
          // 防御性:关闭失败不应阻塞 shutdown。
        }
      }
    }
  }
```

- [ ] **Step 4: Extend the return type to include `migrationError?`**

Find the `buildMemoryStore` return type annotation (line ~798):

```ts
): { store: MemoryStore; close: () => void; dreamSystem?: DreamMemorySystem } {
```

Change it to:

```ts
): { store: MemoryStore; close: () => void; dreamSystem?: DreamMemorySystem; migrationError?: string } {
```

- [ ] **Step 5: Ensure `SqliteMemoryRepository` is imported**

Confirm `SqliteMemoryRepository` is already imported in `runtime-factory.ts` (it is — line 82). If not, add:

```ts
import { SqliteMemoryRepository } from '../dream/storage/sqlite-repository.js'
```

- [ ] **Step 6: Verify the existing runtime-factory / dream tests pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/server/ src/dream/`
Expected: PASS (the migration only fires in the dream branch; existing file-backend tests unaffected).

- [ ] **Step 7: Typecheck qwicks**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add qwicks/src/server/runtime-factory.ts
git commit -m "feat(dream): run FileMemoryStore->Dream migration on backend=dream, fall back on failure"
```

---

## Task 6: Wire `memoryBackend` into the QWicks config in `qwicks-process.ts`

**Files:**
- Modify: `src/main/qwicks-process.ts` (the memory capability block, line ~525-528)

`syncGuiManagedQWicksConfig` builds the `capabilities.memory` object. It currently only sets `enabled`. Add `backend`.

- [ ] **Step 1: Add `backend` to the memory capability config**

In `src/main/qwicks-process.ts`, find the memory block inside the `next = { ... capabilities: { ... memory: { ...memory, enabled: runtime.memoryEnabled } } }` (line ~525). Change it to:

```ts
      memory: {
        ...memory,
        enabled: runtime.memoryEnabled,
        backend: runtime.memoryBackend === 'dream' ? 'dream' : 'file'
      },
```

- [ ] **Step 2: Verify the existing qwicks-process test still passes**

Run: `cd D:\teamflow-desktop-v2 && npx vitest run src/main/qwicks-process.test.ts`
Expected: PASS. If a test asserts the exact shape of the memory config, update it to expect `backend` (it should default to `'file'`).

- [ ] **Step 3: Commit**

```bash
git add src/main/qwicks-process.ts src/main/qwicks-process.test.ts
git commit -m "feat(qwicks): write memory backend into runtime config from GUI setting"
```

---

## Task 7: Add the Memory engine switch to the settings UI

**Files:**
- Modify: `src/renderer/src/components/settings-section-memory.tsx`
- Modify: `src/renderer/src/locales/en/settings.json`
- Modify: `src/renderer/src/locales/zh/settings.json`

Add a segmented File/Dream control right under the "Enable memory" toggle. Switching to Dream shows a confirm dialog explaining the migration.

- [ ] **Step 1: Add locale strings (English)**

In `src/renderer/src/locales/en/settings.json`, near the existing `memory*` keys (line ~1024), add:

```json
  "memoryEngine": "Memory engine",
  "memoryEngineDesc": "Choose how long-term memories are stored. File is the legacy keyword store; Dream is the new semantic memory system with lifecycle, retrieval and dreaming.",
  "memoryEngineFile": "File (legacy)",
  "memoryEngineDream": "Dream",
  "memoryEngineSwitchConfirmTitle": "Switch to Dream memory?",
  "memoryEngineSwitchConfirmBody": "Your existing memories will be copied into the Dream store (the old files are kept). This runs once and is reversible — you can switch back any time. The runtime will restart to apply the change.",
  "memoryEngineSwitchConfirmCta": "Switch & restart",
  "memoryEngineSwitchCancel": "Cancel",
  "memoryMigrationError": "Dream migration failed and fell back to File memory. Your memories are safe in the legacy store. Details: {error}",
```

- [ ] **Step 2: Add locale strings (Chinese)**

In `src/renderer/src/locales/zh/settings.json`, add the matching keys:

```json
  "memoryEngine": "记忆引擎",
  "memoryEngineDesc": "选择长期记忆的存储方式。File 是旧的关键词存储；Dream 是新的语义记忆系统，具备生命周期、检索与 dreaming。",
  "memoryEngineFile": "File（旧版）",
  "memoryEngineDream": "Dream",
  "memoryEngineSwitchConfirmTitle": "切换到 Dream 记忆？",
  "memoryEngineSwitchConfirmBody": "现有记忆会被复制到 Dream 存储中（旧文件保留）。此操作只执行一次，可随时切回。运行时将重启以应用更改。",
  "memoryEngineSwitchConfirmCta": "切换并重启",
  "memoryEngineSwitchCancel": "取消",
  "memoryMigrationError": "Dream 迁移失败，已回退到 File 记忆。你的记忆仍安全保存在旧存储中。详情：{error}",
```

- [ ] **Step 3: Add the engine switch + confirm dialog to the settings component**

In `src/renderer/src/components/settings-section-memory.tsx`, add a `SettingRow` for the engine directly after the "Enable memory" `SettingRow` (after line ~110). Use a simple two-button segmented control and a native `confirm()` for the dialog (the codebase pattern — check how other destructive confirmations are done by grepping `confirm(` in the renderer; if a richer modal component exists, prefer it).

Add this JSX right after the Enable-memory `SettingRow` closing tag:

```tsx
      <SettingRow
        title={t('memoryEngine')}
        description={t('memoryEngineDesc')}
        control={
          <div className="inline-flex overflow-hidden rounded-lg border border-ds-border-muted">
            {(['file', 'dream'] as const).map((engine) => (
              <button
                key={engine}
                type="button"
                onClick={() => {
                  if (engine === 'dream' && (qwicks?.memoryBackend ?? 'file') !== 'dream') {
                    const ok = window.confirm(
                      `${t('memoryEngineSwitchConfirmTitle')}\n\n${t('memoryEngineSwitchConfirmBody')}`
                    )
                    if (!ok) return
                  }
                  updateQWicks({ memoryBackend: engine })
                }}
                className={`px-3 py-1 text-[12px] font-medium transition ${
                  (qwicks?.memoryBackend ?? 'file') === engine
                    ? 'bg-ds-ink text-ds-main'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                {engine === 'dream' ? t('memoryEngineDream') : t('memoryEngineFile')}
              </button>
            ))}
          </div>
        }
      />
```

> **If `updateQWicks` does not yet accept `memoryBackend`:** find the `updateQWicks` handler (grep `updateQWicks` in the renderer) and the `QWicksSettingsPatch`/patch type. Add `memoryBackend?: QWicksMemoryBackend` to the patch type so the call typechecks. This mirrors how `memoryEnabled` is already patched.

- [ ] **Step 4: Surface a migration-error banner (optional but spec-required)**

If `memoryDiagnostics?.migrationError` is present, show the red banner at the top of the card. Add near the top of the returned `SettingsCard` (before the Enable row), guarded:

```tsx
      {ctx.memoryDiagnostics?.migrationError ? (
        <div className="mb-2 rounded-xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
          {t('memoryMigrationError', { error: ctx.memoryDiagnostics.migrationError })}
        </div>
      ) : null}
```

This requires the main process to thread `migrationError` from `buildMemoryStore` through to `memoryDiagnostics` — that wiring is done in Task 8.

- [ ] **Step 5: Typecheck the renderer**

Run: `cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings-section-memory.tsx src/renderer/src/locales/en/settings.json src/renderer/src/locales/zh/settings.json
git commit -m "feat(settings): Memory engine switch (File/Dream) with confirm + migration-error banner"
```

---

## Task 8: Thread `migrationError` through to the GUI diagnostics

**Files:**
- Modify: wherever `memoryDiagnostics` is assembled in the main process and exposed over IPC (find via grep)
- Modify: `src/renderer/src/agent/qwicks-contract.ts` (the diagnostics type the renderer reads) — if `migrationError` needs adding

`buildMemoryStore` now returns `migrationError?`. It must reach `memoryDiagnostics.migrationError` so Task 7's banner renders.

- [ ] **Step 1: Find where the memory store result is consumed**

Run: `cd D:\teamflow-desktop-v2 && grep -rn "buildMemoryStore" src/main qwicks/src --include=*.ts`

- [ ] **Step 2: Capture `migrationError` from the `buildMemoryStore` result**

At the call site of `buildMemoryStore`, destructure `migrationError` and stash it on the runtime context / a module-level variable the diagnostics path can read. Mirror how `dreamSystem` is already captured (the grep in Step 1 of Task 5 showed `runtime-factory.ts:281 const dreamSystem = memory?.dreamSystem`).

- [ ] **Step 3: Expose it via the diagnostics surface**

Add `migrationError?: string` to the diagnostics object the renderer reads (`qwicks-contract.ts` memory diagnostics type, or the `/v1/memory/diagnostics` response). Populate it from the value captured in Step 2.

- [ ] **Step 4: Verify the renderer typechecks and the banner is reachable**

Run: `cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(memory): expose migrationError through diagnostics so the GUI can banner it"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the entire qwicks test suite**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run`
Expected: All tests PASS, including the new `migrate-legacy-memory.test.ts`.

- [ ] **Step 2: Run the main/renderer test suite**

Run: `cd D:\teamflow-desktop-v2 && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Typecheck everything**

Run: `cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json && cd qwicks && npx tsc --noEmit -p tsconfig.json`
Expected: No errors in either.

- [ ] **Step 4: Build qwicks**

Run: `cd D:\teamflow-desktop-v2\qwicks && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Final commit if any stray changes**

```bash
git add -A
git status
# if clean, nothing to commit; otherwise commit
```

Batch A is complete when: the memory engine switch appears in settings, switching to Dream triggers a one-time idempotent migration, existing memories survive, the runtime falls back to File on migration failure with a visible banner, and all tests + typecheck pass.
