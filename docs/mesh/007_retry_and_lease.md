# RFC 007 — 租约、心跳、幂等、取消、回收与溯源（Retry & Lease）

| 字段 | 值 |
|---|---|
| RFC 编号 | 007 |
| 标题 | 任务租约与可靠性 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000, 002 |
| 被依赖 | 002, 008 |

---

## 1. 目标

定义跨设备 Task 的可靠性机制：执行租约与心跳续约、幂等去重、取消、Worker 掉线/超时时的回收与接管、任务溯源（provenance）与循环检测。目标是让 B 掉线、超时、重复回包时 A 都能安全重试或接管，且不把任务状态弄乱。本 RFC 是 002 的可靠性底座。

## 2. 非目标

- 不定义 Task 的业务语义（见 002）。
- 不定义跨设备的最终一致性（单向状态机，000 D10）。
- 不做跨 Orchestrator 的分布式事务（单 Task 单 Orchestrator 拥有）。

## 3. 任务元数据

每个 `task/run` 必须携带（与 002 §4.1 一致）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskId` | string | 全局唯一 Task ID（ULID）。 |
| `parentTaskId` | string? | 父 Task ID；多级 fan-out 时形成链。 |
| `leaseTimeout` | int (秒) | 租约时长；Worker 必须在此内续约或完成。默认 300s。 |
| `heartbeatInterval` | int (秒) | 心跳周期，默认 `leaseTimeout/4`。 |
| `idempotencyKey` | string | 幂等键（建议 `taskId@retryCount` 或独立 ULID）。 |
| `retryCount` | int | 当前重试序号，从 0 起。 |
| `maxRetries` | int | 重试上限，默认 2。 |
| `cancelToken` | string | 取消令牌（随机）；`task/cancel` 必须携带。 |
| `provenance` | string[] | 已参与的 deviceId 链（含 Orchestrator 自身），用于循环检测。 |

## 4. 租约与心跳

### 4.1 租约语义

- Worker 收到 `task/run` 后立即持有租约：须在 `leaseTimeout` 内完成或发心跳。
- 租约过期前未收到心跳或结果 → Orchestrator 认定租约失效，可发起 `task/cancel` 并按 §6 重试/接管。
- 租约是**单 Orchestrator 拥有**：只有该 Task 的 Orchestrator 可取消/回收，Worker 不接受其它来源的取消（防恶意/误操作）。

### 4.2 心跳

Worker 周期发 `task/progress` 的 `heartbeat` kind（002 §9）作为租约续约；亦可在执行 turn 时顺带续约。Orchestrator 收到即刷新租约到期时间。

### 4.3 续约失败

- Worker 进程崩溃 → 心跳停止 → 租约超时 → Orchestrator 回收（§6）。
- 网络抖动 → 心跳丢失但 Worker 仍在跑 → 租约超时触发回收，但 Worker 可能稍后回包。此时幂等（§5）与"晚到结果丢弃"（§6.3）保证不重复执行/不污染状态。

## 5. 幂等

### 5.1 幂等键

- Worker 维护 `idempotencyTable: Map<idempotencyKey, {taskId, status, result?}>`，TTL 默认 `leaseTimeout * 4`。
- 收到 `task/run`：
  - 键存在且 status=`running` → 不重新执行，返回"仍在执行"响应（或等待后返回原结果）。
  - 键存在且 status=`completed` → 直接返回缓存的 `result`，不重跑。
  - 键不存在 → 执行，写入 `running`，完成后写 `completed`+`result`。

### 5.2 重试时的键策略

- 同一逻辑 Task 的重试用**相同 `idempotencyKey`**（`retryCount` 不同但键不变）→ Worker 幂等返回。
- 仅当 Worker 确认前次执行已丢失（崩溃后无 `result`）时才重跑；`idempotencyKey` 存在但无 `result` 视为可重跑。

### 5.3 去重粒度

幂等只覆盖 `task/run` 的"执行一次"语义；`task/progress` 通知按 `seq` 去重（002 §9）；`tools/call` 与 `memory/query` 各自的幂等由 003/004 按 `callId`/`queryId` 处理。

## 6. 取消、回收与接管

### 6.1 主动取消（`task/cancel`，002 §10）

- Orchestrator `signal` abort（用户取消、父 turn 结束）→ 发 `task/cancel`（携带 `cancelToken`）。
- Worker 校验 `cancelToken` 后中止本地 AgentLoop（既有 abort 路径），回 `finalState`（status=`aborted`）。
- 取消后任何后续 `task/progress` 被丢弃。

### 6.2 租约超时回收

- Orchestrator 监控租约；超时且无心跳 → 标记 Task `failed`（reason=`lease_expired`），发 `task/cancel`（best-effort），触发 §6.3 的回收决策。
- 审计 `lease_expired`。

### 6.3 接管决策

租约失效后 Orchestrator 按 `maxRetries` 与路由策略（008）决策：

| 情况 | 决策 |
|---|---|
| `retryCount < maxRetries` 且原 Worker 仍可达 | 重试：相同 `idempotencyKey`、`retryCount+1`，重发 `task/run`。 |
| `retryCount < maxRetries` 且原 Worker 不可达 | 改派：换 Worker（008 路由），相同 `idempotencyKey`、`retryCount+1`。 |
| `retryCount >= maxRetries` | 放弃远程：Orchestrator 本地 `createChildAgentExecutor` 接管（既有本地执行），或置 `failed`。 |
| Task 不可重试（权限/协议错误） | 直接 `failed`，不重试。 |

### 6.4 晚到结果

- 重试/接管后原 Worker 的 `task/run` 响应或 `task/progress` 到达 → Orchestrator 按 `idempotencyKey` 识别为旧执行，丢弃并审计 `late_result_discarded`。
- 不合并多个执行的结果（单向状态机，A→B→A，单结果）。

## 7. 溯源与循环检测

### 7.1 provenance

- 每个 `task/run` 携带 `provenance: string[]`，初始为 `[orchestratorDeviceId]`。
- Worker 接受 Task 时把自身 deviceId 追加（实际为下一次 fan-out 时由 Worker 作为新 Orchestrator 追加）。
- 任何 Node 在派发前检查：若自身 deviceId 已在 `provenance` 中 → 拒绝并审计 `cycle_detected`，返回错误（防 A→B→A→B... 无限递归）。

### 7.2 链深度

- `provenance.length` 超过上限（默认 5）→ 拒绝继续派发，审计 `provenance_too_deep`。防失控级联。

## 8. 断线恢复

### 8.1 Session 断开

- Worker 与 Orchestrator 间 Session 断开 → 在途 Task 的租约按 §6.2 处理（心跳停 → 超时回收）。
- 重连后：未完成且未超时的 Task 继续按原 `idempotencyKey` 推进；已超时的按重试/接管处理。

### 8.2 Orchestrator 侧崩溃

- Orchestrator 崩溃后重启：从 `ChildRunRecord`（既有持久化）恢复在途 Task 列表；对仍 `running` 的发 `task/cancel` 或等待租约超时后回收。
- Worker 侧的 `idempotencyTable` 在自身崩溃后丢失 → 重跑受 `idempotencyKey` 与"无 result 则可重跑"规则约束（§5.2）。

## 9. 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `mesh.task.defaultLeaseTimeout` | 300s | 默认租约。 |
| `mesh.task.defaultHeartbeatInterval` | lease/4 | 心跳周期。 |
| `mesh.task.maxRetries` | 2 | 默认重试上限。 |
| `mesh.task.provenanceMaxDepth` | 5 | 溯源链深度上限。 |
| `mesh.task.idempotencyTtlMultiplier` | 4 | 幂等表 TTL = lease × 此值。 |

## 10. 审计

入审计：`lease_granted`、`lease_renewed`、`lease_expired`、`task_retried`、`task_reassigned`、`task_taken_over_locally`、`late_result_discarded`、`cycle_detected`、`provenance_too_deep`、`task_cancelled`。每条含 `traceId`/`taskId`/双方 deviceId/retryCount（006 §8）。

## 11. 评审检查清单

- [ ] 租约是否单 Orchestrator 拥有、Worker 不接受其它来源取消？
- [ ] 幂等键策略是否覆盖"仍 running"/"已 completed"/"崩溃无 result"三种情况？
- [ ] 晚到结果是否被丢弃且审计？
- [ ] provenance 循环检测是否防止 A→B→A 递归？
- [ ] 接管回退到本地执行是否走既有 `createChildAgentExecutor`？
