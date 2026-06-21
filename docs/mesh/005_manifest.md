# RFC 005 — 能力清单（Manifest）

| 字段 | 值 |
|---|---|
| RFC 编号 | 005 |
| 标题 | 能力清单与协商 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000 |
| 被依赖 | 002, 003, 008 |

---

## 1. 目标

定义 Node 向 Peer 暴露能力的标准清单结构、协商流程、版本化与变更通知机制。Manifest 是 Task 路由（008）、工具调用（003）、模型选择（002）的共同依据。Manifest 只描述**公开层**能力；协作层与私有层的能力暴露由 006 的权限授予决定，不在 Manifest 中静态声明敏感项。

## 2. 非目标

- 不在 Manifest 中暴露私有文件路径、密钥、个人长期记忆内容。
- 不定义工具的执行语义（执行由 003 定义）；Manifest 只声明"有什么、怎么调、风险多大"。
- 不做 Manifest 的跨设备聚合目录服务（v1 仅点对点交换）。

## 3. Manifest 结构

```
Manifest {
  deviceId            string         // 与 000 §6.1 一致
  deviceName          string
  protocolVersion     string         // Envelope.version，当前 "1"
  manifestVersion     string         // 本清单内容版本，单调递增（每次变更 +1）
  generatedAt         ISO-8601
  models              ModelEntry[]
  tools               ToolEntry[]
  prompts             PromptTemplate[]
  resources           ResourceEntry[]
  computeProfile      ComputeProfile
  offeredPermissions  PermissionOffer  // 本机愿意授予默认 Peer 的权限上限
}
```

### 3.1 ModelEntry

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 模型标识（如 `qwen2.5-7b`、`deepseek-r1-14b`、`gpt-4o`）。 |
| `provider` | enum | 是 | `local` / `remote`（远端 API 由本机代理）。 |
| `contextWindow` | int | 是 | 最大上下文 token 数。 |
| `maxOutput` | int | 是 | 最大输出 token 数。 |
| `supportsTools` | boolean | 是 | 是否支持 function/tool calling。 |
| `supportsVision` | boolean | 是 | 是否支持图像输入。 |
| `capabilities` | string[] | 否 | 标签：`planning`、`reflection`、`extraction`、`coding` 等，供路由器分类。 |
| `costPer1kInputUsd` | number? | 否 | 远端模型计费；本地模型省略。 |
| `costPer1kOutputUsd` | number? | 否 | 同上。 |
| `available` | boolean | 是 | 当前是否可用（模型未加载时为 false）。 |
| `version` | string | 是 | 模型/权重版本。 |

### 3.2 ToolEntry

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 工具名，全局唯一（建议 `deviceType.tool` 命名，如 `fs.read`）。 |
| `description` | string | 是 | 给模型看的自然语言描述。 |
| `version` | string | 是 | 工具实现版本（语义化版本）。 |
| `ownerDevice` | string | 是 | 拥有方 deviceId（即本机）。 |
| `inputSchema` | JSON Schema | 是 | 入参 schema（与既有 `capabilities` 契约一致）。 |
| `outputSchema` | JSON Schema | 是 | 出参 schema。 |
| `riskLevel` | enum | 是 | `none` / `low` / `medium` / `high` / `critical`。 |
| `requiresUserConfirm` | boolean | 是 | 是否每次调用都需本地用户确认（critical 级强制为 true）。 |
| `allowedPaths` | string[]? | 否 | 文件类工具的路径白名单（glob）。 |
| `rateLimit` | RateLimit? | 否 | 调用频率限制。 |
| `readonly` | boolean | 是 | 是否只读（不改变任何状态）。 |
| `discoverable` | boolean | 是 | 是否对 Peer 可见；false 表示仅本机用。 |
| `sides` | enum[] | 是 | `[orchestrator]` / `[worker]` / `[orchestrator, worker]`：该工具在哪种角色下可被对端调用。 |

```
RateLimit { maxCalls int; windowSeconds int }
```

### 3.3 PromptTemplate（版本化提示词）

提示词按四层叠，各层带 `version` 与 `scope`，按需发现与参数化，不整段同步：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 模板标识（如 `base.system`、`task.code-review`、`device.gpu-host`、`tool.fs`）。 |
| `layer` | enum | 是 | `globalBase` / `task` / `device` / `tool`。 |
| `version` | string | 是 | 模板版本。 |
| `scope` | enum | 是 | `public` / `collaboration` / `private`（对应 000 §9）。 |
| `parameters` | ParamSpec[] | 是 | 可参数化字段定义。 |
| `template` | string | 是 | 模板文本，含 `{{param}}` 占位。 |

```
ParamSpec { name string; required boolean; default string? }
```

层叠顺序（高优先覆盖低优先，按既 `promptPreamble` 注入 prompt body 而非 system prompt 的缓存原则）：

```
globalBase → task → device → tool
```

Orchestrator 派发 Task 时只下发该 Task 所需层的模板 id + 参数值，Worker 本地若无对应版本则通过 `prompts/get` 拉取（见 §6）。

