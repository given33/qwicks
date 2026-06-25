# Dream Memory Batch D — Capacity Management ("memory full" protection)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Prevent unbounded active-memory growth: when active memory exceeds a soft limit, automatically demote the lowest-value items to `background` (still retrievable when asked, not actively injected) until back under the limit — preserving top-of-mind, protected-window items, and (per Batch B) RESTRICTED items.

**Architecture:** A pure `guardCapacity(items, config): DemotionPlan` ranks active items by a `capacityValueScore` (reuses `topOfMindScore`) and returns which ids to demote. A `MemoryCapacityGuard` executor runs it on dreaming ticks + after-turn persist, applying demotion via `metadata.background = true` + a statusHistory entry. RESTRICTED items never enter the candidate set; SENSITIVE items get a 0.5 penalty (demote before NORMAL at equal value, but never unconditionally). Exceeding hardLimit fires `dream_stage_failed`.

**Key decision (spec §4.3):** `background` is NOT deletion — items are still retrievable on explicit query (per doc "gray memory can be asked about"), just excluded from active injection. This reuses the existing `metadata.background` flag (types.ts:816), no new lifecycle status.

**Tech Stack:** TypeScript, vitest. Existing: `refresh/top-of-mind.ts` (`topOfMindScore`), `MemoryItem.metadata.background`, `SensitivityLevel` (Batch B).

**Spec:** `docs/superpowers/specs/2026-06-25-dream-memory-productization-design.md` §4 (Batch D). Depends on Batch B (`sensitivity`).

**Env note:** Run qwicks tests with Node 22: `export PATH="/c/Users/given/node22:$PATH"`.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `qwicks/src/dream/refresh/capacity-guard.ts` | Create | Pure `guardCapacity` + `MemoryCapacityGuard` executor |
| `qwicks/src/dream/refresh/capacity-guard.test.ts` | Create | TDD tests |
| `qwicks/src/dream/refresh/scheduler.ts` | Modify | Call guard on tick |
| `qwicks/src/dream/chat/pipeline.ts` | Modify | Pass guard into scheduler; expose diagnostics |

---

## Task 1: `guardCapacity` pure function (TDD)

**Files:**
- Create: `qwicks/src/dream/refresh/capacity-guard.test.ts`
- Create: `qwicks/src/dream/refresh/capacity-guard.ts`

- [ ] **Step 1: Write failing tests**

Create `qwicks/src/dream/refresh/capacity-guard.test.ts`:

```ts
/**
 * Batch D (spec §4): MemoryCapacityGuard — soft limit → auto-demote lowest value.
 * RESTRICTED never demoted; SENSITIVE penalized 0.5; protected window + top_of_mind exempt.
 * Background is NOT deletion — items remain retrievable.
 */
import { describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryScope,
  MemoryType,
  SensitivityLevel
} from '../types.js'
import { guardCapacity } from './capacity-guard.js'
import type { CapacityConfig } from './capacity-guard.js'

function item(id: string, opts: Partial<MemoryItem> & { sensitivity?: SensitivityLevel } = {}): MemoryItem {
  return new MemoryItem(
    id,
    'default',
    MemoryType.FACT,
    opts.content ?? `content-${id}`,
    MemoryScope.USER,
    [],
    opts.importance ?? 0.5,
    0.7,
    opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    opts.updatedAt ?? '2026-01-01T00:00:00.000Z',
    null,
    undefined,
    null,
    undefined,
    [],
    opts.metadata ?? {},
    MemoryLifecycleStatus.ACTIVE,
    [],
    2,
    [],
    [],
    undefined,
    null,
    null,
    [],
    [],
    opts.isTopOfMind ?? false,
    opts.isSuppressed ?? false,
    false,
    opts.salience ?? 0.5,
    null,
    null,
    opts.sensitivity ?? SensitivityLevel.NORMAL,
    true,
    []
  )
}

const cfg: CapacityConfig = {
  softLimit: 10,
  hardLimit: 20,
  protectWindowHours: 24,
  sensitiveDemotePenalty: 0.5
}

describe('guardCapacity', () => {
  it('demotes lowest-value items until under softLimit', () => {
    // 12 items, softLimit 10 → demote 2 lowest
    const items = Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: i / 12 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toHaveLength(2)
    // lowest salience (m0, m1) demoted
    expect(plan.toDemote).toContain('m0')
    expect(plan.toDemote).toContain('m1')
  })

  it('RESTRICTED items are never demoted', () => {
    const items = [
      item('r1', { salience: 0.01, sensitivity: SensitivityLevel.RESTRICTED }),
      ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).not.toContain('r1')
  })

  it('SENSITIVE items get 0.5 penalty — demoted before NORMAL at equal value', () => {
    // two items equal salience; the SENSITIVE one should demote first
    const items = [
      item('sensitive', { salience: 0.5, sensitivity: SensitivityLevel.SENSITIVE }),
      item('normal', { salience: 0.5, sensitivity: SensitivityLevel.NORMAL }),
      ...Array.from({ length: 10 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, { ...cfg, softLimit: 11 }, new Date('2026-06-01T00:00:00.000Z'))
    // 12 active, softLimit 11 → demote 1; must be the penalized sensitive one
    expect(plan.toDemote).toContain('sensitive')
    expect(plan.toDemote).not.toContain('normal')
  })

  it('items within protectWindow (recently created) are exempt', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    const recent = item('recent', { salience: 0.01, createdAt: '2026-06-01T11:00:00.000Z' }) // 1h ago
    const items = [recent, ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))]
    const plan = guardCapacity(items, cfg, now)
    expect(plan.toDemote).not.toContain('recent')
  })

  it('top_of_mind items are exempt', () => {
    const items = [
      item('tom', { salience: 0.01, isTopOfMind: true }),
      ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).not.toContain('tom')
  })

  it('under softLimit → nothing demoted', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`m${i}`, { salience: 0.5 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toEqual([])
    expect(plan.atHardLimit).toBe(false)
  })

  it('exceeding hardLimit → atHardLimit flag', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`m${i}`, { salience: 0.5 }))
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.atHardLimit).toBe(true)
  })

  it('idempotent — background items are excluded from active count', () => {
    const bg = item('bg', { salience: 0.01, metadata: { background: true } })
    const items = [
      bg,
      ...Array.from({ length: 10 }, (_, i) => item(`m${i}`, { salience: 0.9 }))
    ]
    // 11 total but 1 is background → active count 10 == softLimit → demote 0
    const plan = guardCapacity(items, cfg, new Date('2026-06-01T00:00:00.000Z'))
    expect(plan.toDemote).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dream/refresh/capacity-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `qwicks/src/dream/refresh/capacity-guard.ts`:

```ts
/**
 * Batch D (spec §4): 容量管理 —— "memory full" 防护。
 *
 * 活跃记忆超过 softLimit 时,自动把最低价值的活跃记忆降到 background(仍可检索,
 * 不主动注入),保留 top-of-mind / 保护期内 / RESTRICTED 记忆。超过 hardLimit 触发告警。
 *
 * 价值分复用 topOfMindScore(salience/importance/recency/usage)。
 * - RESTRICTED 永不进候选集(接 Batch B)。
 * - SENSITIVE 计算时乘 sensitiveDemotePenalty(默认 0.5)—— 同价值下先降,但不会无脑降。
 * - background 不是删除:用户显式问仍能召回(对齐文档"gray memory 可被问起")。
 */
import type { MemoryItem } from '../types.js'
import { SensitivityLevel } from '../types.js'
import { topOfMindScore } from './top-of-mind.js'

export interface CapacityConfig {
  /** 活跃记忆上限,超过触发 demote。 */
  softLimit: number
  /** 硬上限,触达即告警(dream_stage_failed)。 */
  hardLimit: number
  /** 新记忆保护期(小时),期内不降。 */
  protectWindowHours: number
  /** SENSITIVE 降权系数。 */
  sensitiveDemotePenalty: number
}

export const DEFAULT_CAPACITY_CONFIG: CapacityConfig = {
  softLimit: 500,
  hardLimit: 1000,
  protectWindowHours: 24,
  sensitiveDemotePenalty: 0.5
}

export interface DemotionPlan {
  /** 需要降级到 background 的 memory id。 */
  toDemote: string[]
  /** 活跃计数。 */
  activeCount: number
  /** 是否触达 hardLimit(触发告警)。 */
  atHardLimit: boolean
}

function withinProtectWindow(item: MemoryItem, now: Date, hours: number): boolean {
  const created = new Date(item.createdAt)
  if (Number.isNaN(created.getTime())) return false
  return now.getTime() - created.getTime() < hours * 3_600_000
}

/**
 * 纯函数:给定活跃记忆集合 + 配置,返回应降到 background 的 id 列表。
 * 不修改入参,不碰 repository。执行(写 background)由 MemoryCapacityGuard.apply 完成。
 */
