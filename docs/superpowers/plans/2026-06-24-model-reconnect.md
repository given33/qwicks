# 模型请求重连机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模型请求失败时自动重试 5 次(指数退避),重连进度在模型输出区覆盖显示,5 次全失败才报错;错误以纯文字(可折叠)显示在会话内和输出框上方,移除顶部黄色横幅。

**Architecture:** 双层改动。运行时层(`qwicks/src/adapters/model/compat-model-client.ts`)的请求 generator 扩展重试循环,对所有错误(网络/任意 HTTP 状态)重试 5 次,每次 yield 一个 `model_retry` 事件。GUI 层(`chat-store-runtime.ts`)订阅该事件,覆盖模型 live block 显示重连进度,重连成功时计时归零;移除 chat 路由的 `RuntimeBanner`,新增输出框上方的纯文字错误组件。

**Tech Stack:** TypeScript, QWicks runtime(async generator), React/Zustand(渲染端), i18next(文案), vitest(测试)

**Spec:** `docs/superpowers/specs/2026-06-24-model-reconnect-design.md`

---

## File Structure

### 运行时(qwicks 子项目)
- `qwicks/src/adapters/model/compat-model-client.ts` — 扩展请求 generator 的重试循环,新增 `model_retry` 事件
- `qwicks/src/contracts/` 或现有事件契约文件 — 新增 `ModelRetryEvent` 类型(若运行时有独立契约文件)
- `qwicks/tests/adapters/model/compat-model-client.test.ts` — 重试循环单元测试(若不存在则新建)

### GUI 共享层
- `src/shared/qwicks-contract.ts` — 新增 `model_retry` 事件类型 + runtime event 联合类型扩展

### GUI 渲染层
- `src/renderer/src/store/chat-store-runtime.ts` — 处理 `model_retry` 事件,覆盖 live block,重连成功计时归零
- `src/renderer/src/store/chat-store-runtime.test.ts` — store 测试(若不存在则新建/扩展)
- `src/renderer/src/components/Workbench.tsx` — 移除 chat 路由的 `RuntimeBanner` 渲染
- `src/renderer/src/components/chat/MessageTimeline.tsx` — 输出框上方错误文字组件渲染
- `src/renderer/src/lib/format-runtime-error.ts` — 复用(可能补充重试文案)
- `src/renderer/src/locales/en/common.json` — 英文重连/重试文案
- `src/renderer/src/locales/zh/common.json` — 中文重连/重试文案

---

## Task 1: 运行时 — 扩展请求重试循环并发出 model_retry 事件

**Files:**
- Modify: `qwicks/src/adapters/model/compat-model-client.ts:260-338`
- Test: `qwicks/tests/adapters/model/compat-model-client.test.ts`

**背景:** 现有代码在第 260 行调用 `postChatCompletion`,第 267-277 行已有针对 502/503/504 的 `MAX_TRANSIENT_RETRIES` 重试。本任务把重试范围扩展到**所有错误**(网络错误 + 任意 HTTP 状态码),统一 5 次指数退避,并在每次重试前 yield 一个 `model_retry` 事件。

- [ ] **Step 1: 定义重试常量**

在 `compat-model-client.ts` 顶部常量区(搜索 `MAX_TRANSIENT_RETRIES`)附近添加:

```typescript
/**
 * 所有模型请求错误(网络错误 + 任意 HTTP 状态码)统一重试的次数。
 * 指数退避:1s → 2s → 4s → 8s → 16s,总等待上限约 31s。
 * 每次 retry 前 emit 一个 model_retry 事件,供 GUI 显示重连进度。
 */
const MODEL_CONNECT_MAX_RETRIES = 5
const MODEL_CONNECT_RETRY_BASE_MS = 1_000
```

- [ ] **Step 2: 写失败测试 — 网络错误重试 5 次**

在 `qwicks/tests/adapters/model/compat-model-client.test.ts`(若文件不存在则新建)添加:

```typescript
import { describe, it, expect, vi } from 'vitest'
// 导入被测的 streamChat / 请求入口 + 测试用的 mock fetch 工厂

describe('compat-model-client connect retries', () => {
  it('retries 5 times on network errors before yielding a final error', async () => {
    // fetch 每次都 reject (network error)
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const client = createCompatModelClientForTest({ fetchImpl })
    const events: any[] = []
    for await (const ev of client.streamChat({ /* 最小 request */ } as any)) {
      events.push(ev)
    }
    const retries = events.filter((e) => e.kind === 'model_retry')
    const errors = events.filter((e) => e.kind === 'error')
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(retries).toHaveLength(5)
    expect(retries[0]).toMatchObject({ kind: 'model_retry', attempt: 1, maxAttempts: 5 })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/model request failed/i)
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npm --prefix qwicks run test -- tests/adapters/model/compat-model-client.test.ts`
Expected: FAIL(尚未实现 model_retry 事件 / 5 次重试)

- [ ] **Step 4: 实现重试循环**

把 `compat-model-client.ts:260-338` 的请求+重试段重构为统一的连接重试循环。核心改动:把现有的 `MAX_TRANSIENT_RETRIES` 循环替换为覆盖所有错误的 `MODEL_CONNECT_MAX_RETRIES` 循环,每次重试前 `yield { kind: 'model_retry', attempt, maxAttempts, reason }`。

```typescript
// 替换原 260 行起的请求+重试逻辑:
let result = await this.postChatCompletion(url, headers, body, request.abortSignal)
let lastError: { message: string; code?: string } | null = null

for (let attempt = 0; attempt < MODEL_CONNECT_MAX_RETRIES; attempt += 1) {
  // 网络错误:postChatCompletion 返回 { kind: 'error' }
  if (result.kind === 'error') {
    lastError = { message: result.message }
  } else if (result.response.ok) {
    break // 成功,跳出重试循环
  } else {
    // HTTP 错误:记录分类错误,继续重试
    const text = await result.response.text().catch(() => '')
    const classified = await this.classifyHttpError(result.response.status, text)
    this.logHttpFailure({ url, status: result.response.status, body: text, endpointFormat, configuredEndpointFormat, model: requestModel })
    lastError = { message: classified.message, code: classified.code }
  }

  // 还有重试机会 → 退避 + emit model_retry 事件
  if (attempt < MODEL_CONNECT_MAX_RETRIES - 1) {
    yield {
      kind: 'model_retry',
      attempt: attempt + 1,
      maxAttempts: MODEL_CONNECT_MAX_RETRIES,
      reason: lastError.message
    }
    const aborted = await sleepWithAbort(MODEL_CONNECT_RETRY_BASE_MS * 2 ** attempt, request.abortSignal)
    if (aborted || request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted during reconnect backoff' }
      return
    }
    result = await this.postChatCompletion(url, headers, body, request.abortSignal)
  }
}

// 5 次全失败
if (result.kind === 'error') {
  yield { kind: 'error', message: result.message }
  return
}
if (!result.response.ok) {
  yield { kind: 'error', message: lastError?.message ?? 'model request failed', ...(lastError?.code ? { code: lastError.code } : {}) }
  return
}

// 成功 → 继续原有的流处理逻辑(response.body 解析等,原 339 行之后保持不变)
const response = result.response
```

注意:原 285-338 行的 `shouldRetryWithoutStreamUsage`(stream-usage 兼容重试)逻辑保留,接到上面成功分支之后。

- [ ] **Step 5: 写测试 — HTTP 404 也重试**

```typescript
it('retries 5 times on HTTP 404 before yielding classified error', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response('Not Found', { status: 404 })
  )
  const client = createCompatModelClientForTest({ fetchImpl })
  const events: any[] = []
  for await (const ev of client.streamChat({} as any)) events.push(ev)
  const retries = events.filter((e) => e.kind === 'model_retry')
  expect(fetchImpl).toHaveBeenCalledTimes(5)
  expect(retries).toHaveLength(5)
  expect(events.at(-1)).toMatchObject({ kind: 'error', code: 'http_404' })
})
```

- [ ] **Step 6: 写测试 — 重连成功后继续正常输出**

