# RFC 002 — 任务派发协议（Task Dispatch）

| 字段 | 值 |
|---|---|
| RFC 编号 | 002 |
| 标题 | 跨设备任务派发与回包 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000, 005, 007 |
| 被依赖 | 003, 007, 008 |

---

## 1. 目标

定义 Orchestrator 向 Worker 派发一个 Agent 子任务、流式回传进度、取消、回包的完整协议，并定义与既有 `DelegationRuntime` 的接缝映射。远程 Task 在 Orchestrator 侧表现为 `DelegationRuntime` 的一个 executor 实现；在 Worker 侧表现为本地 `createChildAgentExecutor` 的一次执行 + 网络回传。

## 2. 非目标

- 不定义 Worker 内部如何跑 Agent loop（复用既有 `AgentLoop`，本 RFC 只定义 wire 边界）。
- 不定义远程工具调用细节（见 003）、记忆查询（见 004）、租约机制细节（见 007）。
- 不定义路由策略（见 008）。

## 3. 与既有 `DelegationRuntime` 的接缝

既有 `DelegationRuntime.runChild(input)` 调用 `this.options.executor(input)`。本地 executor = `createChildAgentExecutor`。Mesh 新增 `createRemoteChildExecutor`，实现同一 executor 接口：

```
executor(input: ChildRunExecutorInput): Promise<ChildRunExecutorResult>
```

`ChildRunExecutorInput`（既有，不改）：

| 字段 | 来源 |
|---|---|
| `childId`, `parentThreadId`, `parentTurnId`, `label`, `prompt`, `workspace`, `model`, `toolPolicy`, `promptPreamble`, `signal` | `DelegationRuntime.runChild` |

`ChildRunExecutorResult`（既有，不改）：

| 字段 | 说明 |
|---|---|
| `summary` | 文本摘要。 |
| `usage` | token/费用快照。 |
| `toolInvocations` | 工具调用次数。 |
| `prefixReused` | 是否复用 prefix cache。 |
| `inheritedHistoryItems` | 继承的历史条目数。 |

`createRemoteChildExecutor` 的职责：

1. 把 `ChildRunExecutorInput` 编为 `task/run` wire payload（§5）。
2. 选择目标 Worker（路由器，008）与 Session。
3. 经 Envelope 发 `task/run` 请求；同时按 007 建租约。
4. 接收 `task/progress` 通知，转发为本地 runtime event（供 telemetry/UI）。
5. 收到 `task/run` 响应（`ChildRunResult`），解包为 `ChildRunExecutorResult` 返回给 `DelegationRuntime`。
6. `signal` abort 时发 `task/cancel`。

`DelegationRuntime` 的预算（`maxChildRuns`）、并发（`maxParallel`）、状态机、telemetry、`ChildRunRecord` 持久化**完全不变**；远程 Task 与本地 child 共用同一预算池。

## 4. wire payload 与既有字段映射

### 4.1 `TaskRunParams`（task/run 的 Envelope.payload）

| wire 字段 | 类型 | 映射自 ChildRunExecutorInput | 说明 |
|---|---|---|---|
| `taskId` | string | `childId` | 即 Task ID。 |
| `parentThreadId` | string | `parentThreadId` | Orchestrator 侧 thread。 |
| `parentTurnId` | string | `parentTurnId` | Orchestrator 侧 turn。 |
| `label` | string? | `label` | 子任务标签。 |
| `prompt` | string | `prompt` | 任务正文。 |
| `promptPreamble` | string? | `promptPreamble` | profile 前言（注入 prompt body）。 |
| `workspace` | string? | `workspace` | 工作区引用（URI，见 §7）。 |
| `model` | string? | `model` | 目标模型 id（须在 Worker Manifest 中）。 |
| `profile` | string? | profile 名 | Worker 本地若无该 profile 则用 default。 |
| `toolPolicy` | enum | `toolPolicy` | `readOnly` / `inherit`。 |
| `systemPromptLayers` | PromptLayerAssignment[] | 见 §6 | 四层叠模板 id + 参数。 |
| `historyDelta` | HistoryDelta? | 见 §6 | 增量历史（保 prefix 一致）。 |
| `lease` | LeaseSpec | 007 | `leaseTimeout`, `heartbeatInterval`。 |
| `idempotencyKey` | string | 007 | 幂等键。 |
| `retryCount` | int | 007 | 当前重试序号。 |
| `maxRetries` | int | 007 | 上限。 |
| `cancelToken` | string | 007 | 取消令牌。 |
| `provenance` | string[] | 007 | 已参与的 deviceId 链。 |
| `allowedTools` | string[]? | 路由/profile 限定 | 覆盖 toolPolicy 的工具白名单。 |
| `disableUserInput` | boolean | 固定 true | Worker 侧无 GUI 输入面（与本地 child 一致）。 |

### 4.2 `ChildRunResult`（task/run 响应）

| wire 字段 | 类型 | 映射到 ChildRunExecutorResult |
|---|---|---|
| `summary` | string | `summary` |
| `usage` | UsageSnapshot | `usage` |
| `toolInvocations` | int | `toolInvocations` |
| `prefixReused` | boolean | `prefixReused` |
| `inheritedHistoryItems` | int | `inheritedHistoryItems` |
| `stateDelta` | StateDelta | 见 §8（Orchestrator 合并） |
| `status` | enum | `completed` / `failed` / `aborted`（与 ChildRunRecord 状态一致） |
| `error` | string? | 失败时的错误信息 |

## 5. 方法：`task/run`（request）

```
method: task/run
params: TaskRunParams
result: ChildRunResult
```

