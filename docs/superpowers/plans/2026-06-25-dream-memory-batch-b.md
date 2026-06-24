# Dream Memory Batch B — Sensitivity Tiering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add financial/health/identity sensitivity classification and a "high-sensitivity requires confirmation" gate, so that sensitive drafts are physically isolated in a separate `pending_sensitive_draft` table (never in the `memory` table, never retrievable/injectable) until the user confirms them. This is the shared foundation for Batch C (share/export filtering), D (capacity management), and E (query-rewrite filtering) — each downstream reads exactly one field (`sensitivityCategories[]` or `sensitivity`).

**Architecture:** A pure `classifySensitivity()` extends the existing sanitizer's PII detection (zero new detection logic — it just tags categories onto existing `detectSecrets` hits) plus a new health keyword table. The `MemoryItem` gains a `sensitivityCategories: string[]` field (the existing `sensitivity` enum is reused as the coarse tier for D). `persistDrafts` is the single gate: sensitive drafts go to a new `PendingSensitiveStore` (separate SQLite table) instead of `repository.upsert`. Confirmation runs the item through the existing conflict engine then upserts; dismissal writes a sticky tombstone via the existing `suppression_rule` table (scope `sensitive_fingerprint`).

**Key design decision (spec §2.5):** pending drafts live in a **physically separate table**, not behind a status flag. Pending's defining property is "no memory mechanism can touch it before confirmation" — physical separation guarantees this in one stroke; a status-flag approach would require N guards across retrieval/decay/conflict/export/share, and missing any one = the exact privacy leak this feature exists to prevent.

**Tech Stack:** TypeScript, zod, better-sqlite3, vitest (TDD). Existing: `sanitizer.ts` (`detectSecrets`), `types.ts` (`SensitivityLevel`, `MemoryItem`, `MemoryItemDraft`), `sqlite-repository.ts` (`suppression_rule` table), `pipeline.ts` (`persistDrafts`).

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §2 (Batch B). Read it before starting.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `qwicks/src/dream/types.ts` | Modify | Add `sensitivityCategories` field to `MemoryItem` + `MemoryItemDraft`; round-trip in to/fromDict |
| `qwicks/src/dream/storage/sqlite-repository.ts` | Modify | `sensitivity_categories` column on `memory`; `pending_sensitive_draft` table + DDL migration; pending CRUD |
| `qwicks/src/dream/security/sensitivity-classifier.ts` | Create | Pure `classifySensitivity()` — reuses `detectSecrets` + health keyword table |
| `qwicks/src/dream/security/sensitivity-classifier.test.ts` | Create | TDD tests for classifier |
| `qwicks/src/dream/storage/pending-sensitive-store.ts` | Create | `PendingSensitiveStore`: enqueue/get/list/confirm/dismiss + dedup + tombstone query |
| `qwicks/src/dream/storage/pending-sensitive-store.test.ts` | Create | TDD tests for pending store |
| `qwicks/src/dream/chat/pipeline.ts` | Modify | Inject `classifySensitivity` into `persistDrafts` gate; add `confirmPending`/`dismissPending` methods |
| `qwicks/src/dream/controls/api.ts` | Modify | `listPending / confirmPending / dismissPending` control endpoints |

---

## Task 1: Add `sensitivityCategories` to `MemoryItem` and `MemoryItemDraft`

**Files:**
- Modify: `qwicks/src/dream/types.ts` (MemoryItem constructor ~line 498; MemoryItemDraft ~line 865; toDict/fromDict)

The existing `sensitivity` enum (NORMAL/SENSITIVE/RESTRICTED) is the **coarse tier** (D reads it). We add `sensitivityCategories[]` as the **fine category** (E reads it). Both are set together by the classifier.

- [ ] **Step 1: Add the field to `MemoryItem` constructor**

In `qwicks/src/dream/types.ts`, in the `MemoryItem` constructor (line ~498), add a new field right after `public shareable: boolean = true` (line ~549):

```ts
    /** shareable:能否对外共享 / 导出到第三方(默认敏感=false 时仍 true,显式标 restricted 时 false)。 */
    public shareable: boolean = true,
    /**
     * sensitivityCategories:细粒度敏感类别(Batch B)⊆ {financial, health, identity}。
     * E(query-rewrite 过滤)按类别判定;D(容量管理)只读粗档 sensitivity,不碰此字段。
     * 新增类别(如 location)对 D/E 透明。ingest 时由 classifier 写定。
     */
    public sensitivityCategories: string[] = []
```

- [ ] **Step 2: Round-trip it in `toDict()`**

Find `MemoryItem.toDict()` (search `toDict(): MemoryItemDict` in types.ts). Add to the returned object alongside the existing `shareable`:

```ts
      sensitivityCategories: [...this.sensitivityCategories]
```

- [ ] **Step 3: Round-trip it in `fromDict()`**