```typescript
it('recovers when a retry succeeds and streams the response', async () => {
  let calls = 0
  const fetchImpl = vi.fn().mockImplementation(() => {
    calls += 1
    if (calls < 3) return Promise.resolve(new Response('err', { status: 500 }))
    // 第 3 次成功 — 返回一个最小合法 SSE 流
    return Promise.resolve(new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  })
  const client = createCompatModelClientForTest({ fetchImpl })
  const events: any[] = []
  for await (const ev of client.streamChat({ stream: true } as any)) events.push(ev)
  const retries = events.filter((e) => e.kind === 'model_retry')
  expect(retries).toHaveLength(2) // 前 2 次失败各 emit 一次
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})
```

- [ ] **Step 7: 运行所有重试测试验证通过**

Run: `npm --prefix qwicks run test -- tests/adapters/model/compat-model-client.test.ts`
Expected: PASS

- [ ] **Step 8: 运行 qwicks typecheck**

Run: `npm --prefix qwicks run typecheck`
Expected: 无类型错误

- [ ] **Step 9: Commit**

```bash
git add qwicks/src/adapters/model/compat-model-client.ts qwicks/tests/adapters/model/compat-model-client.test.ts
git commit -m "feat(model): retry all request errors 5x with model_retry event

Extend the request generator to retry network errors and any HTTP
status up to 5 times (1s→2s→4s→8s→16s backoff). Emit a model_retry
event before each retry so the GUI can show reconnect progress."
```

---

## Task 2: GUI 共享层 — 定义 model_retry 事件类型

**Files:**
- Modify: `src/shared/qwicks-contract.ts`

**背景:** GUI 通过 `src/shared/qwicks-contract.ts` 定义 runtime 事件类型。需新增 `model_retry` 事件类型并加入 runtime event 联合类型。

- [ ] **Step 1: 找到 runtime 事件类型定义**

搜索 `qwicks-contract.ts` 中现有的 runtime 事件类型(如 `onRuntimeError` 对应的 error 事件、`onGoal` 对应的 goal 事件类型),确认事件载荷的命名模式(`itemId`/`createdAt`/`threadId` 等公共字段)。

Run: 用 Grep 搜索 `kind:` 或 `RuntimeEvent` 在 `src/shared/qwicks-contract.ts` 和 `src/renderer/src/agent/qwicks-runtime.ts`。

- [ ] **Step 2: 定义 ModelRetryEvent 类型**

在 `qwicks-contract.ts` 的事件类型区添加(字段名对齐现有模式):

```typescript
export type ModelRetryEvent = {
  kind: 'model_retry'
  itemId: string
  threadId?: string
  attempt: number
  maxAttempts: number
  reason: string
  createdAt?: string
}
```

并把它加入 runtime 事件的联合类型(如 `CoreRuntimeEvent` / `ThreadEvent` 等,以现有命名为准)。

- [ ] **Step 3: 运行主仓库 typecheck**

Run: `npm run typecheck`
Expected: 无类型错误(可能因下游未消费该事件而无影响)

- [ ] **Step 4: Commit**

```bash
git add src/shared/qwicks-contract.ts
git commit -m "feat(contract): add model_retry runtime event type"
```

---

## Task 3: GUI 渲染层 — 处理 model_retry 事件,覆盖 live block + 计时归零

**Files:**
- Modify: `src/renderer/src/store/chat-store-runtime.ts:1000-1022`(onRuntimeError 附近)
- Modify: `src/renderer/src/agent/qwicks-runtime.ts:993-997`(subscribeThreadEvents 事件分发)
- Test: `src/renderer/src/store/chat-store-runtime.test.ts`

**背景:** `subscribeThreadEvents`(`qwicks-runtime.ts:993`)收到 SSE 事件后调用 sink 的对应方法(`onError`/`onGoal`/`onRuntimeError` 等)。需新增 `onModelRetry` 分支,在 chat store 里覆盖模型 live block。

- [ ] **Step 1: 在 qwicks-runtime.ts 注册 onModelRetry 分发**

读 `src/renderer/src/agent/qwicks-runtime.ts:942-1019`(`subscribeThreadEvents`),在事件分发逻辑里(根据事件 `kind` 路由到 sink 方法),新增:

```typescript
// 在事件分发 switch / if 链中,匹配 kind === 'model_retry'
if (ev.kind === 'model_retry') {
  sink.onModelRetry?.(ev)
}
```

