# QWicks Mesh — RFC 集

QWicks Mesh 是 QWicks Agent Runtime 的**可选**协同层：用户显式开启后，同局域网内安装 QWicks 的设备可互相发现、配对、派发 Agent 任务、借用彼此工具、回查彼此长期记忆。**未开启时，QWicks 现有架构与行为完全不变（opt-in 第一原则，见 000 §4）。**

本目录是 Mesh 的设计规范集（RFC），代码实现须在 RFC 通过后按 `writing-plans` 产出的实现计划进行。

## 文档

| RFC | 标题 | 核心内容 |
|---|---|---|
| [000](000_architecture.md) | 架构总纲 | opt-in 边界、模块结构、设备身份、传输与信封、权限三层、RFC 索引、可扩展性、关键决策 |
| [001](001_pairing_protocol.md) | 配对协议 | mDNS 发现、6 位配对码、X25519 ECDH、指纹人眼比对、信任持久化、解配对 |
| [002](002_task_dispatch.md) | 任务派发 | `task/run`、ChildRunInput↔wire 映射、进度流式、State Delta、与 `DelegationRuntime` 接缝 |
| [003](003_tool_rpc.md) | 远程工具调用 | `tools/call`、对称 `RemoteToolHost`、`approval-gate` 集成、沙箱 |
| [004](004_memory_rpc.md) | 远程记忆查询 | `memory/query`、拥有方权威、低敏缓存、private 临时授权 |
| [005](005_manifest.md) | 能力清单 | Manifest 结构、版本化提示词、算力画像、协商与变更通知 |
| [006](006_security.md) | 安全与审计 | 威胁模型、权限三层执行、签名/防重放/限流、沙箱、审计、撤销、密钥轮换 |
| [007](007_retry_and_lease.md) | 租约与重试 | lease/heartbeat、幂等、取消、掉线回收、provenance 循环检测 |
| [008](008_agent_roles.md) | Agent 角色与路由 | 对等联邦、单 Task 受限 Worker、路由策略、多设备/多模型/多 Agent 扩展 |

## 阅读顺序

依赖最优序：`000 → 005 → 001 → 006 → 007 → 002 → 003 → 004 → 008`。

## 与既有 QWicks 的关系

Mesh 是独立子系统 `qwicks/mesh/`，**仅通过既有接缝**接入，不修改既有内部实现：

- `DelegationRuntime.options.executors` —— 注册远程 executor（002 §3）
- `tool-host` port —— `RemoteToolHost` 适配器 + 本机工具暴露（003 §4）
- `approval-gate` port —— 高危远程工具二次确认（006 §5）
- `memory-store` —— 拥有方权威 + RPC 回查（004）
- `event-bus` / `runtime-event-recorder` / `usage-service` —— 复用既有 telemetry（000 §3）
- `auto-model-router` —— 注入 Peer 模型为路由候选（008 §6）

`mesh.enabled=false` 时以上一切不发生；主系统与未安装 Mesh 时逐字节等价。

## 状态

全部 RFC 当前为 `Draft — 待评审`。通过后进入实现计划（`writing-plans`）与编码。
