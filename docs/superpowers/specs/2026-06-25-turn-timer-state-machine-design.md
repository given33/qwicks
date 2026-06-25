# Turn 时间状态机（思考→处理→已处理）— 设计文档

- 日期: 2026-06-25
- 目标: 把模型回复的「思考/处理」时间显示从**并列双计时**（数学上是包含关系却被误读为累加）改造为**单一延续计时器 + 四态状态机**，并对标 Codex 的 `Thinking / Working / Ready` 范式彻底隐藏模型内部思考内容。

---

## 一、问题与动机

### 1.1 现状的两个时间点（错误语义）

当前一个 turn（一问一答）的时间显示散落在两处，且语义有重叠：

1. **`WorkMetaRow`**（`message-timeline-cards.tsx:323`）—— turn 级总览：
   - 主标签：`处理中 Xs`（运行时）/ `已处理 Xs`（结束时）
   - 后缀：`· 思考了 Xs`（`showThoughtSuffix`，仅结束时、≥1s 才显示，`:350-353`）

2. **`describeProcessSection`**（`message-timeline-process.tsx:700`）—— reasoning 分组标题：
   - `思考中…` / `思考了 Xs` / `思考（N 步）`

### 1.2 根本缺陷

- **计时是包含关系，不是累加关系。** `turnStartedAtByUserId` 在 runtime 收到任务时就打点（`chat-store-runtime.ts:621`），`turnReasoningFirstAtByUserId` 要等第一个 reasoning delta 才打点（`:684`）。所以「已处理时长」**本身就完整包含了思考阶段**。当前并列显示「已处理 12s · 思考了 8s」，用户会误解为两段独立耗时（12+8=20s），实际是 8s ⊂ 12s。
- **思考内容被渲染。** reasoning 文本（`<think>` / `agent_reasoning` delta）在展开折叠条后会完整显示，暴露模型内部推理过程，不符合「结果导向」的设计哲学。

### 1.3 Codex 的范式（已调研确认）