并确保 `RuntimeSink`/`Sink` 类型(定义在 qwicks-runtime.ts 顶部)新增可选的 `onModelRetry` 方法签名。

- [ ] **Step 2: 写失败测试 — model_retry 覆盖 live block**

在 `src/renderer/src/store/chat-store-runtime.test.ts`(若不存在则参照同类 store 测试新建)添加:

```typescript
it('overwrites the live block with reconnect progress on model_retry', () => {
  const { store, sink } = setupChatStoreRuntimeForTest()
  // 模拟有一个活跃 turn,live block 显示"正在思考"
  store.setState({ live: { kind: 'thinking', text: '正在思考...' }, /* ... */ })
  sink.onModelRetry({ kind: 'model_retry', itemId: 'i1', attempt: 2, maxAttempts: 5, reason: 'fetch failed' })
  const state = store.getState()
  expect(state.live).toMatchObject({ kind: 'reconnecting', attempt: 2, maxAttempts: 5 })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `npx vitest run src/renderer/src/store/chat-store-runtime.test.ts`
Expected: FAIL(`onModelRetry` 未实现)

- [ ] **Step 4: 实现 onModelRetry — 覆盖 live block**

在 `chat-store-runtime.ts` 的事件处理对象(与 `onRuntimeError` 同级)添加:

```typescript
onModelRetry: (ev) => {
  if (!isCurrentStream()) return
  set((s) => ({
    ...s,
    live: {
      kind: 'reconnecting',
      attempt: ev.attempt,
      maxAttempts: ev.maxAttempts,
      reason: ev.reason
    }
  }))
},
```

注:`live` 的类型(`ChatLiveBlock` 或类似)需新增 `reconnecting` variant。找到 `live` 的类型定义(可能在 `chat-store-types.ts` 或 store 文件内),添加:

```typescript
// 在 live block 联合类型中新增:
| { kind: 'reconnecting'; attempt: number; maxAttempts: number; reason: string }
```

- [ ] **Step 5: 重连成功时恢复 live block 为 thinking 并计时归零**

找到收到正常 SSE 数据时重置 live block 的逻辑(通常在 `onDeltas`/`onSeq` 等处理函数里,live block 从 thinking/delta 切换处)。在该处确保:当 live block 是 `reconnecting` 时,收到数据 → 切回 thinking 并**重置计时起点**。

定位计时器:`MessageTimeline.tsx:243-249` 的 `turnStartedAtByUserId` 是思考起点。重连成功后需重置该时间戳为 `Date.now()`。

在 `chat-store-runtime.ts` 的数据事件处理里(重置 live 为 thinking 的位置)增加:

```typescript
// 当从 reconnecting 恢复时,重置思考计时起点
if (prevLive?.kind === 'reconnecting') {
  turnStartedAtByUserId[userId] = Date.now()  // 计时归零
}
```

具体变量名以实际代码为准(`turnStartedAtByUserId` 在 MessageTimeline 是本地 state,store 侧可能需要单独记录一个 `reconnectedAt` 时间戳供 UI 读取)。

- [ ] **Step 6: 写测试 — 重连成功后 live 恢复 thinking**

```typescript
it('restores live to thinking after a model_retry succeeds', () => {
  const { store, sink } = setupChatStoreRuntimeForTest()
  store.setState({ live: { kind: 'reconnecting', attempt: 2, maxAttempts: 5, reason: 'x' } })
  // 模拟收到正常的 delta 数据事件
  sink.onDeltas({ /* 最小 delta 事件 */ })
  expect(store.getState().live?.kind).toBe('thinking')  // 或 'delta',以实际为准
})
```

- [ ] **Step 7: 运行 store 测试验证通过**

Run: `npx vitest run src/renderer/src/store/chat-store-runtime.test.ts`
Expected: PASS

- [ ] **Step 8: 运行主仓库 typecheck**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/store/chat-store-runtime.ts src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/agent/qwicks-runtime.ts
git commit -m "feat(chat-store): handle model_retry — overwrite live block, reset timer"
```

---

## Task 4: GUI — live block 渲染 reconnecting 状态

