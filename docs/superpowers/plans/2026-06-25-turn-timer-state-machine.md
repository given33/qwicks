# Turn 时间状态机 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把模型回复的「思考/处理」时间显示从并列双计时改造为单一延续计时器 + 四态状态机（THINKING_WAIT → THINKING_REASON → PROCESSING → DONE），并彻底隐藏模型内部思考文本。

**Architecture:** 新增一个纯函数状态机模块 `turn-timer.ts`（无 React 依赖、易单测），驱动 `WorkMetaRow` 的标签/秒数渲染；从 `groupProcessSections` 过滤掉 reasoning block，使思考文本永不渲染。所有计时数据复用现有 store 字段，不改 store schema、不改 runtime 协议。

**Tech Stack:** TypeScript, React (函数组件 + hooks), Vitest, i18next。前端代码在 `src/renderer/src/`。

**Spec:** `docs/superpowers/specs/2026-06-25-turn-timer-state-machine-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/components/chat/turn-timer.ts` | 状态机纯函数 `deriveTurnTimer` + 类型 `TurnPhase`/`TurnTimerInput`/`TurnTimerState` | 🆕 创建 |
| `src/renderer/src/components/chat/turn-timer.test.ts` | 状态机四态转移单测 | 🆕 创建 |
| `src/renderer/src/components/chat/message-timeline-tools.ts` | 已有 `formatDuration`（复用） | 不动 |
| `src/renderer/src/components/chat/message-timeline-process.tsx` | `groupProcessSections` 过滤 reasoning；删 `describeProcessSection` reasoning 分支；`ProcessSectionRow` 删 reasoning props | ✏️ 改 |
| `src/renderer/src/components/chat/group-process-sections.test.ts` | 更新 reasoning 断言（reasoning 现被过滤） | ✏️ 改 |
| `src/renderer/src/components/chat/message-timeline-cards.tsx` | `WorkMetaRow` 改为消费 `TurnTimerState`，删 `reasoningDurationMs`/`showThoughtSuffix` | ✏️ 改 |
| `src/renderer/src/components/chat/MessageTimeline.tsx` | `MessageTurn` 调 `deriveTurnTimer`，删 `reasoningDurationMs` 传递 | ✏️ 改 |
| `src/renderer/src/locales/zh/common.json` | 加 `thinkingWithSeconds`/`processingWithDuration`/`processedWithDuration`，删 `thoughtFor`/`thoughtSteps`/`thinkingLabel` | ✏️ 改 |
| `src/renderer/src/locales/en/common.json` | 同上 | ✏️ 改 |

---

## Task 1: 状态机纯函数 `turn-timer.ts`（TDD）

**Files:**
- Create: `src/renderer/src/components/chat/turn-timer.ts`
- Test: `src/renderer/src/components/chat/turn-timer.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/renderer/src/components/chat/turn-timer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveTurnTimer } from './turn-timer'

const NOW = 10_000

describe('deriveTurnTimer', () => {
  it('THINKING_WAIT: no reasoning, no assistant -> no seconds', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: false,
      hasLiveAssistant: false,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_wait')
    expect(r.displayMs).toBeUndefined()
    expect(r.labelKey).toBe('thinkingNow')
  })

  it('THINKING_REASON: first reasoning delta -> seconds from reasoningStartedAt', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: false,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_reason')
    expect(r.displayMs).toBe(1000)
    expect(r.labelKey).toBe('thinkingWithSeconds')
  })

  it('PROCESSING (from thinking): assistant arrives -> continues timer, no reset', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: true,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
    // same reasoningStartedAt as THINKING_REASON -> seconds continue, not reset
    expect(r.displayMs).toBe(1000)
    expect(r.labelKey).toBe('processingWithDuration')
  })

  it('PROCESSING (skip thinking): no reasoning, direct assistant -> fallback to turnStartedAt', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: false,
      hasLiveAssistant: true,
      turnStartedAt: 7000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
    expect(r.displayMs).toBe(3000)
    expect(r.labelKey).toBe('processingWithDuration')
  })

  it('DONE: uses recordedDurationMs when present', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      reasoningStartedAt: 9000,
      recordedDurationMs: 12_000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(12_000)
    expect(r.labelKey).toBe('processedWithDuration')
  })

  it('DONE: falls back to now - reasoningStartedAt when no recorded duration', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      reasoningStartedAt: 8000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(2000)
  })

  it('DONE: falls back to now - turnStartedAt when no reasoning', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      turnStartedAt: 6000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(4000)
  })

  it('reasoning reappearing after PROCESSING does not revert to thinking', () => {
    // already in processing (assistant seen), reasoning still present -> stays processing
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: true,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
  })

  it('THINKING_REASON without reasoningStartedAt -> undefined displayMs', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: false,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_reason')
    expect(r.displayMs).toBeUndefined()
  })

  it('idle when not processing and no data', () => {
    const r = deriveTurnTimer({ isProcessing: false, nowMs: NOW })
    expect(r.phase).toBe('idle')
    expect(r.displayMs).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/components/chat/turn-timer.test.ts`