export function guardCapacity(items: MemoryItem[], config: CapacityConfig, now: Date): DemotionPlan {
  // active = 非 background 且 ACTIVE/CONFIRMED 状态。
  const active = items.filter(
    (it) => !it.metadata.background && (it.status === 'active' || it.status === 'confirmed')
  )
  const activeCount = active.length

  if (activeCount <= config.softLimit) {
    return { toDemote: [], activeCount, atHardLimit: activeCount > config.hardLimit }
  }

  // 候选集:排除 RESTRICTED / 保护期内 / top-of-mind。
  const candidates = active.filter(
    (it) =>
      it.sensitivity !== SensitivityLevel.RESTRICTED &&
      !it.isTopOfMind &&
      !withinProtectWindow(it, now, config.protectWindowHours)
  )

  // 按价值分排序(升序,最低的先降)。SENSITIVE 乘惩罚系数。
  const ranked = candidates
    .map((it) => {
      let score = topOfMindScore(it, { now })
      if (it.sensitivity === SensitivityLevel.SENSITIVE) {
        score *= config.sensitiveDemotePenalty
      }
      return { id: it.id, score }
    })
    .sort((a, b) => a.score - b.score)

  const toDemoteCount = activeCount - config.softLimit
  const toDemote = ranked.slice(0, toDemoteCount).map((r) => r.id)

  return {
    toDemote,
    activeCount,
    atHardLimit: activeCount > config.hardLimit
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dream/refresh/capacity-guard.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add qwicks/src/dream/refresh/capacity-guard.ts qwicks/src/dream/refresh/capacity-guard.test.ts
git commit -m "feat(dream): guardCapacity — soft limit auto-demote (RESTRICTED exempt, SENSITIVE penalized) (Batch D)"
```

---

## Task 2: `MemoryCapacityGuard` executor + scheduler wiring

**Files:**
- Modify: `qwicks/src/dream/refresh/capacity-guard.ts` (add executor)
- Modify: `qwicks/src/dream/refresh/scheduler.ts` (call on tick)
- Modify: `qwicks/src/dream/chat/pipeline.ts` (pass guard into scheduler)

The executor takes a `DemotionPlan` + repository and applies demotion (set `metadata.background=true`, push a statusHistory entry).

- [ ] **Step 1: Add the executor to capacity-guard.ts**

Append to `qwicks/src/dream/refresh/capacity-guard.ts`:

```ts
import type { MemoryRepository } from '../storage/repository.js'
import { nowIso } from '../types.js'

/**
 * 执行器:把 DemotionPlan 应用到 repository(写 background + statusHistory)。
 * 在 dreaming tick / afterTurn 后台调用,不阻塞热路径。
 * 返回实际降级条数 + 是否触达 hardLimit(供 pipeline 记 dream_stage_failed)。
 */
export class MemoryCapacityGuard {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly config: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ) {}

  /** 跑一次容量检查并执行 demote。 */
  run(userId: string, now: Date = new Date()): { demoted: number; atHardLimit: boolean } {
    const items = this.repository.list(userId, {})
    const plan = guardCapacity(items, this.config, now)
    let demoted = 0
    for (const id of plan.toDemote) {
      const item = this.repository.get(id)
      if (!item) continue
      item.metadata.background = true
      item.statusHistory.push({ at: nowIso(), actor: 'capacity_guard', reason: 'auto_demote_capacity', from: item.status, to: item.status })
      this.repository.upsert(item)
      demoted += 1
    }
    return { demoted, atHardLimit: plan.atHardLimit }
  }
}
```

- [ ] **Step 2: Wire into the scheduler**

In `qwicks/src/dream/refresh/scheduler.ts`, add an optional `capacityGuard?` to `DreamingSchedulerOptions` (mirroring the `pendingStore` field from Batch B). In `tick`, after the pending purge, call:

```ts
    if (this.opts.capacityGuard && opts.userId) {
      try {
        const r = this.opts.capacityGuard.run(opts.userId)
        if (r.atHardLimit) {
          // spec §4:hardLimit 触达 → 告警(由 pipeline 的 failures 机制记录,这里仅返回)
        }
      } catch {
        // fail-open
      }
    }
```

- [ ] **Step 3: Construct the guard in pipeline.ts and pass to scheduler**

In `qwicks/src/dream/chat/pipeline.ts`, import `MemoryCapacityGuard`. Construct it near `new DreamingScheduler`:

```ts
    const capacityGuard = new MemoryCapacityGuard(this.repository)
    this.scheduler = new DreamingScheduler({
      decay,
      temporalDreamer,
      topOfMindBalancer,
      repository: this.repository,
      pendingStore: this.pendingStore,
      capacityGuard
    })
```

- [ ] **Step 4: Run refresh + full dream tests**

Run: `npx vitest run src/dream/refresh/ && npx vitest run src/dream/`
Expected: All pass.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build` (from qwicks).
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add qwicks/src/dream/refresh/capacity-guard.ts qwicks/src/dream/refresh/scheduler.ts qwicks/src/dream/chat/pipeline.ts
git commit -m "feat(dream): MemoryCapacityGuard executor + scheduler/dreaming tick wiring (Batch D)"
```

Batch D complete when: over-softLimit auto-demotes lowest-value items; RESTRICTED never demoted; SENSITIVE penalized; background items excluded from active count (idempotent); hardLimit raises the alert flag; all tests + typecheck + build green.
