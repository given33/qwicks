# 任务1:模型请求重连机制

**日期**:2026-06-24
**状态**:设计中
**关联任务**:与任务2(日志/错误不在会话顶部)部分重叠

## 背景与问题

当前模型连接一出现问题(网络错误、限流、服务端故障),会立即向用户抛出 `model request failed` 错误,没有任何重试。错误信息显示在两个位置:页面顶部的黄色横幅(`RuntimeBanner`)和输出框内的红色错误行,观感杂乱且打断使用。

## 目标

1. 模型请求失败时自动重试,最多 5 次,只有 5 次全失败才提醒用户
2. 重试期间在模型输出区显示"正在重连(第x/5次)"的进度
3. 失败时显示具体原因(为什么失败),纯文字样式,显示在输出框上方和会话内
4. 错误/日志不再显示在会话最顶部(移除顶部黄色横幅)

## 触发逻辑

### 可重试 vs 不可重试

**所有错误都重试**,不区分错误类型。无论网络错误、限流、服务端故障,还是鉴权失败、配置错误,都先尝试 5 次重连。只有 5 次全失败才向用户报错,并在折叠的详情里说明具体原因。

理由:用户希望"只要没反应就重试",不希望在中间状态被打断。鉴权/配置类错误即使重试也是同样结果,但让用户看到"已尝试5次"比立刻报错更符合预期,且详情里会提示具体原因(如"请检查 Base URL"或"请检查 API Key")。

### 重试参数

- **最大次数**:5 次
- **退避策略**:指数退避 1s → 2s → 4s → 8s → 16s
- **总等待上限**:约 31 秒(5 次退避之和)

## UI 状态机

模型回复气泡(`live block`)的内容随状态覆盖变化:

### 触发时机

- **从"正在思考"切换到"正在重连"的时机**:不是靠 GUI 定时器猜测,而是**由运行时驱动**。运行时在发起模型请求后,若 fetch 抛出任何错误(网络错误或任何 HTTP 状态码)或超时(运行时侧已有请求超时),立即进入重试循环并发送首个 `model_retry` 事件。GUI 收到该事件即覆盖气泡。
- 换言之,GUI 不自行判断"模型没回复多久了",而是**被动响应**运行时的 `model_retry` 事件。这避免了 GUI 和运行时各自计时导致的不一致。

```
用户发消息
   │
   ▼
气泡:"正在思考..."  (思考计时从 0 开始)
   │
   ▼  (模型一段时间没回复,收到 model_retry 事件)
气泡覆盖:"正在重连(第 2/5 次)"
   │
   ├──► 重连成功 ──► 气泡变回"正在思考..."  (计时归零,从 0 重新开始)
   │                   │
   │                   ▼
   │                 继续正常输出模型回复(恢复同一个 turn,断点续传)
   │
   ▼  (5 次全失败)
气泡不清除,直接显示最终错误文字(在会话内,模型气泡位置)
错误文字同时也显示在输出框上方(消息列表和输入框之间)
```

### 关键细节

- **重连成功后恢复同一个 turn**:不重新发起请求,而是恢复被中断的 SSE 连接/turn(断点续传)。技术最自然,服务端保留着 turn 状态。
- **思考计时归零**:重连成功后,UI 上的思考时长计时器从 0 重新开始,而不是累计之前的时长(因为中断期间不应计入)。
- **5 次失败后气泡不清除**:错误文字显示在模型气泡位置(会话内),不清除气泡结构。

## 错误显示样式(已确认)

### 位置

- **移除** chat 路由下的顶部黄色横幅(`RuntimeBanner`)—— 同时满足任务2
- 错误显示在**两个位置**:
  1. 会话内(模型气泡位置,5 次失败后)
  2. 输出框上方(消息列表和输入框之间的独立区域)

### 样式

