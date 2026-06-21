# RFC 000 — QWicks Mesh 架构总纲

| 字段 | 值 |
|---|---|
| RFC 编号 | 000 |
| 标题 | QWicks Mesh 架构总纲 |
| 状态 | Draft — 待评审 |
| 作者 | QWicks |
| 创建日期 | 2026-06-22 |
| 依赖 | 无（本文件是其它 RFC 的根） |
| 被依赖 | 001–008 全部 |

---

## 0. 摘要

QWicks Mesh 是 QWicks Agent Runtime 的一个**可选协同层**：在用户显式开启后，同一局域网内安装了 QWicks 的设备可互相发现、配对，并在设备之间派发 Agent 任务、借用彼此的工具、回查彼此的长期记忆。本 RFC 定义 Mesh 的整体架构、模块边界、传输与消息信封、安全与权限基线、RFC 索引与依赖关系，以及向多设备 / 多模型 / 多 Agent 扩展的设计原则。它不定义任何单一子系统的完整协议细节——这些由 001–008 各自承担。

本 RFC 是 001–008 的根，所有子 RFC 必须与本文一致；冲突时以本 RFC 第 4 节（opt-in 边界）与第 11 节（关键决策）为准。

---

## 1. 目标与非目标

### 1.1 目标

1. **零侵入 opt-in**：用户未开启时，QWicks 现有架构、现有行为、现有性能特征完全不变；Mesh 代码不启动、不注册路由、不监听端口、不广播、不向 `DelegationRuntime` 注入任何 executor。
2. **局域网自动发现**：同局域网内两台（及多台）开启 Mesh 的 QWicks 实例自动互相发现，并向用户发起配对申请。
3. **任务级协同**：设备 A 可将一个 Agent 子任务派发给配对设备 B，B 本地跑完后将结果回传，A 合并状态继续。复用 QWicks 既有的 `DelegationRuntime` 预算、并发、状态机、telemetry。
4. **能力对称**：每台设备既是委派方（Orchestrator）又是执行方（Worker），可同时扮演两种角色；对端可调用本机工具，本机亦可调用对端工具。
5. **记忆/上下文/工具三层分离共享**：按各自特性分别建模（见第 7 节），而非整段 prompt 透传。
6. **生产级可靠性**：租约、心跳、幂等、取消、断线回收、审计。
7. **可扩展**：从 2 台平滑扩展到 N 台；从单模型扩展到多模型路由；从单 child 扩展到多 Agent fan-out。

### 1.2 非目标

- 不做跨广域网 / 互联网中继（v1 仅局域网；NAT 穿透与公网 relay 不在本 RFC 集范围）。
- 不做云端集中式控制面 / 注册中心（纯对等 mesh，无 broker）。
- 不替换 QWicks 既有的本地 Agent loop、本地记忆存储、本地工具宿主；Mesh 只在其之上增加跨设备通道。
- 不引入新的 LLM provider 集成；Mesh 复用各设备已配置好的模型。
- 不做端到端加密的强敌手模型（假定局域网半可信、被动嗅探者存在；详见 006 的威胁模型与边界）。

---

## 2. 术语

| 术语 | 定义 |
|---|---|
| Node / 设备节点 | 一台运行 QWicks 且开启了 Mesh 的设备。 |
| Peer | 已与本机配对、建立信任的另一台 Node。 |
| Pairing | 两个 Node 之间通过配对码确认意图、交换身份并建立信任的一次性流程。 |
| Session | 两个 Peer 之间一条已鉴权、已加密的持久 WebSocket 连接及其状态。 |
| Manifest | 一个 Node 向 Peer 暴露的能力清单（模型、工具、提示词模板、资源、算力画像）。 |
| Task | 一次跨设备委派的工作单元，对应 `DelegationRuntime` 的一次 `runChild`。 |
| Lease | Task 的执行租约：Worker 必须在租期内心跳续约，否则 Orchestrator 回收。 |
| Orchestrator | 在某次 Task 中作为委派方的 Node。 |
| Worker | 在某次 Task 中作为执行方的 Node。同一 Node 可同时是另一些 Task 的 Orchestrator。 |
| Envelope | 所有跨设备消息的统一外层封装（见第 8 节）。 |
| Permission Tier | 资源可见性分层：公开 / 协作 / 私有（见第 9 节）。 |

---

## 3. 现状基线（QWicks 已有能力，Mesh 直接复用）

Mesh 不重造以下能力，而是通过既有接缝接入：