- Orchestrator 发出后即进入 `running`（既有 `DelegationRuntime` 已置 `queued`→`running`）。
- 同步等待响应；响应到达即完成（既有状态机置 `completed`/`failed`）。
- 超时（租约，007）由 Orchestrator 侧 executor 触发 `task/cancel` 并置 `failed`/`aborted`。

## 6. 系统提示词与历史

### 6.1 PromptLayerAssignment

```
PromptLayerAssignment { layer enum; templateId string; templateVersion string; params Record<string,string> }
// layer: globalBase | task | device | tool
```

派发时只下发模板 id + 参数值；Worker 本地缺该版本时经 `prompts/get`（005 §5.4）拉取并缓存。层叠后注入 prompt body（与既有 `promptPreamble` 同位置），**不进 system prompt**，以保 prefix cache 字节一致（既有 `prefixReused` 语义）。

### 6.2 HistoryDelta

为控带宽（000 §1.1 非目标中"不整段透传十几万字"）：

```
HistoryDelta {
  prefixHash string       // 用于 Worker 端校验 prefix 一致性
  seedItems HistoryItem[] // 必要的最小上下文条目（按既有 inheritedHistoryItems 语义裁剪）
  compactionHint string?  // 上次 compaction 摘要引用
}
```

- `seedItems` 为空时 Worker 仅用 prefix（`inheritedHistoryItems=0`，与本地 child 默认一致）。
- 大对象不进 `seedItems`，改用资源 URI（§7）。

## 7. 工作区与资源

- `workspace` 为 URI（如 `file://host/path` 或 `qwicks://<deviceId>/workspace/<id>`）。
- v1：工作区默认不跨设备同步；Worker 在其本地工作区执行；产出物（文件改动）以 `stateDelta.artifactsChanged`（URI 列表）回传，Orchestrator 按需经 `resources/get` 拉取。
- 大对象传输走 `resources/put`/`resources/get`（引用 + 签名，见 006 §4.4）。

## 8. StateDelta（增量状态回传）

```
StateDelta {
  artifactsChanged ResourceRef[]   // 被修改/创建的资源
  followUp string?                 // Worker 建议的下一步（非约束）
  metrics TaskMetrics?             // turn 数、compaction 次数等
}
ResourceRef { uri string; type enum; size int?; checksum string? }
```

Orchestrator 合并：`summary` 入父 thread 的 assistant_text；`artifactsChanged` 注册到本地工作区索引；`usage` 经既有 `recordExternalUsage` 记账。单向状态机（A→B→A），不引入 CRDT（000 D10）。

## 9. 进度通知：`task/progress`（notification）

Worker 执行期间把本地 runtime event 经 Envelope 流式推给 Orchestrator：

```
method: task/progress
params {
  taskId string
  seq int
  event ProgressEvent
}
```

`ProgressEvent`（与既有 runtime event schema 对齐，子集）：

| kind | 说明 |
|---|---|
| `turn_started` | Worker 开始执行 turn。 |
| `assistant_text` | 模型文本片段（可分段）。 |
| `tool_call` | Worker 发起工具调用（含远程回查，见 003）。 |
| `tool_result` | 工具结果摘要。 |
| `error` | 执行错误。 |
| `heartbeat` | 兼作租约心跳（007）。 |
| `turn_completed` | turn 完成。 |

Orchestrator 收到后转发为本地 runtime event（供既有 telemetry/UI/`aggregateChildRuns`）。`seq` 单调，缺失检测由 007 处理。

## 10. 取消：`task/cancel`（request）

```
method: task/cancel
params { taskId string; cancelToken string; reason string? }
result { cancelled boolean; finalState ChildRunResult? }
```

- Orchestrator `signal` abort 或租约超时时调用。
- Worker 收到后中止本地 AgentLoop（既有 abort 路径），尽快回 `finalState`（status=`aborted`）。
- 详见 007。

## 11. Worker 侧执行

Worker 收到 `task/run` 后：

1. 权限检查（006 §3.2）+ 幂等去重（007）。
2. 构造 `ChildRunExecutorInput`（反向 §4.1 映射）。
3. 调用本地 `createChildAgentExecutor`（既有，不改）跑 `AgentLoop`。
4. 执行期间发 `task/progress`。
5. 需要远程工具/记忆时回查 Orchestrator（003/004）。
6. 完成后返回 `ChildRunResult`。

Worker 侧拒绝/失败映射到 JSON-RPC error（006 §10）。

## 12. 错误与重试

- 可重试错误（网络、Worker 临时不可用、lease 超时但结果未知）→ 由 007 按 `maxRetries` 重试，`idempotencyKey` 保证 Worker 不重复执行。
- 不可重试错误（权限拒绝、协议不兼容、prompt 非法）→ 直接 `failed`，不重试。
- 错误信息写入 `ChildRunResult.error` 与既有 `ChildRunRecord.error`。

## 13. 审计

入审计：`task_run_requested`、`task_run_started`、`task_progress`（仅 milestone：started/completed/error，非逐条）、`task_run_completed`、`task_run_failed`、`task_cancelled`。每条含 `traceId`/`taskId`/双方 deviceId（006 §8）。

## 14. 评审检查清单

- [ ] `createRemoteChildExecutor` 是否完全满足既有 executor 接口、不修改 `DelegationRuntime`？
- [ ] wire 字段是否与 ChildRunExecutorInput/Result 一一对应、无丢失？
- [ ] prompt 注入是否保 prefix cache 字节一致（既有 `prefixReused` 语义）？
- [ ] StateDelta 是否单向（A→B→A）、无 CRDT？
- [ ] 进度通知是否与既有 runtime event schema 对齐？