Find `MemoryItem.fromDict()` and the place where it constructs the new `MemoryItem(...)`. Add the argument (defaulting to `[]` when absent, for old data):

```ts
      Array.isArray(raw.sensitivity_categories) ? [...raw.sensitivity_categories] : (Array.isArray(raw.sensitivityCategories) ? [...raw.sensitivityCategories] : [])
```

Also add `sensitivity_categories?: string[]` and `sensitivityCategories?: string[]` to the `MemoryItemDict` interface.

- [ ] **Step 4: Add to `MemoryItemDraft`**

Find `MemoryItemDraft` (line ~865) and add:

```ts
  /** Batch B:细粒度敏感类别(由 classifier 填充)。 */
  sensitivityCategories: string[]
  /** Batch B:粗档敏感度(由 classifier 填充)。 */
  sensitivity: SensitivityLevel
```

If `MemoryItemDraft` is constructed anywhere without these, update those call sites to pass `[]` / `SensitivityLevel.NORMAL` defaults.

- [ ] **Step 5: Verify existing dream type tests pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/types.test.ts src/dream/storage/v3-roundtrip.test.ts`
Expected: PASS. The v3-roundtrip test must still pass (new field defaults to `[]`).

- [ ] **Step 6: Commit**

```bash
git add qwicks/src/dream/types.ts
git commit -m "feat(dream): add sensitivityCategories field to MemoryItem (Batch B)"
```

---

## Task 2: Persist `sensitivityCategories` in SQLite + add `pending_sensitive_draft` table

**Files:**
- Modify: `qwicks/src/dream/storage/sqlite-repository.ts` (SCHEMA line ~31; `addV3ColumnsIfMissing` line ~1109; row params line ~285, ~357; row mapping line ~1187, ~1226)

- [ ] **Step 1: Add the column to the SCHEMA**

In `qwicks/src/dream/storage/sqlite-repository.ts`, in the `memory` CREATE TABLE (line ~32), add right after the `shareable` line (line ~66):

```sql
    sensitivity_categories TEXT NOT NULL DEFAULT '[]'