| 能力 | 既有实现 | Mesh 复用方式 |
|---|---|---|
| 子任务状态机（queued→running→completed/failed/aborted） | `DelegationRuntime` / `ChildRunRecord` | Mesh 的远程执行只是一个新的 `executor` 实现，状态机不变。 |
| 并发上限 / 队列 / 每 thread 预算 | `maxParallel` / `maxChildRuns` / FIFO slot | 远程 Task 与本地 child 共用同一预算池。 |
| 工具能力声明与授权范围 | `SubagentToolPolicy`（`readOnly` / `inherit`）/ `SUBAGENT_READ_ONLY_TOOL_NAMES` | Manifest 沿用同一 policy 语义；远程工具调用复用同一过滤机制。 |
| 高危操作人工确认 | `approval-gate` port / `approvals` contract / `InMemoryApprovalGate` | 远端发起的工具调用经同一 approval-gate 二次确认。 |
| 上下文压缩与 prefix 缓存 | `ContextCompactor` / `prefixReused` / `inheritedHistoryItems` | 跨设备派发时保 prefix 字节一致以命中对端 provider 的 prompt cache。 |
| 模型路由 | `auto-model-router` / `model-context-profile` | 路由器可把 Manifest 中的对端模型纳入候选。 |
| 事件 / 审计 / 用量 | `runtime-event-recorder` / `usage-service` / `aggregateChildRuns` | 跨设备 Task 与工具调用都走同一 telemetry。 |
| 本地长期记忆 | `memory-store` / `better-sqlite3` | 作为记忆权威源，向 Peer 提供 RPC 查询。 |
| HTTP/SSE 本地服务端 | `server/`（routes: sessions/threads/turns/memory/...） | Mesh 监听独立端口；不复用既有 HTTP route 表，避免与本地 API 耦合。 |

---

## 4. Opt-in 边界（第一原则）

### 4.1 配置开关

Mesh 由一个布尔配置项控制：

| 配置键 | 类型 | 默认 | 作用 |
|---|---|---|---|
| `mesh.enabled` | boolean | `false` | 总开关。`false` 时下述一切不发生。 |
| `mesh.listenPort` | int | 0（随机） | Mesh 监听端口；0 表示由 OS 分配，通过 mDNS 广播实际端口。 |
| `mesh.deviceName` | string | 主机名 | 对外显示名。 |
| `mesh.discovery.enabled` | boolean | `true` | 仅在 `mesh.enabled=true` 时生效；可单独关闭自动发现以纯手动输入地址配对。 |
| `mesh.autoAcceptKnownPeers` | boolean | `false` | 对已配对过的 Peer 是否自动重连；不等于自动接受新配对。 |

`mesh.enabled=false` 是**硬保证**：Mesh 子系统不实例化、不注册任何启动钩子、不向 `DelegationRuntime.options.executors` 注入远程 executor、不打开 socket、不调用 mDNS。既有 Agent loop 的行为与未安装 Mesh 时逐字节等价。

### 4.2 运行时关闭

用户在运行中将 `mesh.enabled` 翻为 `false` 时：Mesh 子系统执行优雅关闭——
1. 停止接受新 Task / 新连接；
2. 对在途远程 Task 发送 `cancel`（见 007）并等待确认或租约超时；
3. 关闭所有 Session；
4. 注销 mDNS 服务；
5. 从 `DelegationRuntime` 的 executor 池移除远程 executor。

关闭完成后，主系统回到与从未开启过 Mesh 等价的状态。

### 4.3 升级与回滚

Mesh 的所有持久状态（信任集、配对记录、审计日志）存放在独立目录，与既有 QWicks 数据隔离；卸载 Mesh 或回滚版本不影响既有数据。

---

## 5. 模块边界与目录结构

Mesh 是 QWicks 内一个**自包含子系统**，建议落点为新顶层目录 `qwicks/mesh/`（与 `loop/` `server/` `adapters/` 同级），仅通过以下既有接口与主系统交互，不修改它们的内部实现：

