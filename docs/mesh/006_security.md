# RFC 006 — 安全与审计（Security & Audit）

| 字段 | 值 |
|---|---|
| RFC 编号 | 006 |
| 标题 | 威胁模型、权限、签名、审计、撤销 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000 |
| 被依赖 | 001, 002, 003, 004, 007 |

---

## 1. 目标

定义 Mesh 的威胁模型、信任域、权限三层（公开/协作/私有）的具体执行、消息签名与防重放、限流、远程工具调用沙箱、审计日志结构、密钥管理与撤销机制。本 RFC 是 001/002/003/004/007 的安全基线。

## 2. 威胁模型

### 2.1 假设

- 局域网**半可信**：存在被动嗅探者，可能存在未授权设备接入同一网络。
- 配对过的 Peer **可能被攻陷或出现 Bug**：本机不能无条件信任对端发起的任何高危动作。
- 本机用户**始终拥有最终决定权**：任何高危工具调用必须本地用户确认。

### 2.2 资产与对应保护

| 资产 | 保护手段 |
|---|---|
| 设备私钥（Ed25519 / X25519） | 仅存本机内存或 OS 密钥库；永不通过网络传输；进程隔离。 |
| 会话密钥 | 仅内存；每次 Session 重连重新 ECDH；进程退出即销毁。 |
| `peerTrustStore` | 仅本机可读写；不含私钥；解配对即置 `revokedAt`。 |
| 长期记忆 | 拥有方权威；对端只能经 `memory/query`（受权限三层约束）获取片段，不可全量拉取。 |
| 本机文件系统 | 文件类工具的 `allowedPaths` 白名单 + approval-gate；远程调用不得越界。 |
| 审计日志 | 仅追加（append-only）；仅本机可写；对端不可修改。 |

### 2.3 攻击与缓解

| 攻击 | 缓解 |
|---|---|
| 被动嗅探 | 会话密钥加密/MAC（§4）。 |
| 主动 MITM（配对期） | 6 位码 + 指纹人眼比对（001 §5.2）。 |
| 重放 | nonce 窗口 + 时间戳窗口（§4.3）。 |
| 伪造消息（冒充已配对设备） | 每条 Envelope 必须 Ed25519 签名 + 会话 MAC 双重验证（§4）。 |
| 越权工具调用 | 权限三层 + riskLevel + approval-gate + allowedPaths（§3, §5）。 |
| 拒绝服务 / 资源耗尽 | 限流（§6）+ Task 预算上限（既有 `maxParallel`/`maxChildRuns`）+ lease 超时回收（007）。 |
| 恶意 Peer 诱导 `rm -rf` | critical 级工具强制 `requiresUserConfirm=true`；本地用户可拒绝；沙箱路径白名单（§5）。 |
| 配对后 Peer 被攻陷 | 撤销（解配对，§7）+ 密钥轮换；撤销后对端签名立即失效。 |

## 3. 权限三层执行

### 3.1 分层（与 000 §9 一致）

| 层 | 默认对 Peer 可见 | 强制约束 |
|---|---|---|
| Public | 是 | 仅 Task 状态、Manifest、文件索引、算力画像。 |
| Collaboration | 仅在 Task 生命周期内 | 临时上下文片段、中间结论、该 Task 授权的工具结果；Task 结束即回收。 |
| Private | 否 | 个人长期记忆、敏感文件、密钥、未授权工具结果；须显式授权 + approval-gate 才暴露。 |

### 3.2 授予与检查点

- 授予存储在 `peerTrustStore.permissions`（001 §6），取本机策略与对端 `PermissionOffer`（005 §3.6）的交集。
- 检查点（每个跨设备方法必须先过权限检查）：
  - `task/run`：检查发起方是否有 `taskExecution` 权限 + 预算。
  - `tools/call`：检查工具是否在 `toolCall.allowedTools`、风险不超过 `maxRiskLevel`、路径在 `allowedPaths`。
  - `memory/query`：检查 `memoryQuery.allowed` + `scopes` 限定到 public/collaboration。
  - `resources/get`：检查 `resourceAccess.allowedUris`。

### 3.3 `trustLevel` 提升

- `standard`：默认；受限工具集、保守 `maxRiskLevel=low`。
- `elevated`：需本机用户在 UI 显式提升；放宽 `maxRiskLevel=medium`；`high`/`critical` 始终逐次确认。

## 4. 消息签名与信道

### 4.1 双重验证

每条 Envelope（000 §8.2）须同时通过：

1. **会话 MAC**：用 §4.2 的方向绑定密钥对 `payload || messageId || nonce || timestamp || taskId` 做 HMAC-SHA256，写入 `auth.sig`（alg=`hmac`）。
2. **设备签名**：发送方用自身 Ed25519 私钥对同一字段子集签名，写入 `auth.deviceSig`（alg=`ed25519`）。

设备签名用于跨重连的身份可问责（即使会话密钥泄露，旧消息无法被伪造新签名）；会话 MAC 用于实时完整性 + 防重放。

### 4.2 密钥派生

会话密钥由配对期 ECDH 派生（001 §5.3）：`sessionKeyMaterial[0..32]` = A→B MAC 密钥，`[32..64]` = B→A MAC 密钥。方向绑定防反射攻击。