Expected: FAIL — `Cannot find module './turn-timer'`

- [ ] **Step 3: 写最小实现**

Create `src/renderer/src/components/chat/turn-timer.ts`:

```ts
/**
 * Turn 时间状态机（纯函数，无 React 依赖）。
 *
 * 单一计时器从「第一个 reasoning delta」起跳，全程不重置。
 * 思考只是处理全过程的开头一段；吐字只换标签，秒数延续。
 *
 * 详见 docs/superpowers/specs/2026-06-25-turn-timer-state-machine-design.md
 */
export type TurnPhase =
  | 'idle'
  | 'thinking_wait'
  | 'thinking_reason'
  | 'processing'
  | 'done'

export type TurnTimerInput = {
  /** busy || turnPending || hasLiveStream —— turn 是否还在运行 */
  isProcessing: boolean
  /** !!liveReasoning.trim() —— 是否有思考流 */
  hasLiveReasoning: boolean
  /** !!liveAssistant.trim() —— 是否已有回复文字 */
  hasLiveAssistant: boolean
  /** turnReasoningFirstAtByUserId[userId] —— 首个 reasoning delta 时刻（秒数起跳点） */
  reasoningStartedAt?: number
  /** turnStartedAtByUserId[userId] —— 无 reasoning 时的兜底起点 */
  turnStartedAt?: number
  /** turnDurationByUserId[userId] —— turn 结束时固化的总时长（DONE 优先用） */
  recordedDurationMs?: number
  /** 父组件 1s tick 的 now（epoch ms） */
  nowMs: number
}

export type TurnTimerState = {
  phase: TurnPhase
  /** 仅 thinking_wait 为 undefined（不显示秒数）；其余态有值则显示 */
  displayMs?: number
  /** i18n key */
  labelKey: 'thinkingNow' | 'thinkingWithSeconds' | 'processingWithDuration' | 'processedWithDuration'
}

/**
 * 计算当前应显示的时间态。优先级：done > processing > thinking_reason > thinking_wait。
 * 计时起点优先 reasoningStartedAt，无 reasoning 用 turnStartedAt 兜底。
 */
export function deriveTurnTimer(input: TurnTimerInput): TurnTimerState {
  const { isProcessing, hasLiveReasoning, hasLiveAssistant, nowMs } = input
  const reasoningStartedAt = numOrUndef(input.reasoningStartedAt)
  const turnStartedAt = numOrUndef(input.turnStartedAt)
  const recordedDurationMs = numOrUndef(input.recordedDurationMs)

  // DONE: turn 结束。优先用固化的总时长；否则从起点推算。
  if (!isProcessing) {
    const displayMs =
      recordedDurationMs ??
      (reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined) ??
      (turnStartedAt != null ? Math.max(0, nowMs - turnStartedAt) : undefined)
    if (displayMs == null && reasoningStartedAt == null && turnStartedAt == null && recordedDurationMs == null) {
      return { phase: 'idle', displayMs: undefined, labelKey: 'processedWithDuration' }
    }
    return { phase: 'done', displayMs, labelKey: 'processedWithDuration' }
  }

  // PROCESSING: 已有回复文字。秒数延续（用同一 reasoningStartedAt，不重置）。
  if (hasLiveAssistant) {
    const displayMs =
      (reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined) ??
      (turnStartedAt != null ? Math.max(0, nowMs - turnStartedAt) : undefined)
    return { phase: 'processing', displayMs, labelKey: 'processingWithDuration' }
  }

  // THINKING_REASON: 有思考流、还没吐字。秒数从 reasoningStartedAt 起。
  if (hasLiveReasoning) {
    const displayMs =
      reasoningStartedAt != null ? Math.max(0, nowMs - reasoningStartedAt) : undefined
    return { phase: 'thinking_reason', displayMs, labelKey: 'thinkingWithSeconds' }
  }

  // THINKING_WAIT: 本地乐观渲染期，模型还没真正收到任务。无秒数。
  return { phase: 'thinking_wait', displayMs: undefined, labelKey: 'thinkingNow' }
}

function numOrUndef(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/components/chat/turn-timer.test.ts`
Expected: PASS — 10 tests passed

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/chat/turn-timer.ts src/renderer/src/components/chat/turn-timer.test.ts
git commit -m "feat(timeline): turn-timer state machine pure function + tests"
```

---

## Task 2: i18n 键增删（zh + en）

**Files:**
- Modify: `src/renderer/src/locales/zh/common.json`（约 `:1900-1903`）
- Modify: `src/renderer/src/locales/en/common.json`（约 `:1900-1903`）

- [ ] **Step 1: 改 zh locale**

在 `src/renderer/src/locales/zh/common.json` 中，定位到这几行（约 1900 行附近）并做增删。

删除这三行：
```json
  "thoughtFor": "思考 {{duration}}",
  "thinkingNow": "思考中…",
  "thoughtSteps": "思考（{{count}} 步）",