- 纯文字,灰色(`#999` 附近)
- **无背景色、无边框、无图标**(低调,不突兀)
- 居中显示
- 概括文案例如:"模型连接失败(已重试 5 次)"
- **可折叠展开具体原因**:默认只显示概括,点击/悬停展开详情,例如:"HTTP 404 — 请检查 Base URL 配置" 或 "fetch failed — 网络连接异常"

### 错误文案来源

复用现有的 `src/renderer/src/lib/format-runtime-error.ts` 错误分类(已有 `runtimeMissingApiKey` / `runtimeAuthRequired` / `runtimeFetchFailed` / `runtimePortConflict` 等映射):
- **概括行**(`summary`):简短的人类可读原因 + i18n
- **折叠详情**(`detail`):具体的 HTTP 状态码、错误体、建议操作(如"请检查 Base URL"或"请检查 API Key")

## 实现架构

### 双层改动:运行时 + GUI

**QWicks 运行时**(`qwicks/src/adapters/model/compat-model-client.ts`):
- `postChatCompletion` 捕获任何错误(网络/HTTP 任何状态码)后,执行指数退避重试循环(最多 5 次)
- 每次重试前,通过运行时事件流发送一个 `model_retry` 事件,载荷:`{ attempt, maxAttempts, reason }`
- 5 次全失败后,发送最终的 `error` 事件(含完整的错误分类信息:HTTP 状态码、错误体、建议操作)

**GUI 渲染进程**(`src/renderer/src/store/chat-store-runtime.ts`):
- 新增处理 `model_retry` 事件的逻辑:把当前模型回复 live block 的内容覆盖为"正在重连(第 x/5 次)"
- 重连成功(收到任意新的 SSE 数据事件)→ live block 恢复"正在思考...",且**重置思考计时器归零**
- `onRuntimeError`:5 次失败后的最终错误 → 在输出框上方显示纯文字错误 + 会话内气泡显示错误

**GUI 组件**:
- 移除 `Workbench.tsx` 中 chat 路由的 `RuntimeBanner` 渲染
- 新增输出框上方的错误文字组件(纯文字,无样式容器)

### 涉及文件清单

运行时:
- `qwicks/src/adapters/model/compat-model-client.ts` — 重试循环 + `model_retry` 事件
- `qwicks/src/` 下 SSE 事件类型定义 — 新增 `model_retry` 事件类型(载荷:`{ attempt: number, maxAttempts: number, reason: string }`,复用现有 thread 事件流的类型扩展机制)

GUI 主进程/共享:
- `src/shared/qwicks-contract.ts` — `model_retry` 事件类型(如需)

GUI 渲染进程:
- `src/renderer/src/store/chat-store-runtime.ts` — 处理 `model_retry` 事件、覆盖 live block、计时器归零
- `src/renderer/src/store/chat-store-schedulers.ts` — 思考计时器重置逻辑
- `src/renderer/src/components/Workbench.tsx` — 移除 chat 路由的 `RuntimeBanner`
- `src/renderer/src/components/chat/MessageTimeline.tsx` — 输出框上方错误文字渲染
- `src/renderer/src/lib/format-runtime-error.ts` — 复用(可能补充重试相关文案)
- `src/renderer/src/locales/{en,zh}/common.json` — 重连/重试 i18n 文案

## 重要约束

⚠️ **需要全量发布**:运行时代码(`compat-model-client.ts`)在 `qwicks/` 子项目里,改动会被打进**全量安装包**,不是热更新(code-update)能覆盖的范围。所以任务1完成后需要一次全量发布(改了 `src/main` 相关 → 触发 `release-windows.yml`)才能让用户生效。

## 测试策略

- **运行时单元测试**:`compat-model-client` 的重试循环 —— 模拟各类错误(网络错误、429、5xx、401、403、404),验证都触发 5 次重试、退避间隔、`model_retry` 事件发送、5 次后发送最终 `error` 事件
- **GUI store 测试**:`chat-store-runtime` 处理 `model_retry` 事件 —— 验证 live block 覆盖、计时器归零、5 次失败后错误显示
- **手动验证**:断开网络/配错 Base URL,观察重连进度显示和最终错误提示
