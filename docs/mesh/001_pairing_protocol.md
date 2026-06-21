# RFC 001 — 配对协议（Pairing Protocol）

| 字段 | 值 |
|---|---|
| RFC 编号 | 001 |
| 标题 | 设备发现与配对 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000 |
| 被依赖 | 002, 003, 004, 006, 008 |

---

## 1. 目标

定义同局域网内两台（及多台）开启 Mesh 的 QWicks 设备如何自动发现彼此、通过 6 位配对码确认意图、完成身份交换与 ECDH 派生会话密钥、持久化信任，以及如何解除配对。配对是后续一切跨设备交互的前置条件——未配对的设备之间不建立 Session、不交换 Manifest、不接受任何 `qwicks.*` 方法。

## 2. 非目标

- 不做跨子网/互联网发现（v1 仅同一广播域；非同广播域走手动 IP:Port 回退）。
- 不做配对的集中式目录（纯点对点）。
- 不定义会话期消息加密细节（信道安全算法见 006；本 RFC 只定义密钥如何派生与存取）。

## 3. 发现（Discovery）

### 3.1 mDNS 服务

Mesh 开启且 `discovery.enabled=true` 时，本机在 mDNS 上注册服务：

| 字段 | 值 |
|---|---|
| 服务类型 | `_qwicks._tcp` |
| 服务名 | `qwicks-<deviceId 前 8 字节>` |
| 端口 | `mesh.listenPort`（实际值） |
| TXT 记录 | 见下表 |

TXT 记录：

| 键 | 说明 |
|---|---|
| `dv` | `deviceId` |
| `fp` | 公钥指纹（000 §6.1，16 hex） |
| `pv` | `protocolVersion` |
| `dn` | `deviceName`（URL 编码） |
| `mn` | `manifestVersion`（便于发现端预判是否需重拉） |

### 3.2 发现行为

- 浏览 `_qwicks._tcp`，发现新服务即解析 TXT，记录到 `discoveredPeers`（内存表，非信任）。
- 自身广播周期默认 60s，TTL 75s；检测到地址冲突（同 deviceId 不同地址）时优先以新地址刷新。
- 同一 deviceId 只保留一条最新发现记录。

### 3.3 手动回退

`discovery.enabled=false` 时：UI 提供手动输入 `IP:Port` + 6 位配对码入口，直接进入 §5 的验证阶段。

## 4. 配对状态机

```
discovered ──(A 发起配对申请)──▶ pending_request
pending_request ──(B 接受)──▶ code_exchange
pending_request ──(B 拒绝 / 超时)──▶ rejected(终态)
code_exchange ──(码匹配 + 指纹一致)──▶ verifying
code_exchange ──(码不匹配 / 超时)──▶ rejected(终态)
verifying ──(ECDH + 签名验证通过)──▶ paired(终态，持久化)
verifying ──(签名/指纹不符)──▶ rejected(终态)
```

任意方可在终态前 `cancel`，转入 `rejected`。

## 5. 配对流程

角色：Initiator（发起方 A）、Responder（响应方 B）。任一方均可发起；为叙述清晰以下以 A 发起为例。

### 5.1 申请阶段（discovered → pending_request）

A 向 B 的 `mesh.listenPort` 发起 WebSocket 升级请求，首帧发 `pairing/hello`：

```
method: pairing/hello (request)
params {
  initiatorDeviceId string
  initiatorFingerprint string
  initiatorEphemeralPubX25519 string   // base64
  initiatorNonce string                // 32 字节随机，hex
  protocolVersion string
  proposedAt ISO-8601
}
result {
  accepted boolean
  responderDeviceId string?
  responderFingerprint string?
  responderEphemeralPubX25519 string?  // 仅 accepted=true 时
  responderNonce string?
  codeChallenge string?               // 见 5.2
  expiresAt ISO-8601?                  // 本状态有效期
}
```

B 收到后：
- 若 `mesh.enabled=false` 或 B 正忙（在途配对数达上限）→ `accepted=false`。
- 否则在 UI 弹出"设备 `<initiatorDeviceId 简称>` 请求配对"，等待用户点接受/拒绝。

### 5.2 配对码阶段（pending_request → code_exchange → verifying）

配对码用于（a）确认用户意图、（2）作为 ECDH 之外的带外认证因子防 MITM。

- **生成**：响应方 B（接受方）生成 6 位数字码 `pairingCode`（`000000`–`999999`，密码学安全随机），在本地 UI 显示，并设有效期 120s。
- **输入**：发起方 A 在 UI 输入码，发 `pairing/verify`：

```
method: pairing/verify (request)
params {
  initiatorDeviceId string
  responderDeviceId string
  code string                          // 6 位
  initiatorSignature string            // A 对 (hello.nonce || verify.code) 的 Ed25519 签名
}
result {
  verified boolean
  sessionKeyHint string?               // 派生密钥的 KDF info，便于双方对齐
  expiresAt ISO-8601?
}
```

- **码校验**：B 比对码。失败累计 3 次 → `rejected` 并审计 `pairing_code_mismatch`。
- **指纹人眼比对**：双方 UI 同时显示对方 `fingerprint` 前 8 hex，提示用户人工核对一致后继续。用户在双方各点"指纹一致"才推进到 `verifying`。

