# Dream Memory Batch C — Transparency Panel + Share/Export Sanitization

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add the Memory Sources panel (click the `(N sources)` indicator → see used/downranked/suppressed/skipped sources with per-row actions) and a share/export sanitization pipeline that strips ALL source attribution from shared chats (aligned to OpenAI FAQ: "Memory Sources are not included in chats you share") while keeping exports fully faithful (GDPR data portability).

**Architecture:** Two independent pure-function pipelines. `applyShareFilter(payload, mode)` strips source attribution by sourceType (connector types never; chat/saved/custom only when `mode='show-chat'`), with `item.shareable===false` and `item.sensitivityCategories ∩ {financial,health,identity}` as hard overrides. `applyExportFilter(payload)` is faithful (full data, including connector + pending). The backend `buildMemoryLedger` already exists and computes `hiddenWhenShared`; the panel consumes it. A new `source_record.shareable` column makes the SQL filter cheap and the rule explicit.

**Key modeling (spec §3.3):** Don't conflate "source unshareable" with "derived memory unshareable." A memory inferred from Gmail ("user going to Singapore") content IS shareable; what's unshareable is the Gmail source itself (subject/snippet/raw id). The filter strips source *rows* at serialization, not derived memory *content*.

**Tech Stack:** TypeScript, zod, better-sqlite3, vitest, React + lucide-react. Existing: `memory_sources/ledger.ts` (`buildMemoryLedger`, `LedgerEntry`, `DERIVED_SOURCE_TYPES`), `dream-memory-status-indicator.tsx`, `dream` routes.

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §3 (Batch C). Depends on Batch B (`sensitivityCategories`).

**Env note:** Run qwicks tests with Node 22: `export PATH="/c/Users/given/node22:$PATH"` before `npx vitest`.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `qwicks/src/dream/controls/share-export-filter.ts` | Create | Pure `applyShareFilter` / `applyExportFilter` |
| `qwicks/src/dream/controls/share-export-filter.test.ts` | Create | Unit + property tests (the boundary lock) |
| `qwicks/src/dream/types.ts` | Modify | `shareable` field on `SourceRecord` |
| `qwicks/src/dream/storage/sqlite-repository.ts` | Modify | `source_record.shareable` column + backfill |
| `qwicks/src/dream/controls/api.ts` | Modify | Wire filter into export endpoint; add share endpoint |
| `src/renderer/src/components/MemorySourcesPanel.tsx` | Create | Panel UI |
| `src/renderer/src/components/dream-memory-status-indicator.tsx` | Modify | Make `(N sources)` clickable to toggle panel; hide in shared view |
| `src/renderer/src/locales/{en,zh}/settings.json` | Modify | Panel strings |

---

## Task 1: `applyShareFilter` / `applyExportFilter` pure functions (TDD)

**Files:**
- Create: `qwicks/src/dream/controls/share-export-filter.test.ts`
- Create: `qwicks/src/dream/controls/share-export-filter.ts`

This is the heart of Batch C — a property-test-locked boundary.

- [ ] **Step 1: Write failing tests**

Create `qwicks/src/dream/controls/share-export-filter.test.ts`:

```ts
/**
 * Batch C (spec §3): share/export 双管道脱敏。
 * share(给别人)= 全剥离来源归因;export(给自己)= 全保真。
 * 规则 sourceType 驱动 + item.shareable override + sensitivityCategories override(接 Batch B)。
 */
import { describe, expect, it } from 'vitest'
import { SourceType } from '../types.js'
import { applyShareFilter, applyExportFilter } from './share-export-filter.js'
import type { ShareThread, ShareSourceAttribution, ExportPayload } from './share-export-filter.js'

function src(id: string, sourceType: string, opts: Partial<ShareSourceAttribution> = {}): ShareSourceAttribution {
  return {
    sourceId: id,
    sourceType: sourceType as SourceType,
    sourceText: `text-${id}`,
    rawTitle: opts.rawTitle ?? `title-${id}`,
    rawSnippet: opts.rawSnippet ?? `snippet-${id}`,
    itemId: opts.itemId ?? `item-${id}`,
    itemContent: opts.itemContent ?? `content-${id}`,
    itemShareable: opts.itemShareable ?? true,
    itemSensitivityCategories: opts.itemSensitivityCategories ?? [],
    hiddenWhenShared: opts.hiddenWhenShared ?? false
  }
}

function thread(attributions: ShareSourceAttribution[]): ShareThread {
  return {
    assistantText: 'the answer',
    sourceAttributions: attributions
  }
}

describe('applyShareFilter', () => {
  it('default private mode strips ALL source attribution', () => {
    const out = applyShareFilter(thread([src('s1', 'chat'), src('s2', 'gmail')]), 'private')
    expect(out.sourceAttributions).toEqual([])
    expect(out.assistantText).toBe('the answer')
  })

  it('gmail/drive/file sources NEVER appear, even in show-chat mode', () => {
    const out = applyShareFilter(
      thread([src('g', 'gmail', { sourceType: 'gmail' as unknown as SourceType }), src('d', 'drive'), src('f', 'file')]),
      'show-chat'
    )
    expect(out.sourceAttributions).toEqual([])
  })

  it('chat/saved/custom sources appear only in show-chat mode', () => {
    const out = applyShareFilter(thread([src('c', 'chat'), src('sv', 'saved'), src('cu', 'custom')]), 'show-chat')
    expect(out.sourceAttributions.map((a) => a.sourceId)).toEqual(['c', 'sv', 'cu'])
  })

  it('item.shareable===false overrides: source attribution never appears', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { itemShareable: false })]), 'show-chat')
    expect(out.sourceAttributions).toEqual([])
  })

  it('sensitivityCategories ∩ {financial,health,identity} overrides (Batch B)', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { itemSensitivityCategories: ['health'] })]), 'show-chat')
    expect(out.sourceAttributions).toEqual([])
  })

  it('strips rawTitle / rawSnippet / raw source id (the sensitive source payload), keeps content-less type', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { rawTitle: 'Board meeting Q3 confidential' })]), 'show-chat')
    const kept = out.sourceAttributions[0]
    expect(kept.rawTitle).toBeNull()
    expect(kept.rawSnippet).toBeNull()
  })

  it('property: for ANY thread, private mode => attribution count == 0', () => {
    for (let i = 0; i < 200; i++) {
      const n = (i % 5) + 1
      const types = ['gmail', 'drive', 'file', 'chat', 'saved', 'custom'] as const
      const attrs = Array.from({ length: n }, (_, k) => src(`s${k}`, types[k % types.length]))
      const out = applyShareFilter(thread(attrs), 'private')
      expect(out.sourceAttributions.length).toBe(0)
    }
  })

  it('property: show-chat mode => no gmail/drive/file and no unshareable/sensitive items', () => {
    const blocked = new Set(['gmail', 'drive', 'file'])
    for (let i = 0; i < 200; i++) {
      const types = ['gmail', 'drive', 'file', 'chat', 'saved', 'custom'] as const
      const attrs = Array.from({ length: 4 }, (_, k) => src(`s${k}`, types[(i + k) % types.length]))
      const out = applyShareFilter(thread(attrs), 'show-chat')
      for (const a of out.sourceAttributions) {
        expect(blocked.has(a.sourceType as string)).toBe(false)
        expect(a.itemShareable).not.toBe(false)
      }
    }
  })
})

describe('applyExportFilter', () => {
  it('default (shareableOnly=false) is fully faithful — includes ALL sources incl connector', () => {
    const payload: ExportPayload = {
      items: [{ id: 'm1', content: 'goes to Singapore', sourceIds: ['g1', 'c1'] }],
      sourceRecords: [
        { id: 'g1', sourceType: 'gmail', title: 'flight', content: 'Flight to Singapore', shareable: false },
        { id: 'c1', sourceType: 'chat', title: null, content: null, shareable: true }
      ]
    }
    const out = applyExportFilter(payload)
    expect(out.sourceRecords).toHaveLength(2)
    expect(out.items).toHaveLength(1)
  })

  it('shareableOnly=true keeps only shareable source records', () => {
    const payload: ExportPayload = {
      items: [{ id: 'm1', content: 'x', sourceIds: ['g1'] }],
      sourceRecords: [{ id: 'g1', sourceType: 'gmail', title: 't', content: 'c', shareable: false }]
    }
    const out = applyExportFilter(payload, true)
    expect(out.sourceRecords).toEqual([])
  })

  it('two pipelines are independent — export keeps connector content that share strips', () => {
    const gmail = src('g', 'gmail', { rawTitle: 'Board meeting Q3 confidential', rawSnippet: 'top secret' })
    const shared = applyShareFilter(thread([gmail]), 'show-chat')
    const exported = applyExportFilter({
      items: [{ id: 'm1', content: 'Singapore', sourceIds: ['g'] }],
      sourceRecords: [{ id: 'g', sourceType: 'gmail', title: 'Board meeting Q3 confidential', content: 'top secret', shareable: false }]
    })
    // share stripped it; export kept it full
    expect(shared.sourceAttributions).toEqual([])
    expect(exported.sourceRecords[0].content).toBe('top secret')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (Node 22): `cd D:\teamflow-desktop-v2\qwicks && export PATH="/c/Users/given/node22:$PATH" && npx vitest run src/dream/controls/share-export-filter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `qwicks/src/dream/controls/share-export-filter.ts`:

```ts
/**
 * Batch C (spec §3): share / export 双管道脱敏(纯函数)。
 *
 * - share(给别人)= 剥离来源归因,对齐 OpenAI FAQ"分享的聊天不含 Memory Sources"。
 * - export(给自己)= 全保真(GDPR 数据可携带)。
 *
 * 规则 sourceType 驱动(确定性 > 让系统猜):
 *   connector/file/gmail → 永不出现在 share
 *   chat/saved/custom    → mode='private' 默认不显示;mode='show-chat' 才出现
 *   item.shareable===false → override,无论 sourceType 不出现
 *   item.sensitivityCategories ∩ {financial,health,identity} → override(接 Batch B)
 *
 * 关键:别混淆"来源不可分享"与"派生记忆不可分享"。Gmail 推断的"用户去新加坡"
 * 内容可分享,不可分享的是 Gmail 来源本身(subject/snippet/raw id)。
 * 过滤打在 share 序列化时剔除 source 行 + 抹掉 raw payload,不抹派生记忆内容。
 */
import type { SourceType } from '../types.js'

export type ShareMode = 'private' | 'show-chat'

const CONNECTOR_TYPES = new Set<string>(['gmail', 'drive', 'file', 'connector'])
const CHAT_TYPES = new Set<string>(['chat', 'saved', 'custom'])
const SENSITIVE_CATEGORIES = new Set(['financial', 'health', 'identity'])

export interface ShareSourceAttribution {
  sourceId: string
  sourceType: SourceType | string
  sourceText: string
  rawTitle: string | null
  rawSnippet: string | null
  itemId: string
  itemContent: string
  itemShareable: boolean
  itemSensitivityCategories: string[]
  hiddenWhenShared: boolean
}

export interface ShareThread {
  assistantText: string
  sourceAttributions: ShareSourceAttribution[]
}

export interface ShareResult {
  assistantText: string
  sourceAttributions: ShareSourceAttribution[]
}

export interface ExportItem {
  id: string
  content: string
  sourceIds?: string[]
}

export interface ExportSourceRecord {
  id: string
  sourceType: string
  title: string | null
  content: string | null
  shareable: boolean
}

export interface ExportPayload {
  items: ExportItem[]
  sourceRecords: ExportSourceRecord[]
}

function isShareableAttribution(a: ShareSourceAttribution, mode: ShareMode): boolean {
  // Hard overrides (never appear):
  if (!a.itemShareable) return false
  if (a.itemSensitivityCategories.some((c) => SENSITIVE_CATEGORIES.has(c))) return false
  // Source-type rule:
  const st = String(a.sourceType)
  if (CONNECTOR_TYPES.has(st)) return false
  if (CHAT_TYPES.has(st)) return mode === 'show-chat'
  return false
}

/** share(给别人):剥离来源归因。保留助手回答文本。 */
export function applyShareFilter(thread: ShareThread, mode: ShareMode = 'private'): ShareResult {
  if (mode === 'private') {
    return { assistantText: thread.assistantText, sourceAttributions: [] }
  }
  const kept = thread.sourceAttributions
    .filter((a) => isShareableAttribution(a, mode))
    // 抹掉来源的原始 payload(rawTitle / rawSnippet / raw id 已不可逆),只保留脱敏后的类型 + 文本。
    .map((a) => ({
      ...a,
      rawTitle: null,
      rawSnippet: null,
      sourceId: ''
    }))
  return { assistantText: thread.assistantText, sourceAttributions: kept }
}

/** export(给自己):全保真。shareableOnly=true 时只留 shareable 来源。 */
export function applyExportFilter(payload: ExportPayload, shareableOnly = false): ExportPayload {
  if (!shareableOnly) return payload
  return {
    items: payload.items,
    sourceRecords: payload.sourceRecords.filter((s) => s.shareable)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dream/controls/share-export-filter.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/controls/share-export-filter.ts qwicks/src/dream/controls/share-export-filter.test.ts
git commit -m "feat(dream): share/export sanitization pure functions + property tests (Batch C)"
```

---

## Task 2: Add `shareable` column to `source_record`