```

- [ ] **Step 2: Add the `pending_sensitive_draft` table to SCHEMA**

In the same SCHEMA string, after the `suppression_rule` block (line ~134), add:

```sql
-- Batch B:高敏感待确认草稿(物理隔离 — 不在 memory 表,任何记忆机制碰不到)
CREATE TABLE IF NOT EXISTS pending_sensitive_draft (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    draft_json TEXT NOT NULL,
    category TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS ix_pending_user ON pending_sensitive_draft(user_id, created_at);
```

- [ ] **Step 3: Add the column to `addV3ColumnsIfMissing` (for existing DBs)**

In `addV3ColumnsIfMissing` (line ~1109), the array of `[name, ddl]` pairs ends with `['sensitivity', ...]` and `['shareable', ...]` (line ~1135-1136). Add after them:

```ts
      ['sensitivity_categories', "TEXT NOT NULL DEFAULT '[]'"]
```

- [ ] **Step 4: Add `sensitivity_categories` to the upsert row params**

Find `itemToRowParams` (search `itemToRowParams` / the INSERT statements at line ~285 and ~357). The existing params include `sensitivity` and `shareable`. Add `sensitivity_categories` as a JSON array string. In `itemToRowParams` add to the returned object:

```ts
      sensitivity_categories: JSON.stringify(item.sensitivityCategories ?? [])
```

Then update BOTH INSERT statements (single upsert ~line 280 and batch upsert ~line 357) to include the `sensitivity_categories` column in both the column list and values, and the ON CONFLICT update:

```sql
            ...,
            sensitivity=excluded.sensitivity, shareable=excluded.shareable,
            sensitivity_categories=excluded.sensitivity_categories
```

- [ ] **Step 5: Read it back in `rowToItem` (or the row-mapping function at line ~1187/1226)**

Where the row is mapped back to a MemoryItem (line ~1187 for writing params, line ~1226 for reading), add:

```ts
      sensitivityCategories: parseStringArray(row.sensitivity_categories)
```

If there's no `parseStringArray` helper, parse inline: `Array.isArray(parsed) ? parsed : JSON.parse(String(row.sensitivity_categories ?? '[]'))`.

- [ ] **Step 6: Add a `MemoryRow` type field if needed**

If there's a typed `MemoryRow`/`Row` interface (line ~208 shows `sensitivity: string; shareable: number`), add:

```ts
  sensitivity_categories: string
```

- [ ] **Step 7: Verify storage tests pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/`
Expected: PASS (additive column + new table; existing tests unaffected). The v3-roundtrip test should now carry `sensitivityCategories` through.

- [ ] **Step 8: Commit**

```bash
git add qwicks/src/dream/storage/sqlite-repository.ts
git commit -m "feat(dream): persist sensitivity_categories + add pending_sensitive_draft table"
```

---

## Task 3: Implement `classifySensitivity()` (TDD)

**Files:**
- Create: `qwicks/src/dream/security/sensitivity-classifier.test.ts`
- Create: `qwicks/src/dream/security/sensitivity-classifier.ts`

Reuses `detectSecrets` (zero new detection) + a health keyword table. Sets both `sensitivity` (coarse) and `categories` (fine) together.

- [ ] **Step 1: Write the failing tests**

Create `qwicks/src/dream/security/sensitivity-classifier.test.ts`:

```ts
/**
 * Batch B (spec §2.4): classifySensitivity — financial/health/identity tagging.
 * Reuses detectSecrets (zero new detection) + health keyword table.
 */
import { describe, expect, it } from 'vitest'
import { SensitivityLevel } from '../types.js'
import { classifySensitivity } from './sensitivity-classifier.js'

describe('classifySensitivity', () => {
  it('returns NORMAL with no categories for clean text', () => {
    const r = classifySensitivity('user prefers concise answers')
    expect(r.sensitivity).toBe(SensitivityLevel.NORMAL)
    expect(r.categories).toEqual([])
  })

  it('tags credit card as financial + SENSITIVE', () => {
    const r = classifySensitivity('my card is 4111-1111-1111-1111')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('financial')
  })

  it('tags email/phone/ip/ssn as identity + SENSITIVE', () => {
    const r = classifySensitivity('reach me at alice@example.com or 555-123-4567')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('identity')
  })

  it('tags api_key / jwt / password as identity + RESTRICTED', () => {
    const r = classifySensitivity('the api key is sk-abcdefgh12345678')
    expect(r.sensitivity).toBe(SensitivityLevel.RESTRICTED)
    expect(r.categories).toContain('identity')
  })

  it('tags health keywords as health + SENSITIVE', () => {
    const r = classifySensitivity('I am taking antidepressants for my diagnosis')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('health')
  })

  it('tags Chinese health keywords (病情/服药)', () => {
    const r = classifySensitivity('我最近在服用降压药，病情稳定')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('health')
  })

  it('combines categories when multiple hit (health + identity email)', () => {
    const r = classifySensitivity('my doctor is at alice@example.com about my diabetes')
    expect(r.categories).toContain('health')
    expect(r.categories).toContain('identity')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
  })

  it('records matched patterns for UI display', () => {
    const r = classifySensitivity('card 4111-1111-1111-1111')
    expect(r.matchedPatterns.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/security/sensitivity-classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier**

Create `qwicks/src/dream/security/sensitivity-classifier.ts`:

```ts
/**
 * Batch B (spec §2.4): 敏感信息分类器。
 *
 * 复用 sanitizer.detectSecrets(零新检测逻辑)给 identity/financial 打标签,
 * 新增 health 词表(唯一新写)。命中时同时填两个信号:
 *   - sensitivity:粗档(NORMAL/SENSITIVE/RESTRICTED)— D 容量管理读
 *   - categories:细类(⊆ {financial, health, identity})— E 改写过滤读
 * 推导:api_key/ssn/jwt/password → RESTRICTED;其余命中 → SENSITIVE;否则 NORMAL。
 */
import { SensitivityLevel } from '../types.js'
import { detectSecrets } from './sanitizer.js'

export type SensitivityCategory = 'financial' | 'health' | 'identity'

export interface ClassificationResult {
  sensitivity: SensitivityLevel
  categories: SensitivityCategory[]
  matchedPatterns: Array<{ kind: string; category: SensitivityCategory; snippet: string }>
}

/** secret kind → category 映射(detectSecrets 的 kind 前缀都是 pii_)。 */
const SECRET_KIND_TO_CATEGORY: Record<string, SensitivityCategory> = {
  pii_credit_card: 'financial',
  pii_ssn: 'identity',
  pii_email: 'identity',
  pii_phone: 'identity',
  pii_ip: 'identity',
  pii_jwt: 'identity',
  pii_api_key: 'identity',
  pii_password: 'identity'
}

/** identity secret 命中时升 RESTRICTED 的 kind(高保密凭证)。 */
const RESTRICTED_KINDS = new Set(['pii_api_key', 'pii_password', 'pii_ssn', 'pii_jwt'])

// health 词表(中英)。保守起步:明确的医疗/药物/诊断术语,避免误判日常用语。
const HEALTH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // 药物 / 服药
  [/(?:antidepressants?|insulin|statins?|chemo(?:therapy)?|medication|prescription|taking\s+\w+\s+(?:for|tablets?|pills?))/gi, 'medication'],
  // 病况 / 诊断
  [/(?:diagnos(?:is|ed|es)|diabetes|depression|anxiety|hypertension|cancer|tumor|ADHD|bipolar|asthma|allergies|condition|symptoms?|treatment|therapy|chronic\s+illness)/gi, 'diagnosis'],
  // 中文:服药/病情/诊断/病史/症状/治疗
  [/(?:服药|服用|降压药|抗抑郁|病情|诊断|病史|症状|治疗|糖尿病|抑郁症|高血压|慢性病|过敏)/g, 'health_cn']
]