### 5.3 密钥派生（verifying → paired）

- 双方各持对端 X25519 临时公钥与自身私钥，执行 X25519 ECDH 得共享秘密 `Z`。
- 派生会话密钥材料：

```
sessionKeyMaterial = HKDF-SHA256(
  ikm = Z,
  salt = pairingCode || initiatorNonce || responderNonce,
  info = "qwicks-mesh-v1" || min(initiatorDeviceId,responderDeviceId) || max(...),
  length = 64   // 前 32B = tx/mac key A→B；后 32B = tx/mac key B→A（方向绑定）
)
```

- 双向 Ed25519 签名验证：A 签 `(hello.nonce || verify.code)`、B 签 `(verify.result.verified || responderNonce)`；交换验证通过后进入 `paired`。
- 派生结果**不持久化**为会话密钥（会话密钥每次重连重新 ECDH；持久化的是对端 Ed25519 公钥，见 §6）。

### 5.4 终态

`paired`：双方持久化 Peer 记录（§6），关闭配对 WebSocket（若与业务 Session 不同），随后按 000 §5.2 启动正常 Session 并交换 Manifest（005）。

## 6. 信任持久化

配对成功后写入本地 `peerTrustStore`（仅本机可读，见 006）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `peerDeviceId` | string | 对端永久 ID。 |
| `peerDeviceName` | string | 对端显示名。 |
| `peerPublicKey` | Ed25519 public (base64) | 用于会话期验签。 |
| `peerFingerprint` | string | 用于重连时快速核对。 |
| `pairedAt` | ISO-8601 | 首次配对时间。 |
| `lastSeenAt` | ISO-8601 | 最近一次活跃。 |
| `trustLevel` | enum | `standard` / `elevated`。 |
| `permissions` | object | 授予项（细化见 006），初始取对端 `PermissionOffer` 与本机策略的交集。 |
| `revokedAt` | ISO-8601? | 解配时间。 |

## 7. 重连

- `autoAcceptKnownPeers=true` 时：发现已在 `peerTrustStore` 且未 revoke 的 deviceId → 跳过配对码，直接用持久化的对端公钥做重连握手（仍需新一轮 ECDH 派生会话密钥 + 签名验证）。
- 重连握手按 000 §8.3 的信道安全机制完成（持久 Ed25519 公钥验签 + 新一轮 X25519 ECDH + nonce 窗口重置）；不重新生成配对码。
- 重连失败累计上限（默认 5 次/10 分钟）→ 暂停自动重连，等待用户手动操作或下次发现周期。

## 8. 解除配对（Unpair）

任一方可发起解配对：

1. 本地将 Peer 记录置 `revokedAt`，从活跃信任集移除。
2. 对在途 Task 发 `task/cancel`（见 007）。
3. 关闭与该 Peer 的 Session。
4. 向对端发 `pairing/revoke` 通知（best-effort；对端离线则其下次重连握手因公钥已失效而被拒）。
5. 对端收到后同步置 `revokedAt`。
6. 审计 `pairing_revoked`。

解配对不可撤销；如需再次配对须重新走 §5 完整流程。

## 9. 多设备语义

- `peerTrustStore` 可含 N 条；每个 Peer 独立 Session。
- 同一发起方可并发与多个响应方配对，但单次配对码仅绑定一对 deviceId。
- 配对码不跨设备复用；每次配对生成新码。

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| hello 超时（30s 无接受） | A 端 `pending_request` → 超时关闭，审计 `pairing_hello_timeout`。 |
| 码超时（120s 未输入） | B 端码失效，`code_exchange` → `rejected`，审计 `pairing_code_timeout`。 |
| 指纹不一致 | 用户应拒绝；若强行推进且签名验证失败 → `rejected`，审计 `pairing_fingerprint_mismatch`。 |
| 协议版本不兼容 | hello 阶段 `accepted=false` 并附 `reason: "incompatible_protocol"`。 |
| 重复配对（已存在且未 revoke） | hello 阶段直接走 §7 重连，不重新生成码。 |

## 11. 安全约束

- 配对码 6 位 + 120s 有效期 + 3 次失败锁定：暴力枚举在窗口内最多 3 次，结合 ECDH 与签名，被动嗅探者无法完成配对。
- 人工指纹比对是防 MITM 的关键一环；UI 必须强制展示并要求双方确认。
- `pairing/hello` 与 `pairing/verify` 在信道加密建立前传输，但仅含公钥与 nonce（非敏感）；敏感数据在会话密钥建立后才传输。

## 12. 审计

入审计事件：`pairing_hello`、`pairing_accepted`、`pairing_rejected`、`pairing_code_mismatch`、`pairing_fingerprint_mismatch`、`pairing_completed`、`pairing_revoked`、`pairing_resumed`。每条含 `traceId`、双方 deviceId、时间戳、原因（失败时）。

## 13. 评审检查清单

- [ ] 6 位码 + ECDH + 指纹人眼比对是否满足防 MITM？
- [ ] 重连是否复用持久公钥而无需重新输码？
- [ ] 解配对是否清理在途 Task 与 Session？
- [ ] 多设备并发配对是否互不干扰？
- [ ] 手动 IP:Port 回退路径是否与自动发现等价安全？