### 4.3 防重放

- `nonce`：每 Session 内单调递增计数器 + 随机前缀；接收方维护滑动窗口（默认 1024 槽），窗口外或重复即拒绝并审计 `replay_rejected`。
- `timestamp`：与本地时钟偏差超 ±60s 拒绝（防时钟漂移导致的窗口绕过）。

### 4.4 大对象

超过阈值（默认 256KiB）的 payload 不直接放 Envelope，改用 `resources/put` + `resources/get` 引用 URI；引用同样签名。

## 5. 远程工具调用沙箱

（执行协议见 003；此处定义安全约束。）

| 风险级 | 远程调用策略 |
|---|---|
| none / low | 直接执行（若在 `allowedTools` 且 `maxRiskLevel` 允许）。 |
| medium | 需 `trustLevel=elevated` 且 `requiresUserConfirm` 按工具声明。 |
| high | 强制 `requiresUserConfirm=true`；本地弹窗逐次确认。 |
| critical | 强制 `requiresUserConfirm=true`；本地弹窗逐次确认；并强制 `allowedPaths`（文件类）或执行隔离（命令类）；不可被任何权限授予跳过。 |

- **路径白名单**：文件类工具调用参数中的路径必须全部匹配拥有方声明的 `allowedPaths` glob，否则拒绝并审计 `path_violation`。
- **只读强制**：`readonly=true` 的工具在拥有方执行时禁止任何写操作；执行器须校验。
- **资源配额**：单次工具调用的输出大小、执行时长有上限（默认 10MiB / 30s），超限截断或中止并审计。

## 6. 限流

| 维度 | 默认 |
|---|---|
| 每 Peer 总请求 | 100 req/min |
| `tools/call` 每 Peer | 30/min |
| `memory/query` 每 Peer | 60/min |
| `task/run` 并发 | 受 `taskExecution.maxConcurrent` 与全局 `maxParallel` 双重约束 |

超限返回 JSON-RPC error `-32001 rate_limited`，`retryAfter` 秒数。连续超限（5 次内 4 次）触发该 Peer 限流升级（窗口加倍）并审计 `rate_limit_exceeded`。

## 7. 撤销与密钥轮换

- **解配对**（001 §8）：置 `revokedAt`，关闭 Session，对端公钥失效。后续任何来自该 deviceId 的签名消息一律拒绝。
- **密钥轮换**：Ed25519 长期密钥建议每 90 天轮换；轮换时向所有已配对 Peer 推 `identity/rotated`（携带新公钥 + 旧公钥对新公钥的签名链），对端验证链后更新 `peerTrustStore.peerPublicKey`。轮换期间双密钥短暂并存（24h）以容忍在途消息。
- **会话密钥**：每条 Session 重连即重新 ECDH；单 Session 存活超 24h 主动重协商。

## 8. 审计日志

### 8.1 结构

每条审计记录：

| 字段 | 说明 |
|---|---|
| `auditId` | ULID。 |
| `traceId` | 跨设备追踪链。 |
| `taskId` | 关联 Task（若有）。 |
| `from` / `to` | 双方 deviceId。 |
| `kind` | 事件类型（见各 RFC）。 |
| `outcome` | `success` / `failure` / `denied` / `timeout`。 |
| `detail` | 结构化补充（拒绝原因、风险级、路径等）。 |
| `timestamp` | 本机时间。 |

### 8.2 存储与保护

- 仅追加（append-only）文件 + 索引（better-sqlite3，与既有数据隔离的独立库 `mesh-audit.db`）。
- 仅本机可写；对端无任何读写接口。
- 保留策略：默认 90 天滚动 + 关键事件（撤销、critical 工具调用、拒绝）永久保留。
- 每条跨设备动作必须产生审计；缺审计的动作视为未授权，拒绝执行。

## 9. 密钥与配置存储

- 设备 Ed25519/X25519 私钥：OS 密钥库优先（Windows Credential Manager / DPAPI），回退到本地受限文件（0600 权限）。
- `mesh-audit.db` 与 `peerTrustStore`：独立目录，与既有 QWicks 数据隔离，卸载 Mesh 不影响既有数据。

## 10. 错误码（JSON-RPC）

| code | message | 说明 |
|---|---|---|
| -32001 | `rate_limited` | 限流。 |
| -32002 | `unauthorized` | 未配对或权限不足。 |
| -32003 | `forbidden_path` | 路径越界。 |
| -32004 | `confirmation_required` | 需用户确认（高危）。 |
| -32005 | `confirmation_denied` | 用户拒绝。 |
| -32006 | `replay_detected` | 重放。 |
| -32007 | `lease_expired` | 租约过期。 |
| -32008 | `protocol_incompatible` | 版本不兼容。 |

## 11. 评审检查清单

- [ ] 威胁模型是否覆盖被动嗅探、MITM、攻陷 Peer、DoS？
- [ ] 权限三层的检查点是否覆盖所有跨设备方法？
- [ ] critical 工具是否强制逐次本地确认且不可被权限跳过？
- [ ] 审计是否仅本机可写、对端不可篡改？
- [ ] 撤销后旧签名是否立即失效？
- [ ] 密钥轮换是否有签名链且容忍在途消息？