const CATEGORIES: SensitivityCategory[] = ['financial', 'health', 'identity']

export function classifySensitivity(text: string): ClassificationResult {
  const categories = new Set<SensitivityCategory>()
  const matchedPatterns: ClassificationResult['matchedPatterns'] = []
  let restricted = false

  // 1. 复用 detectSecrets → identity / financial 标签
  for (const finding of detectSecrets(text)) {
    const category = SECRET_KIND_TO_CATEGORY[finding.kind]
    if (!category) continue
    categories.add(category)
    if (RESTRICTED_KINDS.has(finding.kind)) restricted = true
    matchedPatterns.push({ kind: finding.kind, category, snippet: finding.snippet })
  }

  // 2. health 词表(唯一新写)
  for (const [pattern, label] of HEALTH_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      categories.add('health')
      const start = m.index ?? 0
      matchedPatterns.push({ kind: `health_${label}`, category: 'health', snippet: text.slice(Math.max(0, start - 20), start + m[0].length + 20) })
    }
  }

  // 3. 推导 sensitivity 粗档
  let sensitivity = SensitivityLevel.NORMAL
  if (categories.size > 0) sensitivity = SensitivityLevel.SENSITIVE
  if (restricted) sensitivity = SensitivityLevel.RESTRICTED

  return {
    sensitivity,
    categories: CATEGORIES.filter((c) => categories.has(c)),
    matchedPatterns
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/security/sensitivity-classifier.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/security/sensitivity-classifier.ts qwicks/src/dream/security/sensitivity-classifier.test.ts
git commit -m "feat(dream): classifySensitivity — financial/health/identity tagging (Batch B)"
```

---

## Task 4: Implement `PendingSensitiveStore` (TDD)

**Files:**
- Create: `qwicks/src/dream/storage/pending-sensitive-store.test.ts`
- Create: `qwicks/src/dream/storage/pending-sensitive-store.ts`

Wraps the `pending_sensitive_draft` table. Handles bidirectional fingerprint dedup (not re-enqueued if already a confirmed memory) and sticky-dismiss tombstone (via `suppression_rule`).

- [ ] **Step 1: Write the failing tests**

Create `qwicks/src/dream/storage/pending-sensitive-store.test.ts`:

```ts
/**
 * Batch B (spec §2.5): PendingSensitiveStore — physical isolation for
 * high-sensitivity drafts awaiting confirmation.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryItem, MemoryType, MemoryScope } from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'
import { PendingSensitiveStore } from './pending-sensitive-store.js'
import type { MemoryItemDraft } from '../types.js'

function makeDraft(content: string): MemoryItemDraft {
  return {
    type: MemoryType.FACT,
    content,
    scope: MemoryScope.USER,
    tags: [],
    importance: 0.5,
    confidence: 0.7,
    provenance: { source: 'user', actor: 'user', threadId: null, turnId: null, confidence: 0.7, model: null },
    metadata: {},
    sensitivityCategories: ['health'],
    sensitivity: undefined as never // set by store from category
  } as MemoryItemDraft
}

describe('PendingSensitiveStore', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let store: PendingSensitiveStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-pending-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'p.db') })
    store = new PendingSensitiveStore(repo)
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('enqueues a pending draft and lists it', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    const pending = store.list('default')
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(id)
    expect(pending[0].category).toBe('health')
  })

  it('does not re-enqueue a fingerprint that is already pending (UNIQUE dedup)', () => {
    store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    expect(() =>
      store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    ).not.toThrow()
    expect(store.list('default')).toHaveLength(1)
  })

  it('does not enqueue a fingerprint that already exists as a confirmed memory (bidirectional dedup)', () => {
    // seed a confirmed memory with fingerprint fp1
    const item = new MemoryItem('mem_1', 'default', MemoryType.FACT, 'I take insulin', MemoryScope.USER)
    repo.upsert(item) // fingerprint computed from content
    const fp = item.fingerprint()
    expect(() =>
      store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: fp })
    ).not.toThrow()
    // enqueue should be a no-op because the fingerprint already exists in memory table
    expect(store.list('default')).toHaveLength(0)
  })

  it('dismiss writes a sticky tombstone; re-enqueue of same fingerprint is a no-op', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    store.dismiss('default', id, 'fp1')
    expect(store.list('default')).toHaveLength(0)
    // re-enqueue must be skipped because of the tombstone
    store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    expect(store.list('default')).toHaveLength(0)
  })

  it('confirm returns the draft and deletes the pending row', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    const got = store.get(id)
    expect(got).not.toBeNull()
    store.delete(id)
    expect(store.get(id)).toBeNull()
  })

  it('isDismissed reports tombstone state', () => {
    store.recordDismissTombstone('default', 'fp_xyz')
    expect(store.isDismissed('default', 'fp_xyz')).toBe(true)
    expect(store.isDismissed('default', 'fp_other')).toBe(false)
  })

  it('purgeStale removes rows older than maxAgeDays', () => {
    // enqueue with an old created_at by direct DB write
    store.enqueue({ userId: 'default', draft: makeDraft('old'), category: 'health', fingerprint: 'fp_old' })
    // mutate created_at to 40 days ago
    ;(store as unknown as { repo: SqliteMemoryRepository }).repo.rawExec(
      `UPDATE pending_sensitive_draft SET created_at = ? WHERE fingerprint = 'fp_old'`,
      new Date(Date.now() - 40 * 86400_000).toISOString()
    )
    const purged = store.purgeStale(30)
    expect(purged).toBe(1)
    expect(store.list('default')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/pending-sensitive-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `qwicks/src/dream/storage/pending-sensitive-store.ts`:

```ts
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
import type { MemoryItemDraft } from '../types.js'
import type { SqliteMemoryRepository } from './sqlite-repository.js'

const SENSITIVE_FP_SCOPE = 'sensitive_fingerprint'
const PURGE_BATCH_LIMIT = 1000

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
   * Enqueue a pending draft. No-op if the fingerprint already exists as a
   * confirmed memory or as an active dismiss tombstone. UNIQUE(user_id,fingerprint)
   * makes re-enqueue of an already-pending fingerprint a no-op too.
   * Returns the row id (existing id if already pending).
   */
  enqueue(input: EnqueueInput): string {
    // Bidirectional dedup: skip if already a confirmed memory.
    if (this.fingerprintExistsInMemory(input.userId, input.fingerprint)) {
      return ''
    }
    // Sticky dismiss: skip if tombstoned.
    if (this.isDismissed(input.userId, input.fingerprint)) {
      return ''
    }
    const id = `psd_${randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()
    this.repo.rawExec(
      /* sql */ `INSERT OR IGNORE INTO pending_sensitive_draft (id, user_id, draft_json, category, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.userId,
      JSON.stringify(input.draft),
      input.category,
      input.fingerprint,
      now
    )
    // If the UNIQUE constraint ignored the insert, return the existing id.
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
        /* sql */ `SELECT * FROM pending_sensitive_draft WHERE user_id=? ORDER BY created_at DESC LIMIT ${PURGE_BATCH_LIMIT}`,
        userId
      )
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        draft: JSON.parse(r.draft_json) as MemoryItemDraft,
        category: r.category,
        fingerprint: r.fingerprint,
        createdAt: r.created_at
      }))
  }

  get(id: string): PendingDraftRow | null {
    const r = this.repo.rawQueryOne<{ id: string; user_id: string; draft_json: string; category: string; fingerprint: string; created_at: string }>(
      /* sql */ `SELECT * FROM pending_sensitive_draft WHERE id=?`,
      id
    )
    if (!r) return null
    return {
      id: r.id,
      userId: r.user_id,
      draft: JSON.parse(r.draft_json) as MemoryItemDraft,
      category: r.category,
      fingerprint: r.fingerprint,
      createdAt: r.created_at
    }
  }

  delete(id: string): void {
    this.repo.rawExec(/* sql */ `DELETE FROM pending_sensitive_draft WHERE id=?`, id)
  }

  /** Write a sticky dismiss tombstone (permanent: same content never re-pends). */
  recordDismissTombstone(userId: string, fingerprint: string): void {
    const id = `sup_${randomUUID().slice(0, 12)}`
    this.repo.rawExec(
      /* sql */ `INSERT OR IGNORE INTO suppression_rule (id, user_id, scope, target, reason, created_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      id,
      userId,
      SENSITIVE_FP_SCOPE,
      fingerprint,
      'dismissed sensitive draft',
      new Date().toISOString()
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

  /** Aging cleanup (dreaming job): remove rows older than maxAgeDays. Returns count purged. */
  purgeStale(maxAgeDays: number): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString()
    const r = this.repo.rawExec(
      /* sql */ `DELETE FROM pending_sensitive_draft WHERE created_at < ?`,
      cutoff
    )
    return (r as { changes?: number })?.changes ?? 0
  }

  private fingerprintExistsInMemory(userId: string, fingerprint: string): boolean {
    const r = this.repo.rawQueryOne<{ cnt: number }>(
      /* sql */ `SELECT COUNT(*) AS cnt FROM memory WHERE user_id=? AND id IN (SELECT id FROM memory) AND content IS NOT NULL LIMIT 1`
    )
    // The fingerprint is a derived value (sha256 of user+type+content+tags); we
    // cannot SQL-match it directly, so check via the repository's in-memory list.
    // For correctness over large sets, this delegates to repo.list + fingerprint().
    // (See note below — implemented via repo.hasFingerprint helper added in Task 5.)
    return this.repo.hasFingerprint(userId, fingerprint)
  }
}
```

> **Note on `hasFingerprint`:** the fingerprint is `sha256(user_id + type + content + sorted tags)` computed in `MemoryItem.fingerprint()`. It is not a stored column, so SQL cannot match it directly. The cleanest fix: add a `hasFingerprint(userId, fingerprint)` method to `SqliteMemoryRepository` that computes fingerprints over `list(userId)` in memory (the same set the retrieval pipeline already loads). This is added in Task 5 step 2. Also note `rawExec`/`rawQuery`/`rawQueryOne` are assumed to exist on the repository — verify in Task 5 step 1 and add thin wrappers if they don't.

- [ ] **Step 4: Run the tests to verify they fail with the right reason**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/pending-sensitive-store.test.ts`
Expected: FAIL — `rawExec`/`rawQueryOne`/`hasFingerprint` not defined on the repository. (Fixed in Task 5.)

- [ ] **Step 5: Commit (work in progress — tests red by design)**

```bash
git add qwicks/src/dream/storage/pending-sensitive-store.ts qwicks/src/dream/storage/pending-sensitive-store.test.ts
git commit -m "wip(dream): PendingSensitiveStore skeleton (needs repo rawExec/hasFingerprint helpers)"
```

---

## Task 5: Add `rawExec`/`rawQuery`/`hasFingerprint` helpers to the repository

**Files:**
- Modify: `qwicks/src/dream/storage/sqlite-repository.ts` (add helpers; fix `fingerprintExistsInMemory` simplification)

- [ ] **Step 1: Add raw query helpers**

In `SqliteMemoryRepository` (line ~244), add public methods near the other public methods:

```ts
  /** Run arbitrary SQL (DDL/DML). Returns the statement result for changes. */
  rawExec(sql: string, ...params: unknown[]): unknown {
    return this.db.prepare(sql).run(...params)
  }

  /** Run arbitrary SELECT returning rows. */
  rawQuery<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  /** Run arbitrary SELECT returning the first row, or null. */
  rawQueryOne<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null {
    return (this.db.prepare(sql).get(...params) as T) ?? null
  }
```

- [ ] **Step 2: Add `hasFingerprint`**

```ts
  /** Does a memory with this fingerprint already exist for the user? (Batch B bidirectional dedup.) */
  hasFingerprint(userId: string, fingerprint: string): boolean {
    return this.list(userId).some((item) => item.fingerprint() === fingerprint)
  }
```

- [ ] **Step 3: Simplify `fingerprintExistsInMemory` in the pending store**

In `pending-sensitive-store.ts`, replace the body of `fingerprintExistsInMemory` with the single delegation line (delete the dead SQL probe):

```ts
  private fingerprintExistsInMemory(userId: string, fingerprint: string): boolean {
    return this.repo.hasFingerprint(userId, fingerprint)
  }
```

- [ ] **Step 4: Run the pending store tests to verify they pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/pending-sensitive-store.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Verify the full storage suite still passes**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/storage/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add qwicks/src/dream/storage/sqlite-repository.ts qwicks/src/dream/storage/pending-sensitive-store.ts
git commit -m "feat(dream): rawExec/rawQuery/hasFingerprint repo helpers; PendingSensitiveStore green"
```

---

## Task 6: Wire the classifier + pending store into `persistDrafts` (the single gate)

**Files:**
- Modify: `qwicks/src/dream/chat/pipeline.ts` (constructor ~add pending store; `persistDrafts` ~line 580)

This is the single point where sensitive drafts are diverted away from `repository.upsert` into the pending store.

- [ ] **Step 1: Add the pending store to `DreamMemorySystem`**

In `qwicks/src/dream/chat/pipeline.ts`, add an import:

```ts
import { classifySensitivity } from '../security/sensitivity-classifier.js'
import { PendingSensitiveStore } from '../storage/pending-sensitive-store.js'
```

In the `DreamMemorySystem` constructor, after the repository is created, instantiate the pending store:

```ts
    this.pendingStore = new PendingSensitiveStore(this.repository)
```

Add the field declaration to the class (near the other `private readonly` fields):

```ts
  private readonly pendingStore: PendingSensitiveStore
```

- [ ] **Step 2: Expose the pending store for controls + a public getter**

Add a public accessor so `controls/api.ts` can reach it:

```ts
  /** Batch B:暴露 pending store 给 controls(listPending/confirmPending/dismissPending)。 */
  getPendingStore(): PendingSensitiveStore {
    return this.pendingStore
  }
```

- [ ] **Step 3: Add the gate inside `persistDrafts`**

In `persistDrafts` (line ~580), right after `const temporalInfo = detectTemporalFromContent(draft.content)` (line ~592) and **before** constructing the `MemoryItem`, insert the gate. The gate diverts sensitive drafts to the pending store and `continue`s the loop (so they never reach `repository.upsert`):

```ts
      // Batch B:高敏感 draft → 物理隔离到 pending_sensitive_draft,不落 memory 表。
      const classification = classifySensitivity(draft.content)
      if (classification.sensitivity !== 'normal' && classification.categories.length > 0) {
        const draftWithSensitivity = { ...draft, sensitivity: classification.sensitivity, sensitivityCategories: classification.categories }
        // 用临时 MemoryItem 算指纹(不入库),供 pending 双向去重 + sticky dismiss 用。
        const probeItem = new MemoryItem(
          newMemoryId(), userId, draft.type, draft.content, draft.scope, [...draft.tags]
        )
        this.pendingStore.enqueue({
          userId,
          draft: draftWithSensitivity,
          category: classification.categories[0],
          fingerprint: probeItem.fingerprint()
        })
        this.failures.push(`sensitive_draft_pending:${draft.content.slice(0, 40)}`)
        continue
      }
```

- [ ] **Step 4: Set categories/sensitivity on the non-sensitive path too**

After the gate, the item is built. When constructing the `MemoryItem` in `persistDrafts` (the `new MemoryItem(...)` around line ~593), pass the classification (NORMAL + [] for non-sensitive, which is the default — but be explicit so the persisted value reflects reality). Since the constructor defaults are `sensitivity: NORMAL, sensitivityCategories: []`, no change is strictly needed for the non-sensitive path; the gate guarantees only non-sensitive reaches here. Leave it.

- [ ] **Step 5: Add `confirmPending` and `dismissPending` methods to `DreamMemorySystem`**

Add these public methods (confirmation runs the item through the existing conflict engine, per spec §2.5 point 4):

```ts
  /** Batch B:确认一条待确认草稿 → 构造 MemoryItem(带 sensitivity)→ 落库 + 跑 conflict。 */
  confirmPending(id: string): MemoryItem | null {
    const row = this.pendingStore.get(id)
    if (!row) return null
    const draft = row.draft
    const item = new MemoryItem(
      newMemoryId(),
      row.userId,
      draft.type,
      draft.content,
      draft.scope,
      [...draft.tags],
      draft.importance,
      draft.confidence,
      nowIso(),
      nowIso(),
      null,
      new MemoryProvenance(draft.provenance.source, draft.provenance.actor, null, null, draft.provenance.confidence, draft.provenance.model),
      null, null, [], { ...draft.metadata },
      MemoryLifecycleStatus.ACTIVE, [], 2,
      [],
      draft.sourceIds ?? [],
      undefined as never, undefined as never, [], [], false, false, false, draft.importance, undefined as never,
      draft.sensitivity ?? SensitivityLevel.NORMAL, true,
      draft.sensitivityCategories ?? []
    )
    const v = this.embedder.embed(item.content)
    if (v) { item.embedding = v; item.embeddingModel = this.embedder.name() }
    // 跑一遍 conflict(确认的敏感事实可能 supersede 已有记忆)。
    for (const ex of this.repository.list(row.userId, {})) {
      const a = compare(item, ex)
      const action = decide(a)
      if (action === 'supersede_old') {
        ex.transitionStatus(MemoryLifecycleStatus.SUPERSEDED, { actor: 'chat.confirmPending', reason: 'superseded by confirmed sensitive' })
        this.repository.upsert(ex)
      }
    }
    this.repository.upsert(item)
    this.retrieval.onIndexChanged(item)
    this.pendingStore.delete(id)
    return item
  }

  /** Batch B:驳回一条待确认草稿 → 写 sticky tombstone + 删行。 */
  dismissPending(id: string): boolean {
    const row = this.pendingStore.get(id)
    if (!row) return false
    this.pendingStore.dismiss(row.userId, id, row.fingerprint)
    return true
  }
```

Add any missing imports at the top (`SensitivityLevel` from `../types.js`, `compare`/`decide` are already imported).

- [ ] **Step 6: Verify the pipeline tests still pass**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/chat/`
Expected: PASS. (Existing extraction tests that persist non-sensitive drafts are unaffected; sensitive content in any existing test draft will now route to pending — if a test asserts a specific memory count and uses sensitive content, update it to account for the diversion.)

- [ ] **Step 7: Commit**

```bash
git add qwicks/src/dream/chat/pipeline.ts
git commit -m "feat(dream): persistDrafts gate routes sensitive drafts to pending store (Batch B)"
```

---

## Task 7: Add control endpoints (`listPending / confirmPending / dismissPending`)

**Files:**
- Modify: `qwicks/src/dream/controls/api.ts` (the `MemoryControls` class)
- Test: extend an existing controls test or add `controls/api.pending.test.ts`

- [ ] **Step 1: Read the current `MemoryControls` class**

Read `qwicks/src/dream/controls/api.ts` to see the class shape and how it wraps the repository / dream system.

- [ ] **Step 2: Add the three methods**

`MemoryControls` needs access to the pending store + confirm/dismiss, which live on `DreamMemorySystem`. Add methods that delegate to the injected dream system (add a `dreamSystem` reference to the controls if not present):

```ts
  /** Batch B:列出待确认草稿。 */
  listPending(userId: string): PendingDraftRow[] {
    return this.dreamSystem.getPendingStore().list(userId)
  }

  /** Batch B:确认待确认草稿 → 落库为 SENSITIVE MemoryItem。 */
  confirmPending(id: string): MemoryItem | null {
    return this.dreamSystem.confirmPending(id)
  }

  /** Batch B:驳回待确认草稿(sticky tombstone)。 */
  dismissPending(id: string): boolean {
    return this.dreamSystem.dismissPending(id)
  }
```

Import `PendingDraftRow` from `../storage/pending-sensitive-store.js` and `MemoryItem` from `../types.js`. If `MemoryControls` does not already hold a `dreamSystem` reference, add it to the constructor options (the runtime-factory wires `MemoryControls` — update that wiring in Step 4 if needed).

- [ ] **Step 3: Write a test for the control flow**

Create or extend a controls test asserting: a sensitive draft persisted via the pipeline shows in `listPending`, `confirmPending` moves it into the memory table, `dismissPending` tombstones it so a re-extract does not re-pend. Keep it focused on the control surface; the pipeline gate is already tested via Task 6.

- [ ] **Step 4: Wire `dreamSystem` into `MemoryControls` if not present**

If the controls constructor didn't take a dream system, add it and update the construction site (grep `new MemoryControls(` to find it — likely in `pipeline.ts` constructor or `runtime-factory.ts`).

- [ ] **Step 5: Run the controls tests**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/controls/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add qwicks/src/dream/controls/ qwicks/src/dream/chat/pipeline.ts
git commit -m "feat(dream): MemoryControls listPending/confirmPending/dismissPending (Batch B)"
```

---

## Task 8: Dreaming job aging cleanup + visibility wiring

**Files:**
- Modify: `qwicks/src/dream/refresh/scheduler.ts` (call `pendingStore.purgeStale(30)` on tick)
- Modify: summary builder to exclude pending from counts (verify it already does, since pending isn't in the memory table)

- [ ] **Step 1: Add aging purge to the dreaming scheduler**

In `qwicks/src/dream/refresh/scheduler.ts`, in the tick body (find the existing tick/run method), add a fail-open purge call:

```ts
      // Batch B:清理 30 天未确认的待确认草稿(纯老化,不留 tombstone)。
      try {
        this.pendingStore?.purgeStale(30)
      } catch {
        // fail-open: 清理失败不影响 dreaming 主循环。
      }
```

If the scheduler doesn't hold a `pendingStore` reference, pass it in via the scheduler's constructor options from `DreamMemorySystem`.

- [ ] **Step 2: Verify summary builder excludes pending**

Confirm `buildSummary` (pipeline.ts ~line 672) reads only from `repository.list(...)` — since pending drafts are in a separate table, they are already excluded from all summary section counts. Add a one-line test in an existing summary test if one exists, asserting pending drafts don't inflate counts. (If no easy hook, skip — the physical separation guarantees it.)

- [ ] **Step 3: Run the refresh tests**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/refresh/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add qwicks/src/dream/refresh/scheduler.ts
git commit -m "feat(dream): dreaming tick purges stale pending drafts (>30d) (Batch B)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the entire dream test suite**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx vitest run src/dream/`
Expected: All tests PASS, including the new classifier, pending store, and gate tests.

- [ ] **Step 2: Typecheck qwicks**

Run: `cd D:\teamflow-desktop-v2\qwicks && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: No errors. Watch especially for the `MemoryItemDraft`/`MemoryItem` constructor arity changes (the new `sensitivityCategories` arg is last, so positional call sites in `persistDrafts`/`confirmPending` must include it or rely on defaults — defaults are safe).

- [ ] **Step 3: Build qwicks**

Run: `cd D:\teamflow-desktop-v2\qwicks && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Cross-batch contract check**

Confirm the two signals downstream batches will read are present:
- Batch D reads `item.sensitivity` (the coarse enum) — present since the original codebase, now populated by the classifier.
- Batch E reads `item.sensitivityCategories` — added in Task 1, persisted in Task 2.

Run a quick sanity query: `grep -rn "sensitivityCategories" qwicks/src/dream | head` — should show types.ts, sqlite-repository.ts, sensitivity-classifier.ts, pending-sensitive-store.ts.

- [ ] **Step 5: Final commit if any stray changes**

```bash
git add -A
git status
# if clean, nothing to commit
```

Batch B is complete when: the classifier tags financial/health/identity, sensitive drafts are physically isolated in `pending_sensitive_draft` (never in `memory`, never retrievable/injectable/decayable), confirmation upserts + runs conflict, dismissal is sticky via tombstone, stale drafts purge after 30 days, and all tests + typecheck pass.