```
qwicks/mesh/
├── contracts/        # Mesh 专属 zod schema：DeviceId, Manifest, TaskEnvelope, ToolCallRequest, ...
├── identity/         # 设备密钥对、deviceId、fingerprint
├── discovery/        # mDNS 广播与监听
├── pairing/          # 配对码、ECDH、信任建立与持久化（→ 001）
├── transport/        # WebSocket 服务端/客户端、JSON-RPC 编解码、Session 生命周期（→ 000 §8, 006）
├── envelope/         # 消息信封、签名、验签、replay 防护（→ 000 §8, 006）
├── manifest/         # Manifest 生成、缓存、协商、变更通知（→ 005）
├── dispatch/         # 远程 executor：把 ChildRunInput 编为 wire payload、调用对端、解包结果（→ 002）
├── remote-tool/      # 远程 tool host 适配器 + 本机工具对外暴露（→ 003）
├── remote-memory/    # 远程记忆查询客户端 + 本机记忆对外查询服务端（→ 004）
├── lease/            # 租约、心跳、幂等去重、取消、回收（→ 007）
├── roles/            # Orchestrator/Worker 角色与路由策略（→ 008）
├── audit/            # 跨设备动作审计日志（→ 006）
├── config/           # Mesh 配置加载/校验/热更新
└── index.ts          # 对外唯一入口：bootMesh(config, deps) / shutdownMesh()
```

### 5.1 接入点（仅这些与主系统相接）

| 主系统接缝 | Mesh 接入方式 | 方向 |
|---|---|---|
| `DelegationRuntime.options.executors` | 注册一个 `remote` executor；路由器按 manifest/算力选择 local 或 remote | 主→Mesh |
| `tool-host` port | 增加一个 `RemoteToolHost` 适配器（调用 Peer 工具）；同时把本机工具按 Manifest 暴露给 Peer | 双向 |
| `approval-gate` port | 远端发起的高危工具调用经同一 gate | Mesh→主 |
| `memory-store` | 远程查询客户端在本地 miss 时回查 Peer 的 memory-store | 双向 |
| `event-bus` / `runtime-event-recorder` | 跨设备事件按既有 event schema 记录 | Mesh→主 |
| `auto-model-router` | 注入 Peer 模型作为路由候选 | Mesh→主 |
| 配置系统 | `mesh.*` 配置项 | 主→Mesh |

### 5.2 启动顺序

`bootMesh` 在 QWicks 主 runtime 启动后、且 `mesh.enabled=true` 时执行：

1. 加载/生成设备身份（`identity/`）。
2. 读取信任集（`pairing/`）。
3. 启动传输层监听（`transport/`），监听 `mesh.listenPort`。
4. 启动 mDNS 广播与监听（`discovery/`）。
5. 对已知 Peer 发起重连（`transport/`，`autoAcceptKnownPeers` 控制）。
6. 向 `DelegationRuntime` 注册远程 executor，向 `auto-model-router` 注入 Peer 模型。
7. 记录 `mesh_started` 事件。

任一步失败：Mesh 回退到关闭态，主系统不受影响。

---

## 6. 核心概念模型

### 6.1 设备身份

每个 QWicks 安装在首次开启 Mesh 时生成永久身份：

| 字段 | 类型 | 说明 |
|---|---|---|
| `deviceId` | string (ULID) | 永久标识，跨重启不变；存于本地配置。 |
| `deviceName` | string | 用户可改的显示名。 |
| `deviceKeyPair` | Ed25519 | 签名密钥对；私钥不出本机，公钥用于验签。 |
| `deviceEphemeralKey` | X25519 | 用于配对时的 ECDH，可周期性轮换。 |
| `fingerprint` | string | 公钥的 SHA-256 摘要前 16 字节 hex；配对时人眼比对用。 |

`deviceId` + 公钥即设备身份；指纹用于配对防中间人（见 001）。

### 6.2 Peer 与信任集

已配对的 Peer 记录（持久化于本地，仅本机可读）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `peerDeviceId` | string | 对端永久 ID。 |
| `peerDeviceName` | string | 对端显示名（可被对端改名通知刷新）。 |
| `peerPublicKey` | Ed25519 public | 验证对端消息签名。 |
| `pairedAt` | ISO-8601 | 首次配对时间。 |
| `trustLevel` | enum | `standard` / `elevated`（elevated 允许更宽工具范围，需用户显式提升）。 |
| `permissions` | object | 三层权限的具体授予项（见第 9 节）。 |
| `revokedAt` | ISO-8601? | 解除配对时间。 |

### 6.3 Session

两个 Peer 之间最多一条活跃 Session（重连以新换旧）。Session 承载：

- 已加密的 WebSocket 连接；
- 双方最近一次 Manifest 的缓存；
- 在途 Task 表（用于断线回收）；
- 下一条 JSON-RPC 请求/通知的序号与 nonce 窗口。

### 6.4 Manifest（详见 005）

