# RFC 003 — 远程工具调用（Tool RPC）

| 字段 | 值 |
|---|---|
| RFC 编号 | 003 |
| 标题 | 对称远程工具调用与 approval-gate 集成 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000, 005, 006 |
| 被依赖 | 002, 008 |

---

## 1. 目标

定义 Node 之间对称的远程工具调用：Worker 在执行 Task 时若需要只有 Orchestrator（或其它 Peer）才有的工具，经 `tools/call` 反向请求拥有方本地执行后回传 `ToolResult`；反之亦然。本 RFC 定义调用方法、与既有 `tool-host` port 及 `approval-gate` 的集成、对称的 `RemoteToolHost` 适配器。

## 2. 非目标

- 不定义工具自身实现（复用既有 `adapters/tool/*` 与 `capabilities` 契约）。
- 不定义 Manifest 中工具的声明格式（见 005 §3.2）。
- 不定义高危确认的 UI 细节（归实现层；约束见 006 §5）。

## 3. 角色与对称性

每个 Node 既是工具消费方（`RemoteToolHost`，调对端工具）又是工具提供方（本地工具按 Manifest 暴露给对端）。同一对 Session 内方向可随时切换：

```
Worker 执行 Task 中需要工具 T (owner=Orchestrator)
  └─ Worker 的 RemoteToolHost.tools/call → Orchestrator
       └─ Orchestrator 本地 tool-host 执行（经 approval-gate）→ 回 ToolResult
```

反向（Orchestrator 借用 Worker 工具）协议相同。

## 4. 与既有 `tool-host` 的集成

### 4.1 `RemoteToolHost`（消费方适配器）

实现既有 `tool-host` port 接口，作为本机 `AgentLoop` 可用的工具来源之一：

- 工具发现：从 Peer Manifest 的 `tools[]`（005 §3.2）读取对端工具，按 `discoverable=true` 且 `sides` 含当前角色纳入候选。
- 工具调用：把本地 `tool-host` 的 `execute(name, args)` 转为 `tools/call` Envelope 发给拥有方。
- 结果回传：解包 `ToolResult` 为既有 tool result 结构。

本机 `AgentLoop` 看到的远程工具与本地工具在 schema 层无差别（仅 `ownerDevice` 字段不同），既有 `SUBAGENT_READ_ONLY_TOOL_NAMES` 过滤机制对远程工具同样生效。

### 4.2 本机工具暴露（提供方）

- 按 Manifest `tools[]` 声明接受对端 `tools/call`。
- 收到调用后经本机 `tool-host` 执行（复用既有执行路径，含 `allowed_paths`、`readonly` 强制）。
- 高危（`riskLevel >= medium` 或 `requiresUserConfirm=true`）经既有 `approval-gate` 二次确认（006 §5）。

## 5. 方法：`tools/list`（request）

```
method: tools/list
params { ownerDeviceId string? }   // 省略=所有已配对 Peer 的工具聚合
result { tools ToolEntry[] }       // 与 Manifest 中 ToolEntry 同构
```

供消费方动态发现对端当前可用工具（Manifest 变更后也可主动 `manifest/changed`，见 005）。

## 6. 方法：`tools/call`（request）

```
method: tools/call
params {
  callId string                   // 调用 ID（ULID），用于幂等与进度关联
  ownerDeviceId string            // 工具拥有方
  name string                     // 工具名
  version string?                // 期望版本；缺省取最新兼容
  arguments object                // 入参，须匹配 inputSchema
  taskId string?                  // 关联 Task（协作层权限依据）
  idempotencyKey string           // 幂等键
  deadline ISO-8601?              // 调用截止时间（默认 30s）
}
result: ToolResult
```

### 6.1 `ToolResult`

| 字段 | 类型 | 说明 |
|---|---|---|
| `callId` | string | 对应请求。 |
| `status` | enum | `success` / `error` / `denied` / `timeout` / `truncated`。 |
| `output` | any | 工具输出，须匹配 `outputSchema`。 |
| `truncated` | boolean? | 是否因超限截断（006 §5 资源配额）。 |
| `error` | string? | 失败原因。 |
| `usage` | ResourceUsage? | 耗时/字节数。 |

### 6.2 幂等

拥有方维护 `idempotencyKey` → `ToolResult` 缓存（TTL 默认 5min）；重复调用直接返回缓存结果（网络重试场景）。

## 7. 执行流程（提供方）

1. 校验 Envelope 签名/会话 MAC（006 §4）。
2. 权限检查（006 §3.2）：工具在 `allowedTools`、风险不超 `maxRiskLevel`、`taskId` 在协作层范围。
3. 版本检查（005 §4.2）：不兼容则降级或 `-32008 protocol_incompatible`。
4. 参数校验：匹配 `inputSchema`（zod，与既有 `capabilities` 一致）；失败 `-32602 invalid_params`。
5. 高危检查：`riskLevel >= medium` 或 `requiresUserConfirm=true` → 经 `approval-gate` 弹窗；用户拒绝 → `status=denied`，审计 `tool_confirmation_denied`（006 §5）。
6. 路径校验（文件类）：参数中所有路径须匹配 `allowedPaths` glob；越界 `-32003 forbidden_path`。
7. 本地执行经既有 `tool-host`（含 `readonly` 强制、超时、大小上限）。
8. 回 `ToolResult`；审计 `tool_called`。

## 8. 流式工具（可选）

长时工具（如 `execute_code`、`computer_use`）支持进度：

```
method: tools/progress (notification)
params { callId string; seq int; event ProgressEvent }
```

`tools/call` 仍为 request，最终 `result` 在结束时返回。`deadline` 内无结果 → `status=timeout`。

## 9. 取消

```
method: tools/cancel (request)
params { callId string; idempotencyKey string }
result { cancelled boolean; partialResult ToolResult? }
```

拥有方中止本地执行，回 `partialResult`（若有）。幂等键避免重复取消。

## 10. 安全约束

- 远程工具调用受 006 §5 沙箱全部约束：风险级策略、路径白名单、只读强制、资源配额。
- `critical` 级工具强制逐次本地确认，不可被任何权限授予跳过。
- 远程调用产生的 `ToolResult` 进 Worker 的协作层；不含拥有方私有层数据（私有数据须经 `memory/query` 受控访问，见 004）。
- 限流（006 §6）：每 Peer `tools/call` 默认 30/min。

## 11. 与 Task 派发的关系

- Worker 执行 `task/run`（002）期间发 `task/progress` 的 `tool_call` event 应标注 `ownerDeviceId`：本地工具 vs 远程借用。
- 远程 `tools/call` 的租约**独立于 Task 租约**：单次调用有自身 `deadline`；不续 Task 心跳（但 Task 心跳照常由 Worker 发）。
- 远程工具调用失败若导致 Task 失败，映射到 `ChildRunResult.status=failed`（002 §12）。

## 12. 审计

入审计：`tool_list`、`tool_called`、`tool_confirmation_required`、`tool_confirmation_denied`、`tool_path_violation`、`tool_timeout`、`tool_cancelled`。每条含 `traceId`/`callId`/`taskId`/双方 deviceId/工具名/风险级（006 §8）。

## 13. 评审检查清单

- [ ] `RemoteToolHost` 是否实现既有 `tool-host` port 接口、对 AgentLoop 透明？
- [ ] 高危工具是否强制经 `approval-gate`、critical 不可跳过？
- [ ] 幂等键是否覆盖网络重试？
- [ ] 远程工具调用的租约是否独立于 Task 租约？
- [ ] 对称性是否成立（任一方均可消费/提供）？
