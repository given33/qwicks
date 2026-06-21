# RFC 004 — 远程记忆查询（Memory RPC）

| 字段 | 值 |
|---|---|
| RFC 编号 | 004 |
| 标题 | 长期记忆的拥有方权威查询与低敏缓存 |
| 状态 | Draft — 待评审 |
| 创建日期 | 2026-06-22 |
| 依赖 | 000, 006 |
| 被依赖 | 002, 008 |

---

## 1. 目标

定义跨设备长期记忆访问：Worker 在执行 Task 时若需要 Orchestrator（或其它 Peer）的长期记忆，经 `memory/query` 回查拥有方；拥有方为权威源，本地不做全量同步，仅可选缓存高频/低敏摘要。本 RFC 落实 000 §7.1 的"源头权威 + 本地缓存 + 增量摘要"原则。

## 2. 非目标

- 不定义记忆的存储与检索算法（复用既有 `memory-store` / `better-sqlite3` / 向量索引）。
- 不做全量知识库同步（隐私与带宽，000 D6）。
- 不定义短期上下文共享（随 Task 流转，见 002 `historyDelta`）。
- 不让对端写入拥有方记忆（v1 拥有方写、它方只读）。

## 3. 拥有方权威

- 长期记忆的权威源 = 创建/拥有它的设备。
- 对端只能经 `memory/query` 获取**片段**（Top-K），不可枚举、不可全量拉取、不可写入。
- 写入仍由拥有方本地 Agent loop 自主完成；跨设备不产生写。

## 4. 权限三层（与 006 §3 一致）

| 层 | 可查询性 |
|---|---|
| Public | 默认可查（项目索引、公开知识）。 |
| Collaboration | 仅在关联 Task 生命周期内可查（按 `taskId` 限定 scope）。 |
| Private | 不可查，除非拥有方显式授权 + approval-gate 确认（单次或带 TTL 的临时授权）。 |

查询请求必须声明 `scopes`（`["public"]` / `["public","collaboration"]`）；`private` 须带 `grantToken`（拥有方预先签发的临时授权）。

## 5. 方法：`memory/query`（request）

```
method: memory/query
params {
  queryId string                 // 查询 ID（ULID），用于幂等
  ownerDeviceId string           // 记忆拥有方
  query string                   // 自然语言查询文本（拥有方做向量化）
  topK int                       // 返回片段数，上限受 PermissionOffer.memoryQuery.maxTopK 约束
  scopes string[]                // ["public"] / ["public","collaboration"] / 含 "private" 需 grantToken
  taskId string?                 // collaboration scope 必填
  metadataFilter object?         // 按元数据过滤（标签、时间范围、来源等）
  grantToken string?             // private scope 必填
  deadline ISO-8601?             // 默认 15s
}
result: MemoryQueryResult
```

### 5.1 `MemoryQueryResult`

| 字段 | 类型 | 说明 |
|---|---|---|
| `queryId` | string | 对应请求。 |
| `chunks` | MemoryChunk[] | Top-K 片段。 |
| `truncated` | boolean | 是否达 `maxTopK` 截断。 |
| `cacheable` | boolean | 拥有方是否允许此结果被对端缓存（仅 public + 低敏时为 true）。 |

```
MemoryChunk {
  chunkId string
  text string                    // 片段文本
  score number                   // 相关度
  scope enum                     // public | collaboration | private
  metadata object                // 来源、时间、标签等
  provenance string              // 拥有方 deviceId（审计用）
}
```

## 6. 查询流程（拥有方）

1. 校验 Envelope 签名/会话 MAC（006 §4）。
2. 限流（006 §6）：`memory/query` 默认 60/min。
3. 权限检查（006 §3.2）：`memoryQuery.allowed`、`scopes` 在 `PermissionOffer.memoryQuery.scopes` 内、`topK <= maxTopK`。
4. `private` scope 校验 `grantToken`（签名 + 未过期 + scope 匹配 + `taskId` 匹配）。
5. 调用既有 `memory-store` 检索（向量化 + Top-K），按 `scopes`/`metadataFilter` 过滤。
6. 标注 `cacheable`：仅当所有返回 chunk 的 `scope=public` 且拥有方策略允许时为 true。
7. 回结果；审计 `memory_queried`（含 queryId/topK/返回数/scope，**不含查询文本与片段内容**以减隐私足迹）。

## 7. 本地缓存（低敏摘要）

### 7.1 缓存策略

- 仅缓存 `cacheable=true` 的结果（public + 低敏）。
- 缓存键：`deviceId + sha256(query) + scopes + metadataFilter`。
- 缓存内容：仅 `text` + `score` + `metadata`，不含 `grantToken`、不含 private。
- TTL 默认 10min；拥有方 `memory/invalidated` 通知（按 chunkId 或 scope）触发失效。
- 缓存命中前须校验拥有方仍在线且未撤销（Session 活跃）；离线时缓存仅作"最近已知"提示，不可用于权威决策。

### 7.2 失效

```
method: memory/invalidated (notification)
params { ownerDeviceId string; chunkIds string[]?; scopes string[]? }
```

拥有方在记忆变更时推送给已配对 Peer；对端据此清缓存。无 chunkId 表示整 scope 失效。

## 8. private 临时授权

拥有方用户可在 UI 为某 Peer + 某 Task 签发 `grantToken`：

```
grantToken {
  grantId string
  peerDeviceId string
  taskId string
  scopes string[]          // 含 "private"
  chunkSelector object?    // 可限定到特定标签/来源
  expiresAt ISO-8601       // 默认 Task 租约期内
  issuedBy string          // 拥有方 deviceId
  signature string         // 拥有方 Ed25519 签名
}
```

拥有方校验签名、未过期、taskId 匹配、scope 允许后放行；审计 `memory_private_grant_used`。

## 9. 与 Task 派发的关系

- Worker 执行 `task/run`（002）时，本地记忆 miss → 经 `memory/query` 回查 Orchestrator。
- 查询不阻塞 Task 租约心跳（Worker 仍发 `task/progress` heartbeat）。
- 查询失败/超时 → Worker 以"记忆不可用"继续执行（降级），并记 `task/progress` 的 `error` event。

## 10. 隐私与审计

- 审计日志记录查询元数据，**不记录查询文本与返回片段**（006 §8 `detail` 字段受控）。
- `private` scope 的每次使用单独审计并关联 `grantId`。
- 对端无法通过 `memory/query` 枚举拥有方全部记忆（无 list 方法，仅 query）。

## 11. 配置

| 配置 | 默认 |
|---|---|
| `mesh.memory.maxTopK` | 10 |
| `mesh.memory.cacheTtlSeconds` | 600 |
| `mesh.memory.queryDeadlineSeconds` | 15 |
| `mesh.memory.allowPrivateGrants` | true |

## 12. 评审检查清单

- [ ] 拥有方权威是否贯彻（它方只读、不可枚举/写入）？
- [ ] 权限三层是否约束 scope 与 grantToken？
- [ ] 缓存是否仅限 public + 低敏 + TTL + 失效通知？
- [ ] private 临时授权是否签名 + 关联 taskId + 过期？
- [ ] 审计是否不记录查询文本与片段内容？