每个 Node 暴露的对外能力清单，按结构化字段声明：模型列表、工具列表（含 schema / risk_level / requires_user_confirm / allowed_paths / rate_limit / version / owner_device）、版本化提示词模板、资源 URI、算力画像。配对成功后立即交换，变更时推送 `manifest/changed` 通知。

### 6.5 Task

一次跨设备委派 = 一次 `DelegationRuntime.runChild` 选中 remote executor：

| 字段 | 说明 |
|---|---|
| `task_id` | 本 Task 唯一 ID。 |
| `parent_task_id` | 父 Task ID（支持多级 fan-out）。 |
| `parent_device_id` | Orchestrator 的 deviceId。 |
| `worker_device_id` | Worker 的 deviceId。 |
| `lease_timeout` | 租约时长（见 007）。 |
| `retry_count` / `max_retries` | 重试计数与上限。 |
| `idempotency_key` | 幂等键，Worker 据此去重。 |
| `cancel_token` | 取消令牌。 |
| `provenance` | 任务来源链（用于审计与循环检测）。 |
| `payload` | ChildRunInput 的 wire 表示（见 002）。 |

---

## 7. 三层共享模型

按特性分别建模，而非整段 prompt 透传：

### 7.1 记忆共享（→ 004）

- **长期记忆**：拥有方为权威源。Peer 通过 `memory/query` RPC 回查，拥有方检索后返回 Top-K 文本片段 + 元数据。可选本地缓存高频/低敏摘要（TTL + 失效）。
- **短期上下文**：随 Task 流转，编入 `payload`。

### 7.2 上下文与状态共享（→ 002）

- Task payload 携带：prompt、workspace 引用、目标模型、profile、toolPolicy、system prompt 层叠、历史增量（Delta）。
- Worker 执行完返回 State Delta（增量变化），Orchestrator 合并，继续下一步。单向状态机（A→B→A），不引入 CRDT。

### 7.3 工具与提示词共享（→ 003 / 005）

- **能力宣告**：Manifest 声明每个工具的 schema、risk_level、requires_user_confirm、allowed_paths、rate_limit、owner_device、version。
- **提示词**：版本化模板（全局基础 / 任务 / 设备 / 工具四层叠，各带 version + scope），按需发现与参数化，不整段同步。
- **远程工具调用**：Worker 缺某工具时，发 `tools/call` 给拥有方；拥有方本地执行（经 approval-gate）后回 `ToolResult`。

---

## 8. 传输与消息信封

### 8.1 传输层

- **协议**：WebSocket over TCP（`ws://` 局域网；信道加密在 8.3）。
- **选型理由**：Task 执行中 Worker 需要反向调用 Orchestrator 的工具（B→A）、需要流式回传进度、需要双向取消——这些都需要全双工通道。HTTP 请求/响应无法干净支持 B→A 中途调用。
- **承载格式**：JSON-RPC 2.0（请求 / 响应 / 通知三类帧）。所有 Mesh 方法在 `qwicks.*` 命名空间下。
- **端口**：`mesh.listenPort`；0 表示 OS 分配，实际端口随 mDNS TXT 记录广播。
- **连接策略**：每对 Peer 一条持久连接；任一端检测到对端断开按 007 处理在途 Task。

### 8.2 消息信封

所有 JSON-RPC 消息外层包裹统一 Envelope，用于鉴权、路由、防重放、审计：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | string | 是 | 信封版本，当前 `"1"`。 |
| `from` | string | 是 | 发送方 deviceId。 |
| `to` | string | 是 | 接收方 deviceId。 |
| `messageId` | string (ULID) | 是 | 单条消息 ID。 |
| `correlationId` | string? | 否 | 对应 JSON-RPC `id`；用于请求/响应配对。 |
| `taskId` | string? | 否 | 关联 Task（任务相关消息必填）。 |
| `traceId` | string | 是 | 跨设备追踪链，便于审计串联。 |
| `timestamp` | ISO-8601 | 是 | 发送时间。 |
| `nonce` | string | 是 | 单调计数器或随机数，用于 replay 防护。 |
| `kind` | string | 是 | JSON-RPC 方法名（如 `task/run`, `tools/call`, `memory/query`）。 |
| `payload` | object | 是 | JSON-RPC `params` / `result`。 |
| `auth` | object | 是 | `{alg, sig, deviceSig}`：`sig`=会话 HMAC-SHA256，`deviceSig`=发送方 Ed25519 签名。双重验证，详见 006 §4.1。 |

`auth` 的覆盖范围与算法细节见 006 §4。

### 8.3 信道安全