**Files:**
- Modify: `qwicks/src/dream/types.ts` (`SourceRecord` constructor + fromDict/toDict)
- Modify: `qwicks/src/dream/storage/sqlite-repository.ts` (SCHEMA + insert + backfill)

The `shareable` column makes the SQL filter cheap and the rule explicit in the data. Computed from sourceType at ingest: connector/file/gmail→false, chat/saved/custom→true. Immutable after ingest.

- [ ] **Step 1: Add the field to `SourceRecord`**

In `qwicks/src/dream/types.ts`, `SourceRecord` constructor (line ~348), add a final param:

```ts
    public deleted: boolean = false,
    /** Batch C:按 sourceType 算 — connector/file/gmail→false, chat/saved/custom→true。ingest 时写定,不可变。 */
    public shareable: boolean = true
  ) {}
```

In `fromDict` (line ~376), pass `raw.shareable !== false` as the final arg.

In `toDict` (line ~378), add `shareable: this.shareable`.

Add `shareable?: boolean` to `SourceRecordDict`.

- [ ] **Step 2: Add the column + a helper to compute the default**

In `sqlite-repository.ts` SCHEMA `source_record` CREATE TABLE, add:

```sql
    shareable INTEGER NOT NULL DEFAULT 1
```

Add a helper near the top:

```ts
/** Batch C:sourceType → 默认 shareable(connector/file/gmail→false, 其余→true)。 */
function defaultSourceShareable(sourceType: string): number {
  return ['gmail', 'drive', 'file', 'connector'].includes(sourceType) ? 0 : 1
}
```

In the `source_record` INSERT (find `INSERT INTO source_record`), add `shareable` to the column list and values, computing via `defaultSourceShareable(@source_type)` if the value isn't explicitly provided.

In `addV3ColumnsIfMissing`, add `['shareable', 'INTEGER NOT NULL DEFAULT 1']` AND a one-time backfill UPDATE:

```ts
// Batch C:回填已存在行 — 按 sourceType 算默认 shareable。
try {
  this.db.exec(`UPDATE source_record SET shareable = CASE WHEN source_type IN ('gmail','drive','file','connector') THEN 0 ELSE 1 END WHERE shareable = 1`)
} catch { /* ignore */ }
```

