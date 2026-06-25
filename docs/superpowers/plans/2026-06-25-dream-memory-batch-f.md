# Dream Memory Batch F — Improve-the-model Data Controls

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Two independent, default-off toggles controlling whether memory data may be used for model improvement / model training (opt-out). Default-off = zero exfiltration. Local memory capability (retrieval/extract/dream) is unaffected — these gate only data reporting/upload paths.

**Architecture:** A `DataControlSettings` type on `QWicksRuntimeSettingsV1` (two booleans, default false), wired through the same GUI→config path as `memoryBackend`. A pure `canReportMemoryData(settings)` predicate gates any report/upload path. A test locks the gate semantics.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §6 (Batch F).

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/shared/app-settings-types.ts` | Modify | `DataControlSettings` + field on runtime settings |
| `src/shared/app-settings-qwicks.ts` | Modify | default + resolve (default false) |
| `qwicks/src/dream/controls/data-control.ts` | Create | pure `canReportMemoryData` predicate |
| `qwicks/src/dream/controls/data-control.test.ts` | Create | gate tests |

---

## Task 1: Settings type + default (default-off)

**Files:** `src/shared/app-settings-types.ts`, `src/shared/app-settings-qwicks.ts`

- [ ] **Step 1:** In `app-settings-types.ts` add a type + field on `QWicksRuntimeSettingsV1` (after `memoryBackend`):

```ts
/** Batch F(spec §6.1):数据控制 —— 记忆数据是否参与模型改进/训练。默认全关(零外发)。 */
export interface DataControlSettings {
  /** 记忆数据是否参与模型改进(retrieval/extract 本地照常,只控制是否上报/外发)。 */
  allowModelImprovement: boolean
  /** 记忆数据是否参与模型训练(opt-out)。 */
  allowTraining: boolean
}
```

Add `dataControl: DataControlSettings` to `QWicksRuntimeSettingsV1`.

- [ ] **Step 2:** In `app-settings-qwicks.ts`, in `defaultQWicksRuntimeSettings`, add:

```ts
    dataControl: { allowModelImprovement: false, allowTraining: false }
```

Add `resolveDataControl(raw)` mirroring `resolveMemoryBackend` (defaults both false if absent).

- [ ] **Step 3:** Typecheck repo — `npx tsc --noEmit -p tsconfig.json` (root). 0 errors.

- [ ] **Step 4:** Commit `feat(settings): add DataControlSettings (default off) (Batch F)`.

## Task 2: `canReportMemoryData` predicate (TDD)

**Files:** create `qwicks/src/dream/controls/data-control.ts` + `.test.ts`

- [ ] **Step 1: failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { canReportMemoryData } from './data-control.js'

describe('canReportMemoryData (Batch F)', () => {
  it('default-off: both false → cannot report for improvement or training', () => {
    expect(canReportMemoryData({ allowModelImprovement: false, allowTraining: false }, 'improvement')).toBe(false)
    expect(canReportMemoryData({ allowModelImprovement: false, allowTraining: false }, 'training')).toBe(false)
  })
  it('improvement allowed but training off → improvement yes, training no', () => {
    const s = { allowModelImprovement: true, allowTraining: false }
    expect(canReportMemoryData(s, 'improvement')).toBe(true)
    expect(canReportMemoryData(s, 'training')).toBe(false)
  })
  it('both on → both yes', () => {
    const s = { allowModelImprovement: true, allowTraining: true }
    expect(canReportMemoryData(s, 'improvement')).toBe(true)
    expect(canReportMemoryData(s, 'training')).toBe(true)
  })
})
```

- [ ] **Step 2: implement**

```ts
export type ReportPurpose = 'improvement' | 'training'
export interface DataControlSettings {
  allowModelImprovement: boolean
  allowTraining: boolean
}

/** Batch F:某用途能否外发记忆数据?任一相关开关关 → 拒绝(零外发)。 */
export function canReportMemoryData(settings: DataControlSettings, purpose: ReportPurpose): boolean {
  if (purpose === 'training') return settings.allowTraining === true
  return settings.allowModelImprovement === true
}
```

- [ ] **Step 3:** run `npx vitest run src/dream/controls/data-control.test.ts` (Node 22) → pass.
- [ ] **Step 4:** Commit `feat(dream): canReportMemoryData data-control predicate (Batch F)`.

## Task 3: GUI toggle + verification

**Files:** `settings-section-memory.tsx`, locales

- [ ] Add a `SettingRow` with two toggles (model improvement / training), default off. Locale strings en+zh.
- [ ] Typecheck repo + run root tests.
- [ ] Commit `feat(settings): data-control toggles in memory settings (Batch F)`.

Batch F complete when: two default-off toggles persist; predicate gates report paths; tests + typecheck green.