**Files:**
- Modify: `src/renderer/src/components/chat/MessageTimeline.tsx`(live block 渲染段)
- Modify: `src/renderer/src/locales/{en,zh}/common.json`(重连文案)

**背景:** `MessageTimeline.tsx` 渲染 `live` block(思考中、delta 流等)。需新增 `reconnecting` 渲染分支。

- [ ] **Step 1: 添加 i18n 文案**

在 `src/renderer/src/locales/zh/common.json` 添加(找 `runtimeStreamRecovering` 附近):

```json
"modelReconnecting": "正在重连(第 {{attempt}}/{{max}} 次)",
"modelConnectFailed": "模型连接失败(已重试 {{max}} 次)"
```

在 `src/renderer/src/locales/en/common.json` 对应添加:

```json
"modelReconnecting": "Reconnecting (attempt {{attempt}}/{{max}})",
"modelConnectFailed": "Model connection failed (after {{max}} retries)"
```

- [ ] **Step 2: 渲染 reconnecting live block**

在 `MessageTimeline.tsx` 渲染 live block 的位置(搜索 `live?.kind === 'thinking'` 或类似的 live block 渲染),新增分支:

```tsx
{live?.kind === 'reconnecting' && (
  <div className="text-center text-[13px]" style={{ color: '#999' }}>
    {t('common:modelReconnecting', { attempt: live.attempt, max: live.maxAttempts })}
  </div>
)}
```

- [ ] **Step 3: 运行 typecheck + 主仓库 test:ci**

Run: `npm run typecheck && npm run test:ci`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/chat/MessageTimeline.tsx src/renderer/src/locales/en/common.json src/renderer/src/locales/zh/common.json
git commit -m "feat(chat): render reconnecting live block with i18n"
```

---

## Task 5: GUI — 移除 chat 路由的 RuntimeBanner(任务2部分)

**Files:**
- Modify: `src/renderer/src/components/Workbench.tsx:2192-2208, 2532-2534`

**背景:** `renderRuntimeBanner`(`:2192`)在 chat 路由顶部渲染黄色横幅(`:2532`)。移除 chat 路由的渲染(write 路由的 `:2517` 暂保留,因为写作功能将在任务4移除)。

- [ ] **Step 1: 移除 chat 路由的 RuntimeBanner 渲染**

读 `Workbench.tsx:2525-2540`(chat 路由顶部),找到 `renderRuntimeBanner(...)` 或 `<RuntimeBanner />` 的调用并删除该行。注意保留 chat 容器的其他结构。

若 `visibleRuntimeError`/`runtimeConnection` 等状态仅服务于 banner,可一并清理;但若它们还驱动其他 UI,保留状态只删渲染。

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无错误(若有未使用变量警告,清理之)

- [ ] **Step 3: 运行 test:ci**

Run: `npm run test:ci`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Workbench.tsx
git commit -m "refactor(chat): remove top RuntimeBanner from chat route

Errors now surface in-conversation and above the composer, not as a
top banner. (Part of task 2: logs/errors no longer at session top.)"
```

---

## Task 6: GUI — 输出框上方纯文字错误(可折叠详情)

**Files:**
- Create: `src/renderer/src/components/chat/ComposerErrorBar.tsx`
- Modify: `src/renderer/src/components/chat/FloatingComposer.tsx`(或 MessageTimeline 的容器)

**背景:** 5 次失败后,错误需显示在**消息列表和输入框之间**,纯文字灰色无背景,概括行 + 可折叠详情。

- [ ] **Step 1: 创建 ComposerErrorBar 组件**