- **配对期**：6 位配对码确认意图 + 人眼比对指纹防 MITM；X25519 ECDH 派生会话密钥。详见 001。
- **会话期**：每条 Session 用派生密钥做 MAC（或采用 Noise 协议套件 `Noise_XX` 完成）；所有 Envelope 必须携带有效 `auth`。
- **重放防护**：接收方维护每 Peer 的 nonce 窗口，拒绝窗口外或重复 nonce。
- **备选**：TLS + 自签证书 + 指纹 pinning。本 RFC 集采用上述会话密钥方案（无需证书签发基础设施，配对码已提供带外认证）。详见 006 的权衡。

---

## 9. 权限三层（贯穿 002–006）

| 层 | 可见对象 | 默认对 Peer 可见 | 说明 |
|---|---|---|---|
| 公开层 (Public) | 任务状态、项目文件索引、Manifest、设备算力画像 | 是 | 所有配对 Peer 可读。 |
| 协作层 (Collaboration) | 某 Task 链内共享的上下文片段、临时变量、中间结论、该 Task 授权的工具结果 | 仅在该 Task 生命周期内 | Task 结束即收回。 |
| 私有层 (Private) | 本机个人长期记忆、敏感文件、密钥、未授权工具结果 | 否 | 仅在显式授权（且经 approval-gate）后按最小范围暴露。 |

权限粒度在 Peer 记录的 `permissions` 中具体授予；详见 006。

---

## 10. 端到端控制流与数据流

```
[发现]        mDNS 广播/监听 (001)
   │
   ▼
[配对]        6 位码确认 → ECDH → 派生会话密钥 → 持久化 Peer 信任 (001)
   │
   ▼
[建链]        WebSocket + Envelope 鉴权 (000 §8, 006)
   │
   ▼
[能力交换]    双向发送 Manifest (005)；auto-model-router 纳入 Peer 模型
   │
   ▼
[派发]        A 的 DelegationRuntime 选 remote executor (002)
   │          → task/run Envelope → B
   ▼
[执行]        B 本地 createChildAgentExecutor 跑 (复用既有 loop)
   │          ├─ 进度通知流式回传 (002)
   │          ├─ 需要 A 才有的工具 → tools/call 回 A (003) → approval-gate → ToolResult
   │          └─ 需要长期记忆 → memory/query 回 A (004)
   ▼
[租约]        B 周期性心跳续约；A 监控 (007)
   ▼
[回包]        B 返回 ChildRunResult + State Delta (002)
   ▼
[合并]        A 的 DelegationRuntime 合并结果、记 telemetry/usage/audit
   ▼
[断线/超时]   007 处理：取消/回收/重试/接管
```

---

## 11. 关键决策（带备选与理由）

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | Mesh 为独立子系统 `qwicks/mesh/`，仅通过既有接缝接入 | 在既有 loop/server 内加分支 | 满足"零侵入 opt-in"：`enabled=false` 时主系统无任何改动。 |
| D2 | 传输 = WebSocket + JSON-RPC 2.0 | HTTP 请求/响应 | 需全双工（B→A 工具回查、流式进度、双向取消）。 |
| D3 | 发现 = mDNS (`_qwicks._tcp`) | 纯手动 IP:Port | 用户要求自动发现；mDNS 是局域网标准。保留手动输入作为发现关闭时的回退。 |
| D4 | 身份 = Ed25519 签名密钥对 + X25519 ECDH 配对 | 仅配对码 | 配对码只能认证一次；签名密钥用于会话期所有消息验签与防伪。 |
| D5 | 信道安全 = 会话密钥 MAC（Noise_XX 风格） | TLS + 自签证书 pinning | 无需 PKI；配对码提供带外认证即可安全完成 ECDH。详见 006。 |
| D6 | 记忆 = 拥有方权威 + RPC 回查 + 可选低敏摘要缓存 | 全量同步 | 隐私与带宽；摘要缓存限定低敏且带 TTL。详见 004。 |
| D7 | Agent 模型 = 对等联邦 mesh；单 Task 内 Worker 为受限纯执行方 | 主从控制式 | 对等避免"谁控制谁"；单 Task 受限保证不越权。详见 008。 |
| D8 | 远程 Task 复用 `DelegationRuntime` 预算/状态机/telemetry | 独立任务子系统 | 已有实现成熟；远程仅是另一种 executor。 |
| D9 | 监听独立端口，不复用既有 HTTP route | 复用既有 server/routes | 避免与本地 API 耦合与权限混淆。 |
| D10 | 单向状态机（A→B→A），不引入 CRDT | CRDT | Agent 任务流为单委派者模型；CRDT 复杂度无收益。 |