(Place the backfill after the column-add loop, guarded by a try/catch so it's idempotent.)

- [ ] **Step 3: Run existing storage tests + add a regression test**

Run: `npx vitest run src/dream/storage/`
Expected: All pass (additive column + backfill).

Add to an existing source-record test (or `share-export-filter` test): a gmail source round-trips with `shareable===false`, a chat source with `shareable===true`.

- [ ] **Step 4: Commit**

```bash
git add qwicks/src/dream/types.ts qwicks/src/dream/storage/sqlite-repository.ts
git commit -m "feat(dream): source_record.shareable column (sourceType-driven, backfilled) (Batch C)"
```

---

## Task 3: Wire filters into export + add share endpoint

**Files:**
- Modify: `qwicks/src/dream/controls/api.ts` (export endpoint uses `applyExportFilter`; new `shareThread` uses `applyShareFilter`)
- Modify: `qwicks/src/server/routes/dream.ts` + `routes/index.ts` (new `POST /v1/dream/share`)

- [ ] **Step 1: Add a `shareThread` method to `MemoryControls`**

The controls class builds source attributions from the ledger for a thread, then applies the share filter:

```ts
  /** Batch C:序列化某轮对话为可分享 payload(默认全脱敏)。 */
  shareThread(thread: ShareThread, mode: ShareMode = 'private'): ShareResult {
    return applyShareFilter(thread, mode)
  }
```

Import `ShareThread`, `ShareResult`, `ShareMode`, `applyShareFilter` from `./share-export-filter.js`.

For the export path: the existing export already takes `shareableOnly`; wrap its output through `applyExportFilter` so the column-driven `shareable` drives it.

- [ ] **Step 2: Add the route**

In `routes/dream.ts`:

```ts
export async function dreamShare(system: DreamMemorySystem | undefined, request: Request): Promise<JsonResponse> {
  const dream = requireDream(system)
  if (!dream) return ERRORS.unavailable('dream memory system is unavailable')
  const body = (await request.json().catch(() => ({}))) as { thread?: ShareThread; mode?: ShareMode }
  if (!body.thread) return ERRORS.badRequest('thread is required')
  return jsonResponse({ result: dream.controls2.shareThread(body.thread, body.mode ?? 'private') })
}
```

In `routes/index.ts`, register `POST /v1/dream/share` mirroring the pending routes.

- [ ] **Step 3: Typecheck + run controls/route tests**

Run: `npx vitest run src/dream/controls/ src/server/routes/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add qwicks/src/dream/controls/api.ts qwicks/src/server/routes/dream.ts qwicks/src/server/routes/index.ts
git commit -m "feat(dream): share endpoint + export wired through sanitization filters (Batch C)"
```

---

## Task 4: MemorySourcesPanel (frontend)

**Files:**
- Create: `src/renderer/src/components/MemorySourcesPanel.tsx`
- Modify: `src/renderer/src/components/dream-memory-status-indicator.tsx`
- Modify: `src/renderer/src/locales/en/settings.json`, `zh/settings.json`

The panel consumes `DreamTurnMemoryStatus.sources` (the ledger dict). Click the indicator to toggle.

- [ ] **Step 1: Add locale strings (en + zh)**

In both `en/settings.json` and `zh/settings.json`, add near the memory keys:

```json
  "memorySourcesPanelTitle": "Memory sources" / "记忆来源",
  "memorySourcesUsed": "Used" / "已采用",
  "memorySourcesDownranked": "Downranked" / "已降权",
  "memorySourcesSuppressed": "Suppressed" / "已过滤",
  "memorySourcesSkipped": "Skipped" / "已跳过",
  "memorySourcesDontMention": "Don't mention" / "不再提及",
  "memorySourcesNotRight": "This isn't right" / "这条不对",
  "memorySourcesDelete": "Delete source" / "删除来源",
  "memorySourcesEmpty": "No memory sources used for this answer." / "这条回答没有用到记忆来源。"
```

- [ ] **Step 2: Create the panel component**

Create `src/renderer/src/components/MemorySourcesPanel.tsx`. It takes a `ledger` prop (the `DreamTurnMemoryStatus.sources` shape) and renders collapsible sections. Per-row actions call the dream controls (suppression/correction/delete). In a shared view (`isSharedView` prop), render nothing.

The component structure:
- `<UsedSection>`: `ledger.used[]` rows — type badge, truncated sourceText, why-used (reason), score bar, action buttons (Don't mention / This isn't right / Delete source).
- `<DownrankedSection>` (collapsed): `ledger.downranked[]` — read-only + reason.
- `<SuppressedSection>` (collapsed): `ledger.suppressed[]` — read-only + reason.
- `<SkippedSection>` (collapsed): `ledger.skipped[]` — read-only.
- Empty state: if all sections empty, render the `memorySourcesEmpty` text.

Use the existing design-system classes (`rounded-xl border border-ds-border-muted`, `text-[12px]`, etc.) seen in other settings components.

Action handlers call `POST /v1/dream/suppress`, `POST /v1/dream/correction`, `DELETE /v1/dream/source/:id` (these routes may already exist — grep `dream/suppress` in routes; if not, defer the actions to no-ops with a TODO and ship the read-only view first).

- [ ] **Step 3: Make the indicator clickable**

In `dream-memory-status-indicator.tsx`, wrap the `(N sources)` text in a button that toggles a local `useState` `open`. When open, render `<MemorySourcesPanel ledger={...} isSharedView={false} />` below. When the surrounding context is a shared view (check how the component detects it — there's likely an `isShared`/`shared` prop or a store flag), render nothing (hide the indicator entirely, per spec §3.2).

- [ ] **Step 4: Typecheck + build the renderer**

Run: `npx tsc --noEmit -p tsconfig.json` from repo root.
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MemorySourcesPanel.tsx src/renderer/src/components/dream-memory-status-indicator.tsx src/renderer/src/locales/en/settings.json src/renderer/src/locales/zh/settings.json
git commit -m "feat(memory): MemorySourcesPanel — click indicator to see used/suppressed sources (Batch C)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run full dream + root test suites (Node 22)**

```bash
cd D:\teamflow-desktop-v2\qwicks && export PATH="/c/Users/given/node22:$PATH" && npx vitest run
cd D:\teamflow-desktop-v2 && npx vitest run
```
Expected: All pass, 473+ dream tests green including the new share/export filter tests.

- [ ] **Step 2: Typecheck both packages**

```bash
cd D:\teamflow-desktop-v2 && npx tsc --noEmit -p tsconfig.json
cd D:\teamflow-desktop-v2\qwicks && npx tsc --noEmit -p tsconfig.json
```
Expected: No errors.

- [ ] **Step 3: Build qwicks**

`npm run build` from qwicks. Expected: success.

Batch C complete when: clicking the indicator shows used/downranked/suppressed/skipped sources; share endpoint strips all attribution (property tests pass); export stays faithful; shared-view hides the panel.
