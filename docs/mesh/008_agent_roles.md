# RFC 008 — Agent 角色与路由（Agent Roles & Routing）

| 字段 | 值 |
|---|---|
| RFC 编号 | 008 |
| 标题 | 对等联邦、单 Task 受限 Worker、路由与多设备/多模型/多 Agent 扩展 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000, 002, 005 |
| 被依赖 | — |

---

## 1. 目标

定义 Mesh 的 Agent 角色模型、单 Task 内的执行契约、路由策略，以及向多设备 / 多模型 / 多 Agent 扩展的设计。本 RFC 落实 000 §11 D7：对等联邦 mesh，单 Task 内 Worker 为受限纯执行方——统一"纯工人"与"联邦 mesh"两种表述。

## 2. 非目标

- 不定义路由的具体评分算法实现（归实现层；本 RFC 定义输入/输出/约束）。
- 不定义 UI 上的多 Agent 可视化（归前端层）。
- 不引入中央调度器（纯对等，000 §1.2）。

## 3. 角色模型

### 3.1 对等联邦（Federated Mesh）

- 每个 Node 是一个 **Agent Node**，拥有独立 deviceId、身份、Manifest、记忆。
- 每个 Node 同时具备 Orchestrator 能力与 Worker 能力；可在不同 Task 中扮演不同角色，亦可同时（A 既向 B 派发 Task X，又为 C 执行 Task Y）。
- 不存在"控制者"Node；任何 Node 都可发起 Task（受目标 Worker 预算与权限约束）。

### 3.2 单 Task 受限 Worker（Scoped Pure Executor）

在**单个 Task 生命周期内**，Worker 是受限纯执行方：

| 维度 | Worker 的约束 |
|---|---|
| 系统提示词 | 由 Orchestrator 经 `systemPromptLayers`（002 §6.1）下发；Worker 不自行注入额外系统提示词（仅叠加本机工具层 prompt）。 |
| 工具集 | 受 `toolPolicy`（`readOnly`/`inherit`）与 `allowedTools`（002 §4.1）约束；远程工具借用须回查 Orchestrator（003）。 |
| 记忆 | 默认仅查 public/collaboration；private 须 Orchestrator 临时授权（004 §8）。 |
| 自主性 | 不得超出 Task 的 prompt 与工具范围自行发起无关动作；既有 `toolStorm` breaker 与预算约束同样生效。 |
| 结果 | 返回 `ChildRunResult` + `StateDelta`；不直接写回 Orchestrator 的私有状态。 |

这统一了"纯工人"（单 Task 受限）与"联邦 mesh"（拓扑对等）：对等是身份与拓扑层面，受限是单 Task 执行契约层面，两者不矛盾。

## 4. 路由策略

### 4.1 路由器职责

`MeshRouter` 在 `DelegationRuntime` 选择 executor 时决定 local vs remote、选哪个 Worker：

```
selectExecutor(input: ChildRunExecutorInput): { executor: 'local' | 'remote', workerDeviceId?: string, model?: string }
```

### 4.2 路由输入

| 输入 | 来源 |
|---|---|
| 候选 Worker 列表 | 已配对且 Session 活跃的 Peer + 本机 |
| 各 Worker 模型 | Manifest `models[]`（005 §3.1） |
| 各 Worker 算力/负载 | `ComputeProfile` + `status/update` 的 `LoadInfo`（005 §3.5, §5.5） |
| Task 模型偏好 | `input.model`、profile、`capabilities` 标签 |
| Task 工具需求 | 需要的工具集（推断自 prompt/profile）vs 各 Worker Manifest `tools[]` |
| 预算 | 各 Worker `taskExecution.maxConcurrent` + 本机 `maxParallel` |
| 权限 | `peerTrustStore.permissions` 与对端 `PermissionOffer` |
| 历史 | 该 Worker 最近 Task 的成功率/延迟（telemetry） |

### 4.3 路由规则（优先级从高到低）