```

替换为：
```json
  "thinkingNow": "思考中…",
  "thinkingWithSeconds": "思考中 {{duration}}",
  "thoughtSteps": "思考（{{count}} 步）",
```

Wait — `thinkingNow` 已存在，不删。精确操作如下。

**实际操作：** 找到 `"thinkingNow": "思考中…"`（约 :1901），在它**后面**新增一行 `"thinkingWithSeconds": "思考中 {{duration}}",`。然后找到 `"thoughtFor": "思考 {{duration}}"`（约 :1900）和 `"thoughtSteps": "思考（{{count}} 步）"`（约 :1903），删除这两行（注意保留 JSON 合法逗号）。同时删除 `"thinkingLabel": "思考过程",`（约 :1886）。

最终该区域应为（顺序保持）：
```json
  "processTextLabel": "文本输出",
  "thinkingWithSeconds": "思考中 {{duration}}",
  "thinkingNow": "思考中…",
```

并新增（与 `processing`/`processed` 相邻，约 :1873-1874 附近）：
```json
  "processing": "处理中",
  "processingWithDuration": "处理中 {{duration}}",
  "processed": "已处理",
  "processedWithDuration": "已处理 {{duration}}",
```

- [ ] **Step 2: 改 en locale（对称操作）**

在 `src/renderer/src/locales/en/common.json` 做完全对称的改动：
- `:1873-1874` 附近加 `"processingWithDuration": "Processing {{duration}}",` 和 `"processedWithDuration": "Processed {{duration}}",`
- 删除 `"thinkingLabel": "Thinking",`（:1886）
- 加 `"thinkingWithSeconds": "Thinking {{duration}}",`（在 `thinkingNow` 后）
- 删除 `"thoughtFor": "Thought for {{duration}}"`（:1900）和 `"thoughtSteps": "Thought ({{count}} steps)"`（:1903）

- [ ] **Step 3: 验证 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/renderer/src/locales/zh/common.json','utf8')); JSON.parse(require('fs').readFileSync('src/renderer/src/locales/en/common.json','utf8')); console.log('OK')"`
Expected: 输出 `OK`

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/locales/zh/common.json src/renderer/src/locales/en/common.json
git commit -m "feat(i18n): add thinkingWithSeconds/processingWithDuration/processedWithDuration; drop thoughtFor/thoughtSteps/thinkingLabel"
```

---

## Task 3: `groupProcessSections` 过滤 reasoning

**Files:**
- Modify: `src/renderer/src/components/chat/message-timeline-process.tsx:45-76`（`groupProcessSections`）
- Test: `src/renderer/src/components/chat/group-process-sections.test.ts:62-72`

- [ ] **Step 1: 更新现有测试（先改测试，让失败显式）**

打开 `src/renderer/src/components/chat/group-process-sections.test.ts`，找到 `separates reasoning sections from execution sections`（约 :62-72）。

替换整个测试用例为两个新断言 —— reasoning 现在应被**过滤掉**：

```ts
  it('filters out reasoning blocks (never rendered)', () => {
    const blocks: ChatBlock[] = [
      reasoning('re1'),
      tool('r1', 'read'),
      tool('r2', 'read'),
      reasoning('re2')
    ]
    const sections = groupProcessSections(blocks)
    // reasoning blocks are dropped entirely — only the execution section remains
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('execution')
    expect(sections[0].category).toBe('read')
    expect(sections[0].blocks).toHaveLength(2)
  })

  it('returns empty when only reasoning blocks present', () => {
    const blocks: ChatBlock[] = [reasoning('re1'), reasoning('re2')]
    const sections = groupProcessSections(blocks)
    expect(sections).toHaveLength(0)
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/src/components/chat/group-process-sections.test.ts`
Expected: FAIL — `filters out reasoning blocks` 失败（当前实现仍产出 reasoning section）

- [ ] **Step 3: 改 `groupProcessSections` 过滤 reasoning**

在 `src/renderer/src/components/chat/message-timeline-process.tsx` 的 `groupProcessSections` 函数（:45）里，在 `for` 循环顶部加一行过滤。

将：
```ts
export function groupProcessSections(blocks: ChatBlock[]): ProcessSection[] {
  const sections: ProcessSection[] = []

  for (const block of blocks) {
    const kind =
      block.kind === 'reasoning'
        ? 'reasoning'
        : block.kind === 'assistant'
          ? 'output'
          : 'execution'
```

改为（在循环体第一行跳过 reasoning）：
```ts
export function groupProcessSections(blocks: ChatBlock[]): ProcessSection[] {
  const sections: ProcessSection[] = []

  for (const block of blocks) {
    // Reasoning blocks are never rendered — the model's internal thinking
    // stays hidden (see turn-timer state machine spec). Drop them here so
    // expanded process stacks only show tool/execution steps.
    if (block.kind === 'reasoning') continue
    const kind =
      block.kind === 'assistant'
        ? 'output'
        : 'execution'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/renderer/src/components/chat/group-process-sections.test.ts`
Expected: PASS — 所有用例（含新增的 2 个）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/chat/message-timeline-process.tsx src/renderer/src/components/chat/group-process-sections.test.ts
git commit -m "feat(timeline): filter reasoning blocks from groupProcessSections (thinking content never rendered)"
```

---

## Task 4: 清理 `describeProcessSection` 的 reasoning 分支

**Files:**
- Modify: `src/renderer/src/components/chat/message-timeline-process.tsx:139-281`（`ProcessSectionRow` props）
- Modify: `src/renderer/src/components/chat/message-timeline-process.tsx:700-734`（`describeProcessSection`）
- Modify: `src/renderer/src/components/chat/MessageTimeline.tsx:498-505,558-569`（调用点）

- [ ] **Step 1: 删 `describeProcessSection` 的 reasoning 分支**

在 `src/renderer/src/components/chat/message-timeline-process.tsx` 的 `describeProcessSection`（:700），删除整个 reasoning 分支。

将：
```ts
function describeProcessSection(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    processing: boolean
    reasoningDurationMs?: number
    singleReasoningSection: boolean
  }
): string {
  if (section.kind === 'reasoning') {
    if (opts.processing && isProcessSectionActive(section, true)) {
      return t('thinkingNow')
    }
    if (
      opts.singleReasoningSection &&
      typeof opts.reasoningDurationMs === 'number' &&
      opts.reasoningDurationMs >= 1000
    ) {
      return t('thoughtFor', { duration: formatDuration(opts.reasoningDurationMs) })
    }
    return section.blocks.length > 1
      ? t('thoughtSteps', { count: section.blocks.length })
      : t('thinkingLabel')
  }

  if (section.kind === 'output') {
    return t('processTextLabel')
  }
```

改为（删 reasoning 分支 + 简化 opts 签名）：
```ts
function describeProcessSection(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    processing: boolean
  }
): string {
  if (section.kind === 'output') {
    return t('processTextLabel')
  }
```

- [ ] **Step 2: 删 `ProcessSectionRow` 的 reasoning 相关 props**

在 `src/renderer/src/components/chat/message-timeline-process.tsx` 的 `ProcessSectionRow`（:139），删除 `reasoningDurationMs` 和 `singleReasoningSection` props，以及相关的内部计算。

将 props 类型：
```ts
export function ProcessSectionRow({
  section,
  processing,
  reasoningDurationMs,
  singleReasoningSection,
  viewportRef,
  nowMs
}: {
  section: ProcessSection
  processing: boolean
  reasoningDurationMs?: number
  singleReasoningSection: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  nowMs?: number
}): ReactElement {
```

改为：
```ts
export function ProcessSectionRow({
  section,
  processing,
  viewportRef,
  nowMs
}: {
  section: ProcessSection
  processing: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  nowMs?: number
}): ReactElement {
```

然后在函数体内（约 :181），找到 `describeProcessSection` 的调用：
```ts
  const title = describeProcessSection(section, t, {
    processing,
    reasoningDurationMs,
    singleReasoningSection
  })
```
改为：
```ts
  const title = describeProcessSection(section, t, { processing })
```

- [ ] **Step 3: 删 `isProcessSectionActive` 中 reasoning 依赖（保留函数，但 reasoning 永不命中）**

`isProcessSectionActive`（:106-117）里有 `section.kind === 'reasoning'` 分支。由于 reasoning section 不再生成，该分支永不命中，可保留（无害）也可删。**保留**以减少改动面，不删。

- [ ] **Step 4: 更新 `MessageTimeline.tsx` 调用点**

在 `src/renderer/src/components/chat/MessageTimeline.tsx`，`MessageTurn` 内有 `reasoningSectionCount` 计算（:502-505）和 `ProcessSectionRow` 调用（:558-569）传了 `reasoningDurationMs`/`singleReasoningSection`。

删除 `reasoningSectionCount`（:502-505）：
```ts
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
```

更新 `ProcessSectionRow` 调用（:558-569），删除两个 props：
```ts
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                  nowMs={nowMs}
                />
```
改为：
```ts
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  viewportRef={viewportRef}
                  nowMs={nowMs}
                />
```

- [ ] **Step 5: 类型检查确认无残留引用**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无 error（若报 `reasoningDurationMs`/`singleReasoningSection`/`thoughtFor` 等未定义，按报错定位清除）

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/chat/message-timeline-process.tsx src/renderer/src/components/chat/MessageTimeline.tsx
git commit -m "refactor(timeline): drop reasoning branches from describeProcessSection/ProcessSectionRow"
```

---

## Task 5: 改造 `WorkMetaRow` 消费 `TurnTimerState`

**Files:**
- Modify: `src/renderer/src/components/chat/message-timeline-cards.tsx:323-394`（`WorkMetaRow`）
- Modify: `src/renderer/src/components/chat/MessageTimeline.tsx:545-556`（调用点）

- [ ] **Step 1: 重写 `WorkMetaRow`**

在 `src/renderer/src/components/chat/message-timeline-cards.tsx`，替换整个 `WorkMetaRow`（:322-394）。

替换为：
```ts
import type { TurnTimerState } from './turn-timer'

/** Turn-level work-process summary. Details stay collapsed until the user opens them. */
export function WorkMetaRow({
  timer,
  stepCount,
  expanded,
  onToggle,
  collapsible = true
}: {
  timer: TurnTimerState
  stepCount: number
  expanded: boolean
  onToggle: () => void
  collapsible?: boolean
}): ReactElement {
  const { t } = useTranslation('common')

  // THINKING_WAIT: 动画 + 无秒数，不可展开。
  // 其余态：标签 + 秒数（若有），done 态可展开。
  const showSeconds = typeof timer.displayMs === 'number'
  const labelText = showSeconds
    ? t(timer.labelKey, { duration: formatDuration(timer.displayMs as number) })
    : t('thinkingNow')
  const interactive = collapsible && timer.phase === 'done' && stepCount > 0

  const content = (
    <>
      <span className={`tabular-nums ${timer.phase !== 'done' ? 'ds-shiny-text' : ''}`}>{labelText}</span>
      {interactive ? (
        expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
        ) : (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
            strokeWidth={1.8}
          />
        )
      ) : null}
    </>
  )

  if (!interactive) {
    return (
      <div className="flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[15px] font-medium text-ds-muted">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[15px] font-medium text-ds-muted transition hover:opacity-85"
    >
      {content}
    </button>
  )
}
```

**注意 import：** 文件顶部已有 `import { formatDuration } from './message-timeline-tools'`（:18），复用。新增 `import type { TurnTimerState } from './turn-timer'` 加到顶部 import 区。

- [ ] **Step 2: 更新 `MessageTimeline.tsx` 中 `WorkMetaRow` 调用点**

在 `src/renderer/src/components/chat/MessageTimeline.tsx` 的 `MessageTurn`（:420）里，需要：先调 `deriveTurnTimer` 得到 timer，再传给 `WorkMetaRow`。

先在文件顶部加 import（:14 附近的 chat 模块 import 区）：
```ts
import { deriveTurnTimer } from './turn-timer'
```

然后在 `MessageTurn` 内，找到 `durationMs`/`reasoningDurationMs` 的计算（:319-331 区域，由父组件传入）。这些是从 props 传入的，需要在 `MessageTurn` 签名里保留 `durationMs`/`reasoningDurationMs` 作为输入，但用它们派生 timer。

实际上 `durationMs`/`reasoningDurationMs` 是 `MessageTurn` 的 props（:439-440）。在组件体内（:528 `hasProcess` 附近）加 timer 派生：

```ts
  const turnTimer = useMemo(
    () =>
      deriveTurnTimer({
        isProcessing,
        hasLiveReasoning: !!liveReasoning.trim() || !!liveThink.trim(),
        hasLiveAssistant: !!liveContent.trim() || assistantContentBlocks.length > 0,
        reasoningStartedAt: reasoningFirst,
        turnStartedAt: startedAt,
        recordedDurationMs: durationMs,
        nowMs: nowMs ?? Date.now()
      }),
    [isProcessing, liveReasoning, liveThink, liveContent, assistantContentBlocks.length, reasoningFirst, startedAt, durationMs, nowMs]
  )
```

其中 `reasoningFirst`/`startedAt`/`liveThink`/`liveContent` 已在该作用域存在（见 :326-328、:467）。需确认 `reasoningFirst`/`startedAt` 变量名 —— 它们在 `MessageTimeline` 顶层组件（:319-327）计算后传入 `MessageTurn` 作为 props（:356-357 传 `durationMs`/`reasoningDurationMs`，但 `startedAt`/`reasoningFirst` 没传入）。**因此需要扩展 `MessageTurn` 的 props** 或在父层算好 timer 传入。

**为减少 prop 透传，改为在父组件 `MessageTimeline` 内算 timer，传 `turnTimer` prop 进 `MessageTurn`。**

修订 `MessageTurn` props：删 `durationMs`/`reasoningDurationMs`，加 `turnTimer: TurnTimerState`。父组件 `MessageTimeline`（:315-368 的 map 内）计算 timer：

```ts
          const turnTimer = deriveTurnTimer({
            isProcessing: (busy && isLatestTurn) || turnPending || hasLiveStream,
            hasLiveReasoning: isLatestTurn && (!!liveReasoning.trim() || !!splitThink(live).think.trim()),
            hasLiveAssistant:
              isLatestTurn
                ? !!live.trim() || !!splitThink(live).content.trim()
                : assistantHasContent(turn.blocks),
            reasoningStartedAt: reasoningFirst,
            turnStartedAt: startedAt,
            recordedDurationMs: durationMs,
            nowMs: tickNow
          })
```

（`splitThink` 已 import 于 :26；`assistantHasContent` 需新增小 helper：判断 turn.blocks 里是否有非空 assistant content。）

在 `MessageTimeline.tsx` 顶层（`groupTurns` 附近）加 helper：
```ts
function assistantHasContent(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind !== 'assistant') return false
    const split = splitThink(block.text)
    return split.content.trim().length > 0
  })
}
```

并把 `WorkMetaRow` 调用（:545-556）从：
```tsx
          <WorkMetaRow
            processing={isProcessing}
            stepCount={workProcessBlocks.length}
            durationMs={durationMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            collapsible={!hasProcessError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
```
改为：
```tsx
          <WorkMetaRow
            timer={turnTimer}
            stepCount={workProcessBlocks.length}
            expanded={workExpanded}
            collapsible={!hasProcessError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
```

同时更新 `MessageTurn` 签名（:434-449）：删 `durationMs?: number` 和 `reasoningDurationMs?: number`，加 `turnTimer: TurnTimerState`。删 `MemoMessageTurn` 比较里的对应项（:665-666），加 `prev.turnTimer === next.turnTimer`。

底部无 user block 的 live turn 分支（:390-413）也需同步：它直接渲染 `MemoMessageTurn`，传了 `durationMs`/`reasoningDurationMs`，改为传 `turnTimer`（在该处用 `currentTurnUserId` 数据调 `deriveTurnTimer`）。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无 error

- [ ] **Step 4: 运行全部相关测试**

Run: `npx vitest run src/renderer/src/components/chat/`
Expected: PASS（turn-timer + group-process-sections + 其他既有测试不破坏）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/chat/message-timeline-cards.tsx src/renderer/src/components/chat/MessageTimeline.tsx
git commit -m "feat(timeline): WorkMetaRow consumes TurnTimerState (single continuous timer, no thinking duration)"
```

---

## Task 6: 清理残留 `reasoningDurationMs` 传递与验证

**Files:**
- Modify: `src/renderer/src/components/chat/MessageTimeline.tsx`（残留的 `reasoningDurationMs` 计算与传递 :326-331,357,563,404-410）

- [ ] **Step 1: 删 `MessageTimeline` 中不再使用的 `reasoningDurationMs` 计算**

在 `src/renderer/src/components/chat/MessageTimeline.tsx` 的 map 内（:326-331），删除 `reasoningFirst`/`reasoningLast`/`reasoningDurationMs` 的计算（`reasoningFirst` 若 Task 5 的 timer 派生仍用到则保留 `reasoningFirst`，只删 `reasoningDurationMs` 和 `reasoningLast`）。

**注意：** Task 5 的 timer 派生用了 `reasoningStartedAt: reasoningFirst`，所以 `reasoningFirst`（:326）保留；删 `reasoningLast`（:327）和 `reasoningDurationMs`（:328-331）。

将（:326-331）：
```ts
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? turnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
```
改为：
```ts
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
```

- [ ] **Step 2: 删 `useTimelineStores` 中不再使用的 `turnReasoningLastAtByUserId`（可选）**

`turnReasoningLastAtByUserId` 在 `use-timeline-stores.ts` 仍被订阅。若全局已无消费者（grep 确认），可删该 selector 减少不必要渲染。

Run: `grep -rn "turnReasoningLastAtByUserId" src/renderer/src/components/ src/renderer/src/store/`
Expected: 仅剩 `use-timeline-stores.ts`（订阅）和 `chat-store-runtime.ts`（写入）。**保留 store 写入**（数据无害），**删 use-timeline-stores 的订阅 + TimelineStores 类型字段**，避免无用渲染。

在 `src/renderer/src/components/chat/use-timeline-stores.ts`：
- 删 `turnReasoningLastAtByUserId: Record<string, number>`（:23 类型）
- 删 `const turnReasoningLastAtByUserId = useChatStore((s) => s.turnReasoningLastAtByUserId)`（:39）
- 删 return 对象里的 `turnReasoningLastAtByUserId`（:60）

在 `src/renderer/src/components/chat/MessageTimeline.tsx`：
- 删解构里的 `turnReasoningLastAtByUserId`（:171）

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer/src/`
Expected: 无 error，所有测试 PASS

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/chat/MessageTimeline.tsx src/renderer/src/components/chat/use-timeline-stores.ts
git commit -m "refactor(timeline): remove unused reasoningDurationMs/turnReasoningLastAtByUserId subscription"
```

---

## Task 7: 端到端验证与构建

**Files:** 无（仅验证）

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无 error

- [ ] **Step 2: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: ESLint（若配置）**

Run: `npx eslint src/renderer/src/components/chat/turn-timer.ts src/renderer/src/components/chat/message-timeline-cards.tsx src/renderer/src/components/chat/message-timeline-process.tsx src/renderer/src/components/chat/MessageTimeline.tsx`
Expected: 无 error（warning 可接受）

- [ ] **Step 4: 构建确认**

Run: `npm run build`（或项目的 build 脚本，先查 package.json）
Expected: 构建成功

- [ ] **Step 5: 验收 checklist 自查**

对照 spec 第六节验收标准逐条确认：
- [ ] 一个 turn 全程只看到一个延续时间，无并列「思考了 Xs」
- [ ] 用户点发送后、模型收到任务前，显示 `正在思考…` 且无秒数
- [ ] 第一个 reasoning delta 后，显示 `正在思考 1s` 起计
- [ ] 吐字后标签变 `正在处理 Xs`，秒数延续不归零
- [ ] turn 结束显示 `已处理 Xs >`，展开只看工具，reasoning 不出现
- [ ] 无 reasoning 的 turn 直接进 `正在处理`
- [ ] 单测覆盖四态 + 秒数延续 + 跳过思考兜底

- [ ] **Step 6: 最终提交（若有残留改动）**

```bash
git add -A
git commit -m "chore(timeline): turn timer state machine — final verification"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 四态状态机 → Task 1
- ✅ 计时器从首个 reasoning delta 起跳、不重置 → Task 1（THINKING_REASON/PROCESSING 共用 reasoningStartedAt）
- ✅ THINKING_WAIT 无秒数 → Task 1（displayMs undefined）
- ✅ 删 `· 思考了 Xs` 后缀 → Task 5（WorkMetaRow 重写，无 reasoningDurationMs）
- ✅ reasoning 文本永不渲染 → Task 3（groupProcessSections 过滤）+ Task 4（describeProcessSection 删分支）
- ✅ i18n 增删 → Task 2
- ✅ 无 reasoning 直接吐字兜底 → Task 1（PROCESSING fallback turnStartedAt）
- ✅ 与 L2 工具分组正交 → 不涉及 tool-category，无冲突

**2. Placeholder scan:** 无 TBD/TODO。Task 5 Step 2 较复杂但给了完整代码与 helper。

**3. Type consistency:**
- `TurnTimerState.labelKey` 在 Task 1 定义为 4 个字面量联合，Task 5 `t(timer.labelKey, ...)` 与 Task 2 新增的 i18n 键一致 ✅
- `deriveTurnTimer` 入参 `reasoningStartedAt`/`turnStartedAt`/`recordedDurationMs`/`nowMs` 在 Task 1 定义，Task 5 调用时映射 `reasoningFirst`/`startedAt`/`durationMs`/`tickNow` ✅
- `WorkMetaRow` 入参 Task 5 改为 `{timer, stepCount, expanded, onToggle, collapsible}`，调用点同步 ✅
- `describeProcessSection` opts 签名 Task 4 简化为 `{processing}`，调用点同步 ✅

**风险点（已知，已在 Task 中标注）：**
- Task 5 的 prop 透传重构（durationMs/reasoningDurationMs → turnTimer）波及 `MessageTurn` 签名、`MemoMessageTurn` 比较、底部 live-turn 分支三处，需同步改全。
- Task 2 删 `thinkingLabel` 前已 grep 确认仅 2 处消费（均在 Task 4 删除范围内）。