```tsx
// src/renderer/src/components/chat/ComposerErrorBar.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type ComposerError = {
  summary: string
  detail?: string
  maxAttempts: number
}

export function ComposerErrorBar({ error }: { error: ComposerError | null }) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  if (!error) return null
  return (
    <div className="px-4 py-2.5 text-center text-[13px]" style={{ color: '#999' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 hover:opacity-80"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
      >
        <span>{t('modelConnectFailed', { max: error.maxAttempts })}</span>
        {error.detail && (
          <span className="text-[11px] opacity-70">{expanded ? '▲' : '▼'}</span>
        )}
      </button>
      {expanded && error.detail && (
        <div className="mt-1 text-[12px] opacity-80 whitespace-pre-wrap">{error.detail}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 把 error 状态接入 store**

在 `chat-store-runtime.ts` 的 `onRuntimeError`(`:1000`)处理里,除了现有的 system block,额外设置一个顶层状态字段供 ComposerErrorBar 读取:

```typescript
// 在 onRuntimeError 的 set() 里新增:
composerError: {
  summary: view.summary,
  ...(view.detail ? { detail: view.detail } : {}),
  maxAttempts: MODEL_CONNECT_MAX_RETRIES  // 或从错误事件读取
}
```

并在 store 类型新增 `composerError: ComposerError | null`(默认 null)。

- [ ] **Step 3: 在 composer 容器渲染 ComposerErrorBar**

在 `FloatingComposer.tsx`(或 MessageTimeline + composer 的父容器)里,消息列表和输入框之间插入:

```tsx
<ComposerErrorBar error={composerError} />
```

`composerError` 从 chat store 读取。收到任意新的 turn 开始时清空 `composerError = null`。

- [ ] **Step 4: 写测试 — error 显示与折叠**

在 `chat-store-runtime.test.ts` 添加:

```typescript
it('sets composerError on runtime error after retries', () => {
  const { store, sink } = setupChatStoreRuntimeForTest()
  sink.onRuntimeError({ itemId: 'e1', severity: 'error', /* payload with detail */ })
  expect(store.getState().composerError).toMatchObject({ summary: expect.any(String) })
})
```

- [ ] **Step 5: 运行 typecheck + test:ci**

Run: `npm run typecheck && npm run test:ci`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/ComposerErrorBar.tsx src/renderer/src/components/chat/FloatingComposer.tsx src/renderer/src/store/chat-store-runtime.ts src/renderer/src/store/chat-store-runtime.test.ts
git commit -m "feat(chat): collapsible error bar above composer (post-retry failure)"
```

---

## Task 7: 集成验证 — 手动测试 + 全量门

**Files:** 无(验证步骤)

- [ ] **Step 1: 运行完整测试套件**

Run: `npm --prefix qwicks run test && npm run test:ci`
Expected: 全部通过

- [ ] **Step 2: typecheck 双层**

Run: `npm --prefix qwicks run typecheck && npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: electron-vite 构建成功

- [ ] **Step 4: 手动验证场景**

启动 QWicks,手动制造以下场景验证:
1. **网络错误**:断网/配错 Base URL → 观察气泡从"正在思考"变成"正在重连(第x/5次)",5次后显示错误(会话内 + 输出框上方可折叠)
2. **重连成功**:配置一个会先失败后成功的模拟 → 观察重连成功后气泡恢复"正在思考"且计时归零
3. **顶部无横幅**:确认 chat 路由顶部不再有黄色 RuntimeBanner

- [ ] **Step 5: Commit 最终状态(若有遗漏改动)**

```bash
git add -A
git commit -m "chore: integration verification for model reconnect feature"
```

---

## 自审

**Spec 覆盖检查:**
- ✅ 所有错误重试 5 次(Task 1)
- ✅ model_retry 事件(Task 1 + Task 2)
- ✅ 重连进度覆盖 live block(Task 3 + Task 4)
- ✅ 重连成功计时归零(Task 3 Step 5)
- ✅ 5次失败气泡不清除显示错误(Task 6 composerError + 现有 onRuntimeError system block)
- ✅ 错误纯文字灰色无背景可折叠(Task 6)
- ✅ 移除顶部横幅(Task 5)
- ✅ i18n 中英文(Task 4 Step 1)

**注意事项:**
- Task 3 Step 5 的计时归零实现需要根据 `turnStartedAtByUserId` 的实际存储位置调整(MessageTimeline 本地 state vs store)— 标注了"以实际代码为准",执行时需确认。
- `createCompatModelClientForTest` / `setupChatStoreRuntimeForTest` 测试工厂需在执行时根据现有测试基础设施确认是否存在或新建。
- `live` block 类型(`ChatLiveBlock`)的确切定义需执行时确认命名。