1. **强制偏好**：`input.model` 指定时，仅选拥有该模型且 `available=true` 的 Worker；无则降级到本地。
2. **能力匹配**：剔除不满足工具需求 / 权限 / 预算已满的 Worker。
3. **算力适配**：Planning/Reflection 类（`capabilities` 标签）优先选大算力 Worker（`maxModelParamsB` 高、`gpu` 强）；Extraction/格式化类优先本地（省带宽）。
4. **负载均衡**：在合格候选中按 `inflightTasks` 与 `load` 评分选最闲者；同分按 deviceId 稳定排序避免抖动。
5. **本地兜底**：无合格远程 Worker → 本地 `createChildAgentExecutor`。

### 4.4 路由可观测

每次路由决策记录 `routing_decision` 审计事件：候选数、选中 deviceId、选中理由标签（`model_match`/`compute_preferred`/`load_balanced`/`local_fallback`）、剔除原因。供 008 的策略调优与 006 的问责。

## 5. 多设备扩展

- 身份与信任以 deviceId 为单位，天然支持 N Peer（001 §9）。
- 单 Orchestrator 可 fan-out 到多个 Worker：`DelegationRuntime.maxParallel` 控并发，每个 Task 独立 `task_id`/`provenance`。
- 多 Orchestrator 可并发向同一 Worker 派发；Worker 侧按 `taskExecution.maxConcurrent` 与独立队列管理，互不阻塞。
- `provenance` 循环检测（007 §7）防止 A→B→C→A 的级联回环。

## 6. 多模型扩展

- Manifest `models[]` 暴露每台设备的可用模型与算力画像（005 §3.1, §3.5）。
- `auto-model-router`（既有）把 Peer 模型纳入候选；Mesh 在 `selectExecutor` 时把模型选择与 Worker 选择合一（§4.3 规则 1）。
- 一个 Task 可指定 `model`；亦可不指定交由路由器按 `capabilities` 标签选。
- 模型不可用（`available=false`）不参与路由；变更经 `manifest/changed` 实时更新候选。

## 7. 多 Agent 扩展

- Worker 执行 Task 时可在其本地 `AgentLoop` 中再 spawn 子 Task（既有 `DelegationRuntime.runChild` 递归语义）；若子 Task 路由到另一设备，则形成 `parent_task_id` 链（002/007）。
- `provenance` 记录已参与 deviceId 链；同一 `traceId` 内禁止回到已参与设备（007 §7.1 `cycle_detected`）。
- `provenance.length` 超上限（默认 5）拒绝继续派发（007 §7.2），防失控级联。
- 多 Agent fan-out 的结果汇总由各自 Orchestrator 经 `StateDelta`（002 §8）合并；单向状态机，不引入跨设备合并冲突。

## 8. 角色状态

每个 Node 维护自身角色状态：

| 状态 | 说明 |
|---|---|
| `asOrchestrator` | 当前作为 Orchestrator 的在途 Task 列表（`taskId`/`workerDeviceId`/`lease`）。 |
| `asWorker` | 当前作为 Worker 的在途 Task 列表（`taskId`/`orchestratorDeviceId`/`lease`）。 |
| `budget` | 本机 `maxParallel`/`maxChildRuns` 的占用情况。 |

角色状态仅内存；崩溃恢复靠 `ChildRunRecord`（既有持久化）+ 007 §8。

## 9. 与既有 `DelegationRuntime` 的接缝

- Mesh 在 `DelegationRuntime.options.executors` 注册 `local`（既有）与 `remote`（§4.1）两类 executor。
- `DelegationRuntime.runChild` 按 profile/配置选择 executor，或交由 `MeshRouter.selectExecutor` 决定。
- 远程 executor 的结果经 002 §4.2 映射回 `ChildRunExecutorResult`，对 `DelegationRuntime` 透明。
- 既有预算/状态机/telemetry/`aggregateChildRuns` 对所有 executor 统一生效。

## 10. 评审检查清单

- [ ] 对等联邦与单 Task 受限 Worker 是否无矛盾？
- [ ] 路由规则是否覆盖模型/能力/负载/权限/本地兜底？
- [ ] 多设备 fan-out 是否受 `maxParallel` 与 `provenance` 约束？
- [ ] 多 Agent 级联是否被循环检测与深度上限防护？
- [ ] 路由决策是否可观测、可问责（审计）？