经查 Codex CLI（`codex-rs/tui`）源码与官方文档：
- status line 的 `run-state` 只有**三态**：`Ready` / `Working` / `Thinking`（[JD Hodges 博客](https://www.jdhodges.com/blog/codex-usage-cli-status-line/)）。
- reasoning 被 `ReasoningSummaryCell::new("thinking", content, elapsed_seconds, ...)` 捕获，但 live TUI 默认折叠/隐藏（issue [#16801](https://github.com/openai/codex/issues/16801)）。
- active turn 由 `turn_runtime.rs` 维护**单一 elapsed 计时器**（issue [#19984](https://github.com/openai/codex/issues/19984)），不拆思考/处理两段。

### 1.4 用户已确认的意图（逐条锁定）

| 决策点 | 用户决定 |
|---|---|
| 折叠粒度 | **per-turn**（保留现有架构，不做会话级全局入口） |
| 思考时间去除范围 | **两处全去**（WorkMetaRow 后缀 + reasoning 分组标题），且**连思考文本内容也完全隐藏**（展开折叠条也不渲染 reasoning） |
| 吐字后的中间回复 | 模型「思考完开始吐回复文字」这一段**要显示**（流式可见） |
| 计时语义 | 思考只是处理全过程的开头一段；状态机是 `思考 → 处理（含后续所有思考）→ 已处理`，不是 `思考 \| 处理` 并列 |
| 秒数起跳信号 | **第一个 `agent_reasoning` delta**（模型真正开始深度思考的时刻），从 1s 起计 |
| 用户发送→模型收到之间 | 显示 `正在思考…` 但**不显示秒数**（本地乐观渲染期，模型还没真正收到任务） |
| 无 reasoning 的 turn | 跳过 THINKING，直接进 PROCESSING |
| 总计时是否重置 | **永不重置**；THINKING→PROCESSING 只换标签，秒数延续 |

---

## 二、四态状态机

### 2.1 状态定义

单一计时器从「第一个 reasoning delta」起跳，全程不重置。根据 turn 生命周期派生四个显示态：

```
用户点发送            第一个reasoning delta        首个文字delta        turn结束
    │                        │                         │                  │
    │   乐观渲染期            │                         │                  │
    │   (本地,模型还没收到)   ▼                         ▼                  ▼
    ▼
[THINKING_WAIT]      [THINKING_REASON]        [PROCESSING]        [DONE]
 正在思考…             正在思考 1s 2s 3s…        正在处理 Xs          已处理 Xs>
 动画,无秒数           有秒数(从1s起)            延续秒数,换标签       总时长,折叠
 ❌无思考内容          ❌无思考内容              显回复+工具折叠       展开只看工具
```

| 状态 | 进入触发 | 标签 | 秒数 | 内容 |
|---|---|---|---|---|
| **THINKING_WAIT** | 用户点发送（本地乐观渲染） | `正在思考…` | ❌ 无 | 无 |
| **THINKING_REASON** | 第一个 `agent_reasoning` delta 到达（`liveReasoning` 首次非空） | `正在思考 Xs` | ✅ 从此起跳（1s 起） | 无（思考文本永不渲染） |
| **PROCESSING** | 第一个 assistant 文字 delta（`liveAssistant` 首次非空） | `正在处理 Xs` | ✅ 延续（不重置） | 流式回复 + 工具折叠 |
| **DONE** | turn 结束（`busy=false` / `turn_completed`） | `已处理 Xs >` | ✅ 总时长 | 折叠，展开看工具 |

### 2.2 三条铁律

1. **计时器从第一个 reasoning delta 起跳，全程不重置。** THINKING_REASON→PROCESSING→DONE 共用同一个计时起点。
2. **`· 思考了 Xs` 后缀彻底删除；reasoning 文本永不渲染**（连展开折叠条都不显示）。
3. **THINKING_WAIT 段只显示动画无秒数**——因为这是本地乐观渲染期，模型还没真正收到任务。

### 2.3 状态转移表

| 当前态 | 事件 | 下一态 | 备注 |
|---|---|---|---|
| (空闲) | 用户点发送 | THINKING_WAIT | 乐观渲染，无秒数 |
| (空闲) | 用户点发送 + 模型直接吐字（无 reasoning） | PROCESSING | 跳过 THINKING |
| THINKING_WAIT | 第一个 reasoning delta | THINKING_REASON | 秒数从 1s 起 |
| THINKING_WAIT | 第一个 assistant 文字 delta（跳过思考） | PROCESSING | 直接进入处理 |
| THINKING_REASON | 第一个 assistant 文字 delta | PROCESSING | **不重置计时**，秒数延续 |
| THINKING_REASON | turn 结束 | DONE | 极短 turn |
| PROCESSING | 第一个 assistant 文字 delta | PROCESSING | 自环（已在此态） |
| PROCESSING | turn 结束 | DONE | |
| DONE | （终态） | DONE | |

**注意：** 一旦进入 PROCESSING，后续即使再出现 reasoning delta，**状态不退回 THINKING**——思考被吸收进处理总时长。

---

## 三、数据流与计时点

### 3.1 复用现有 store 数据（几乎不动 store）

| 状态需求 | 数据来源 | 是否已有 |
|---|---|---|
| THINKING_WAIT 判定 | `busy && !liveReasoning.trim() && !liveAssistant.trim()` | ✅ 已有 |
| THINKING_REASON 判定 | `busy && liveReasoning.trim() && !liveAssistant.trim()` | ✅ 已有 |
| PROCESSING 判定 | `busy && liveAssistant.trim()` | ✅ 已有 |
| DONE 判定 | `!busy` | ✅ 已有 |
| 计时起点（秒数起跳） | `turnReasoningFirstAtByUserId[userId]` | ✅ 已有（首个 reasoning delta 时刻，`:684`） |
| DONE 总时长 | `turnDurationByUserId[userId]`（已记录）或 `now - turnReasoningFirstAt` | ✅ 已有 |
| 跳过 THINKING（无 reasoning 直接吐字） | PROCESSING 态但 `turnReasoningFirstAt` 为空 → 回退用 `turnStartedAtByUserId` | ✅ 已有（兜底） |

### 3.2 计时计算（DONE 态的兜底）

```
displayMs =
  recordedDuration  // turnDurationByUserId，turn 结束时已固化
  ?? (turnReasoningFirstAt != null ? now - turnReasoningFirstAt : undefined)
  ?? (turnStartedAt != null ? now - turnStartedAt : undefined)  // 无 reasoning 的兜底
```

- THINKING_REASON / PROCESSING / DONE 优先用 `turnReasoningFirstAt` 作起点。
- 无 reasoning 的 turn（直接吐字）用 `turnStartedAt` 兜底。
- DONE 优先用已固化的 `turnDurationByUserId`，避免历史 turn 的计时漂移。

### 3.3 live reason 单独 turn（无 user block）

`MessageTimeline` 末尾有个「无 user block 的 live turn」渲染分支（`MessageTimeline.tsx:390-413`），用 `currentTurnUserId` 取数据，同样适用上述派生逻辑，无需特殊处理。

---

## 四、实现方案

### 4.1 新增纯函数状态机 `turn-timer.ts`

新建 `src/renderer/src/components/chat/turn-timer.ts`，与 `message-timeline-turns.ts` 同级。纯函数 + 类型，无 React 依赖，易单测。

```ts
export type TurnPhase = 'idle' | 'thinking_wait' | 'thinking_reason' | 'processing' | 'done'

export type TurnTimerInput = {
  isProcessing: boolean          // busy || turnPending || hasLiveStream
  hasLiveReasoning: boolean      // !!liveReasoning.trim()
  hasLiveAssistant: boolean      // !!liveAssistant.trim()
  reasoningStartedAt?: number    // turnReasoningFirstAtByUserId[userId]
  turnStartedAt?: number         // turnStartedAtByUserId[userId]（无 reasoning 兜底）
  recordedDurationMs?: number    // turnDurationByUserId[userId]（DONE 固化值）
  nowMs: number                  // 1s tick
}

export type TurnTimerState = {
  phase: TurnPhase
  /** 仅 thinking_wait 为 undefined（不显示秒数）；其余态有值 */
  displayMs?: number
  /** 是否可展开折叠条（只有 done 态、且有工具步骤时为 true） */
  labelKey: 'thinkingNow' | 'thinkingWithSeconds' | 'processing' | 'processed'
}

export function deriveTurnTimer(input: TurnTimerInput): TurnTimerState
```

**派生逻辑：**

```text
if (!isProcessing):
    phase = 'done'
    displayMs = recordedDurationMs ?? (reasoningStartedAt ? now-reasoningStartedAt : turnStartedAt ? now-turnStartedAt : undefined)
    labelKey = 'processed'
elif (hasLiveAssistant):
    phase = 'processing'
    displayMs = reasoningStartedAt ? now-reasoningStartedAt : turnStartedAt ? now-turnStartedAt : undefined
    labelKey = 'processing'  // 复用现有 processing 键,带秒数变体
elif (hasLiveReasoning):
    phase = 'thinking_reason'
    displayMs = reasoningStartedAt ? now-reasoningStartedAt : undefined
    labelKey = 'thinkingWithSeconds'
else:
    phase = 'thinking_wait'
    displayMs = undefined   // ← 关键:无秒数
    labelKey = 'thinkingNow'
```

### 4.2 轻量 hook（可选封装）

若需要复用，加一个 `useTurnTimer(userId)` hook 订阅 store，但 MVP 阶段可直接在 `MessageTurn` 内内联调用 `deriveTurnTimer`，避免过度抽象。

### 4.3 改造 `WorkMetaRow`（`message-timeline-cards.tsx:323`）

**删除：**
- `reasoningDurationMs` prop 及所有 `showThoughtSuffix` / `· 思考了 Xs` 逻辑（`:350-362`）。

**改为消费 `TurnTimerState`：**
- 入参从 `{processing, stepCount, durationMs, reasoningDurationMs, expanded, ...}` 简化为 `{timer: TurnTimerState, stepCount, expanded, collapsible, onToggle}`。
- 标签渲染：
  - `thinking_wait`：`<AnimatedWorkLogo/>` + `正在思考…`，无秒数，无 chevron（不可展开）。
  - `thinking_reason`：`<AnimatedWorkLogo/>` + `正在思考 {formatDuration(displayMs)}`，有秒数，无 chevron。
  - `processing`：`<AnimatedWorkLogo/>` + `正在处理 {formatDuration(displayMs)}`，秒数延续，有 chevron（若有工具）。
  - `done`：`已处理 {formatDuration(displayMs)} >`，折叠条。

### 4.4 彻底隐藏 reasoning 内容

**`groupProcessSections`（`message-timeline-process.tsx:45`）：**
- 过滤掉 `kind === 'reasoning'` 的 block，不再产出 reasoning section。这样展开折叠条时**只看得到工具/输出步骤，思考文本永不出现**。

**`describeProcessSection`（`:700`）：**
- 删除 reasoning 分支（`:709-723`），因为 reasoning section 不再生成。
- 移除对 `reasoningDurationMs` / `singleReasoningSection` 的依赖（这些 prop 也不再需要）。

**`ProcessSectionRow`（`:139`）：**
- 移除 `reasoningDurationMs` / `singleReasoningSection` props。

**`MessageTurn`（`MessageTimeline.tsx:420`）：**
- 移除 `reasoningDurationMs` 的计算与传递（`:326-331`、`:357`、`:563`）。

### 4.5 i18n 改动

| key | zh | en | 状态 |
|---|---|---|---|
| `thinkingNow` | `思考中…` | `Thinking…` | ✅ 复用（THINKING_WAIT） |
| `thinkingWithSeconds` | `思考中 {{duration}}` | `Thinking {{duration}}` | 🆕 新增（THINKING_REASON） |
| `processing` | `处理中 {{duration}}` | `Processing {{duration}}` | ✏️ 改为带 duration 变体（PROCESSING） |
| `processed` | `已处理 {{duration}}` | `Processed {{duration}}` | ✏️ 改为带 duration 变体（DONE） |
| `thoughtFor` | （删除） | （删除） | ❌ 删除 |
| `thoughtSteps` | （删除） | （删除） | ❌ 删除 |
| `thinkingLabel` | （删除） | （删除） | ❌ 删除（见下） |

**i18n 调用点已全量核实（grep 结果）：**
- `t('processing')` / `t('processed')` 现以**字符串拼接**方式用（`${t('processing')} ${formatDuration(...)}`），4 个调用点全在 `WorkMetaRow`（`:344,345,347,348`），本次正好重写该组件，改为 `{{duration}}` 变体不破坏外部。
- `thinkingLabel` 有 2 个调用点：`:722`（reasoning section，本次删除）和 `:1222`（`describeProcessBlock` 的 reasoning 分支，reasoning block 不再渲染，分支可删）。两处本次都会移除，故 `thinkingLabel` **可安全删除**。
- `t('processed')` 另有 1 个兜底调用点在 `:1259`（`describeProcessBlock` 末尾 fallback）。`processed` 键需**保留**（改为带 duration 变体后，此处改用纯词 `processedWord` 新键，或保留无参数形式 `processed` 同时新增 `processedWithDuration`）。
- **结论：** 为避免破坏 `:1259` 兜底，拆成两个键：保留无参 `processed`（兜底用），新增 `processedWithDuration`（带 `{{duration}}`，WorkMetaRow 用）。`processing` 同理拆 `processing` / `processingWithDuration`。

**修正后的 i18n 表：**

| key | zh | en | 状态 |
|---|---|---|---|
| `thinkingNow` | `思考中…` | `Thinking…` | ✅ 复用 |
| `thinkingWithSeconds` | `思考中 {{duration}}` | `Thinking {{duration}}` | 🆕 新增 |
| `processingWithDuration` | `处理中 {{duration}}` | `Processing {{duration}}` | 🆕 新增（保留原 `processing` 无参键给别处） |
| `processedWithDuration` | `已处理 {{duration}}` | `Processed {{duration}}` | 🆕 新增（保留原 `processed` 给 `:1259` 兜底） |
| `thoughtFor` / `thoughtSteps` / `thinkingLabel` | （删除） | （删除） | ❌ 删除 |

---

## 五、影响面与测试

### 5.1 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/renderer/src/components/chat/turn-timer.ts` | 🆕 新建：状态机纯函数 |
| `src/renderer/src/components/chat/turn-timer.test.ts` | 🆕 新建：状态机单测 |
| `src/renderer/src/components/chat/message-timeline-cards.tsx` | ✏️ 改造 WorkMetaRow（删 reasoningDuration，消费 timer） |
| `src/renderer/src/components/chat/message-timeline-process.tsx` | ✏️ groupProcessSections 过滤 reasoning；删 describeProcessSection reasoning 分支 |
| `src/renderer/src/components/chat/MessageTimeline.tsx` | ✏️ MessageTurn 内联 deriveTurnTimer，删 reasoningDurationMs 传递 |
| `src/renderer/src/locales/zh/common.json` | ✏️ 加 thinkingWithSeconds，改 processing/processed，删 thoughtFor/thoughtSteps |
| `src/renderer/src/locales/en/common.json` | ✏️ 同上 |

### 5.2 单测重点（`turn-timer.test.ts`）

1. THINKING_WAIT：`isProcessing && !reasoning && !assistant` → `displayMs === undefined`。
2. THINKING_REASON：首个 reasoning delta → `displayMs = now - reasoningStartedAt`。
3. PROCESSING（从思考进入）：`reasoning` 后 `assistant` 到达 → 秒数延续，**不重置**（用同一 reasoningStartedAt）。
4. PROCESSING（跳过思考）：无 reasoning 直接吐字 → 用 turnStartedAt 兜底。
5. DONE：用 recordedDurationMs。
6. 思考后再次出现 reasoning 不退回 THINKING（PROCESSING 自环）。

### 5.3 与既有设计的关系

- **`2026-06-25-progressive-disclosure-timeline-design.md`（L2 工具分组）：正交。** 那份改 L2 执行流层的工具类型分组，本份改 L1 时间状态机与 reasoning 隐藏。两者独立，可并行/先后实施，互不冲突。
- 现有 `tool-category.ts` 的分类逻辑（L2）不受影响。

### 5.4 风险与回退

- **风险低：** 所有数据已存在于 store，纯显示层语义修正 + 一个新纯函数模块。不改 store schema、不改 runtime 协议。
- **回退：** 若 `processing`/`processed` 改键影响其他调用点，拆成独立键（`processingWithDuration`）即可隔离。搜索 `t('processing')` 全仓调用点确认。

---

## 六、验收标准

- [ ] 一个 turn 全程只看到**一个**延续的时间（思考→处理→已处理），无并列「思考了 Xs」。
- [ ] 用户点发送后、模型收到任务前，显示 `正在思考…` 且**无秒数**。
- [ ] 第一个 reasoning delta 后，显示 `正在思考 1s` 起计。
- [ ] 吐字后标签变 `正在处理 Xs`，秒数**延续**不归零。
- [ ] turn 结束显示 `已处理 Xs >`，点开只能看工具步骤，**reasoning 文本不出现**。
- [ ] 无 reasoning 的 turn 直接进 `正在处理`，不卡在 THINKING。
- [ ] 单测覆盖四态转移 + 秒数延续 + 跳过思考兜底。