### 3.4 ResourceEntry

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `uri` | string | 是 | 资源 URI（如 `file://workspace/proj-x/index`）。 |
| `type` | enum | 是 | `fileIndex` / `image` / `doc` / `memoryRef`。 |
| `scope` | enum | 是 | `public` / `collaboration` / `private`。 |
| `size` | int? | 否 | 字节数（用于传输决策）。 |
| `mutable` | boolean | 是 | 是否可被对端写。v1 资源对端只读。 |

### 3.5 ComputeProfile（算力画像，供路由）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cpuCores` | int | 是 | 逻辑核数。 |
| `ramGb` | int | 是 | 可用内存。 |
| `gpu` | GpuInfo? | 否 | 无 GPU 则省略。 |
| `canRunLocalModels` | boolean | 是 | 是否能本地推理。 |
| `maxModelParamsB` | int? | 否 | 本地可跑的最大参数量（十亿）。 |

```
GpuInfo { name string; vramGb int; computeCapability string }
LoadInfo { cpuPct number; ramPct number; gpuPct number?; inflightTasks int; sampledAt ISO-8601 }
```

`LoadInfo`（实时负载快照）**不在静态 Manifest 中**，由 `status/update` 通知周期刷新（见 §5.5）。静态 `ComputeProfile` 只描述能力，不含随时间变化的负载。

### 3.6 PermissionOffer

本机愿意授予默认 `standard` 信任级 Peer 的权限上限（细化见 006）：

```
PermissionOffer {
  memoryQuery: { allowed boolean; maxTopK int; scopes string[] }   // scopes: ["public","collaboration"]
  toolCall: { allowedTools string[]; deniedTools string[]; maxRiskLevel enum }
  resourceAccess: { allowedUris string[] }
  taskExecution: { maxConcurrent int; maxLeaseSeconds int }
}
```

## 4. 协商流程

### 4.1 交换时机

1. Session 建立并完成鉴权后（见 001 §5），双方立即互发 `manifest/push`。
2. 任意一方 Manifest 变更时发 `manifest/changed` 通知，对端收到后用 `manifest/get` 拉取最新。
3. 定期（默认 60s）或负载显著变化时发 `status/update`（仅 `LoadInfo`，不全量推 Manifest）。

### 4.2 版本兼容

- `protocolVersion` 不一致：取双方共同最高；无交集则拒绝 Session 并记录审计。
- `manifestVersion`：单调递增；对端缓存按 deviceId + manifestVersion。
- 工具/提示词 `version` 用语义化版本：major 不兼容需降级或拒绝；minor/patch 向后兼容。

### 4.3 降级

若 Orchestrator 需要某工具的 v2 而对端只提供 v1（major 不兼容）：
- 若 v1 满足输入 schema 子集 → 以 v1 调用，记录降级审计；
- 否则路由器（008）改选其他 Worker 或回退本地执行。

## 5. 方法定义

### 5.1 `manifest/push`（notification）

方向：双向。携带完整 Manifest。接收方校验签名（Envelope.auth）、`protocolVersion` 兼容后缓存，替换该 deviceId 的旧版本。

### 5.2 `manifest/get`（request）

```
params { deviceId string; sinceManifestVersion string? }
result { manifest Manifest | null }   // null 表示 sinceManifestVersion 已最新
```

### 5.3 `manifest/changed`（notification）

```
params { deviceId string; newManifestVersion string; changedKinds string[] }
// changedKinds: ["tools","prompts","models","resources","computeProfile","permissions"] 子集
```

### 5.4 `prompts/get`（request）

按需拉取单个提示词模板：

```
params { id string; version string? }
result { template PromptTemplate | null }
```

### 5.5 `status/update`（notification）

```
params { deviceId string; load LoadInfo }
```

## 6. 缓存与失效

- 每个 Node 维护 `peerManifestCache: Map<deviceId, {manifest, receivedAt}>`。
- 失效条件：收到 `manifest/changed`、Session 重连、`manifest/get` 返回 null（对端已忘）。
- 缓存仅存内存，不持久化（重启后重拉）。

## 7. 安全约束

- Manifest 经 Envelope 签名传输（见 006），防止伪造能力清单。
- `discoverable=false` 的工具不出现在 Manifest。
- `scope=private` 的 prompt/resource 不出现在 Manifest；仅在显式授权后通过 `prompts/get`/`resources/get` 受控访问。
- Manifest 不含任何可执行内容；`template` 是文本，`inputSchema` 是数据。

## 8. 审计

以下事件入审计（见 006）：`manifest_pushed`、`manifest_received`、`manifest_changed`、`manifest_get`、`prompt_get`、`status_update`。每条含 `traceId`、双方 deviceId、`manifestVersion`。

## 9. 评审检查清单

- [ ] Manifest 是否只暴露公开层，不含敏感项？
- [ ] 工具的 riskLevel/requiresUserConfirm/allowedPaths 是否覆盖 006 的安全需求？
- [ ] 版本化提示词四层叠是否与既有 `promptPreamble` 注入策略一致（保 prefix cache）？
- [ ] 协商的降级路径是否明确？
- [ ] LoadInfo 与 Manifest 分离推送是否合理？