---

## 12. RFC 索引与依赖

| RFC | 标题 | 范围 | 依赖 |
|---|---|---|---|
| 000 | 架构总纲 | 本文件 | — |
| 001 | 配对协议 | mDNS 发现、6 位配对码、ECDH、信任建立与持久化、解配对 | 000 |
| 002 | 任务派发协议 | `task/run` 方法、ChildRunInput↔wire 映射、进度通知、State Delta、ChildRunResult 回包 | 000, 005, 007 |
| 003 | 远程工具调用 | `tools/call`、对称远程 tool host、approval-gate 集成、结果回传 | 000, 005, 006 |
| 004 | 远程记忆查询 | `memory/query`、拥有方权威、低敏摘要缓存、权限三层 | 000, 006 |
| 005 | 能力清单 | Manifest 结构、协商、版本化提示词模板、算力画像、变更通知 | 000 |
| 006 | 安全与审计 | 威胁模型、权限三层细化、签名/replay/限流、沙箱、审计、撤销 | 000 |
| 007 | 租约与重试 | lease/heartbeat、idempotency、cancel、reclaim、provenance、断线恢复 | 000, 002 |
| 008 | Agent 角色与路由 | 对等联邦、单 Task 受限 Worker、路由策略、多设备/多模型/多 Agent 扩展 | 000, 002, 005 |

阅读顺序建议：000 → 005 → 001 → 006 → 007 → 002 → 003 → 004 → 008。

---

## 13. 跨切面关注点

### 13.1 Telemetry / 审计

所有跨设备动作（配对、Task 派发/回包、工具调用、记忆查询、取消、回收、解配对）按既有 event schema 记录到本地审计存储（`mesh/audit/`），字段至少含 `traceId` / `taskId` / `from` / `to` / `kind` / `timestamp` / `outcome`。审计日志仅本机可读，不可被 Peer 修改。

### 13.2 配置与热更新

`mesh.*` 配置支持运行时热更新；`enabled` 翻转触发第 4.2 节的优雅启停。其余字段（deviceName、listenPort、discovery）变更在下一连接/广播周期生效。

### 13.3 版本与兼容

- Envelope `version` 字段用于协议版本协商。
- 每条方法带 `method` 版本（如 `task/run@1`）；Peer 双方取共同最高版本。
- Manifest 带工具与提示词 `version`；不兼容版本降级处理。

---

## 14. 可扩展性

### 14.1 多设备

- 身份与信任以 deviceId 为单位，天然支持 N 个 Peer。
- 一个 Orchestrator 可对多个 Worker fan-out（`maxParallel` 控制并发）。
- 路由策略（008）按算力/模型/负载选择目标 Worker。

### 14.2 多模型

- Manifest 暴露每台设备的可用模型与算力画像。
- `auto-model-router` 把 Peer 模型纳入候选；Task 可指定 `model` 或交由路由器决定。

### 14.3 多 Agent

- 一个 Task 可在 Worker 侧再 spawn 子 Task（`parent_task_id` 形成链）。
- `provenance` 用于循环检测（防止 A→B→A 无限递归）；同一 `traceId` 内禁止回到已参与的 deviceId。
- 多个 Orchestrator 可并发向同一 Worker 派发；Worker 侧预算与队列独立管理。

---

## 15. 开放问题（留待子 RFC 或后续版本）

1. 局域网外（VPN/同子网不同广播域）的发现回退策略——v1 仅支持手动 IP:Port。
2. 资源（文件、图片）大对象传输——走引用 URI 还是在线传输；v1 倾向引用 + 按需拉取。
3. 审计日志的跨设备聚合视图——v1 仅本机可读。
4. 多 Owner 同一资源的写冲突——v1 限定拥有方写、它方只读。

---

## 16. 词汇表

见第 2 节。其它专有术语在各子 RFC 首次出现处定义。

---

## 17. 评审检查清单（供 reviewer）

- [ ] 第 4 节 opt-in 边界是否满足"零侵入"硬要求？
- [ ] 第 5.1 节接入点是否只通过既有接缝、不修改既有内部实现？
- [ ] 第 8 节传输与信封是否覆盖全双工、签名、防重放需求？
- [ ] 第 9 节权限三层是否覆盖隐私与最小暴露？
- [ ] 第 11 节各决策的备选与理由是否成立？
- [ ] 第 12 节 RFC 划分是否无重叠、无遗漏？
