# QWicks Mesh Implementation Plan (Phase 1: Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Mesh 的 opt-in 基座与端到端最小可用切片——两台设备自动发现、配对、交换 Manifest、A 向 B 派发一个 Task、B 本地执行后回包、A 合并结果——使 `mesh.enabled=true` 时远程 Task 作为 `DelegationRuntime` 的一种 executor 跑通，`false` 时主系统零改动。

**Architecture:** 新建独立子系统 `qwicks/mesh/`（ESM/TS），仅通过既有接缝接入：`DelegationRuntime.options.executors`（注册 remote executor）、`event-bus`/`runtime-event-recorder`（telemetry）。传输 = WebSocket + JSON-RPC 2.0 + Ed25519 签名信封。发现 = mDNS。配对 = 6 位码 + X25519 ECDH。Phase 1 不含远程工具借用（003）、远程记忆（004）、租约/重试的完整实现（007 仅最小 lease）。

**Tech Stack:** TypeScript (ESM), `ws` (WebSocket), `bonjour-service` 或 `mdns-js` (mDNS), `@noble/ed25519` + `@noble/hashes` (签名/ HKDF), `@noble/curves` (X25519), `zod` (schema, 既有依赖), `better-sqlite3` (既有依赖, 审计/信任存储), `vitest` (既有 devDep).

**环境前置（执行前必须满足）:** 本计划须在 **QWicks 源码仓库**（非安装目录）执行。安装目录 `C:\Users\given\AppData\Local\Programs\QWicks` 下的 `resources/app.asar.unpacked/qwicks` 仅为编译产物，无 `tsconfig.json` / 无 dev `node_modules`，无法 `tsc`/`vitest`。执行前确认仓库根含 `package.json`、`tsconfig.json`、`tsconfig.build.json`、`dist/` 源映射、可运行 `npm test`。

---

## 文件结构（Phase 1）

新建（全部在 `qwicks/mesh/` 下）：

| 文件 | 职责 |
|---|---|
| `mesh/index.ts` | 对外唯一入口 `bootMesh(config, deps)` / `shutdownMesh()`。 |
| `mesh/config.ts` | `MeshConfig` zod schema + 默认值 + 热更新。 |
| `mesh/contracts.ts` | Mesh 专属 zod schema：`DeviceId`、`Envelope`、`Manifest`、`ToolEntry`、`TaskRunParams`、`ChildRunResult`、`PeerRecord`。 |
| `mesh/identity/device-identity.ts` | 生成/加载 Ed25519 + X25519 密钥对、deviceId、fingerprint。 |
| `mesh/discovery/mdns.ts` | mDNS 广播与监听 `_qwicks._tcp`。 |
| `mesh/pairing/pairing-server.ts` | 配对状态机、6 位码、ECDH、信任写入。 |
| `mesh/pairing/peer-trust-store.ts` | `peerTrustStore` 持久化（独立 sqlite）。 |
| `mesh/transport/ws-server.ts` | WebSocket 服务端 + JSON-RPC 编解码。 |
| `mesh/transport/ws-client.ts` | WebSocket 客户端 + 重连。 |
| `mesh/transport/session.ts` | Session 生命周期、nonce 窗口。 |
| `mesh/envelope/envelope.ts` | Envelope 构造、Ed25519 签名、验签、replay 检查。 |
| `mesh/manifest/manifest-builder.ts` | 从既有 tool-host / model 配置生成 Manifest。 |
| `mesh/manifest/manifest-store.ts` | Peer Manifest 缓存。 |
| `mesh/dispatch/remote-executor.ts` | `createRemoteChildExecutor`（实现既有 executor 接口）。 |
| `mesh/dispatch/task-server.ts` | Worker 侧 `task/run` 处理：调本地 `createChildAgentExecutor`。 |
| `mesh/audit/audit-log.ts` | 仅追加审计（独立 sqlite `mesh-audit.db`）。 |
| `mesh/lease/lease.ts` | 最小租约（heartbeat + 超时）。Phase 1 仅超时取消，不含重试/改派。 |

修改（既有文件，最小改动）：

| 文件 | 改动 |
|---|---|
| `qwicks/contracts/capabilities.ts` | 无需改（复用 `SubagentToolPolicy`）。 |
| `qwicks/server/runtime-factory.ts`（或等价启动处） | 在 runtime 启动后、`mesh.enabled=true` 时调用 `bootMesh`，把返回的 remote executor 注册进 `DelegationRuntime.options.executors`。**这是唯一侵入点，且受 `mesh.enabled` 门控。** |
| `qwicks/package.json` | 新增 runtime 依赖 `ws`、`bonjour-service`、`@noble/ed25519`、`@noble/hashes`、`@noble/curves`。 |

---

## Phase 1 任务

### Task 1: Mesh 配置与 opt-in 边界

**Files:**
- Create: `qwicks/mesh/config.ts`
- Test: `qwicks/mesh/__tests__/config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { MeshConfig } from '../config.js';

describe('MeshConfig', () => {
  it('defaults to disabled (opt-in first principle)', () => {
    const cfg = MeshConfig.parse({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.discovery.enabled).toBe(true);
    expect(cfg.listenPort).toBe(0);
  });

  it('rejects negative listenPort', () => {
    expect(() => MeshConfig.parse({ enabled: true, listenPort: -1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail** — `npx vitest run mesh/__tests__/config.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// qwicks/mesh/config.ts
import { z } from 'zod';

export const MeshConfig = z.object({
  enabled: z.boolean().default(false),
  deviceName: z.string().optional(),
  listenPort: z.number().int().nonnegative().default(0),
  discovery: z.object({ enabled: z.boolean().default(true) }).default({}),
  autoAcceptKnownPeers: z.boolean().default(false),
  task: z.object({
    defaultLeaseTimeout: z.number().int().positive().default(300),
    defaultHeartbeatInterval: z.number().int().positive().default(75),
    maxRetries: z.number().int().nonnegative().default(2),
    provenanceMaxDepth: z.number().int().positive().default(5),
  }).default({}),
  memory: z.object({
    maxTopK: z.number().int().positive().default(10),
    cacheTtlSeconds: z.number().int().positive().default(600),
  }).default({}),
});
export type MeshConfig = z.infer<typeof MeshConfig>;
```

- [ ] **Step 4: Run test, verify pass** — `npx vitest run mesh/__tests__/config.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add qwicks/mesh/config.ts qwicks/mesh/__tests__/config.test.ts && git commit -m "feat(mesh): opt-in config schema (RFC 000 §4)"`

### Task 2: Mesh 专属契约

**Files:**
- Create: `qwicks/mesh/contracts.ts`
- Test: `qwicks/mesh/__tests__/contracts.test.ts`

- [ ] **Step 1: Write failing test** — 校验 `Envelope` schema 必填字段、`Manifest` 含 `deviceId`/`tools`、`TaskRunParams` 含 lease/idempotencyKey/provenance（对应 RFC 000 §8.2 / 005 §3 / 002 §4.1）。

```ts
import { describe, it, expect } from 'vitest';
import { Envelope, Manifest, TaskRunParams } from '../contracts.js';

describe('Mesh contracts', () => {
  it('Envelope requires auth.sig + auth.deviceSig', () => {
    const r = Envelope.safeParse({ version: '1', from: 'd1', to: 'd2', messageId: 'm1', traceId: 't1', timestamp: '2026-06-22T00:00:00Z', nonce: 'n1', kind: 'task/run', payload: {}, auth: { alg: 'hmac', sig: 's' } });
    expect(r.success).toBe(false); // missing deviceSig
  });

  it('TaskRunParams requires lease + idempotencyKey + provenance', () => {
    const r = TaskRunParams.safeParse({ taskId: 't', prompt: 'p', idempotencyKey: 'k', retryCount: 0, maxRetries: 2, cancelToken: 'c', provenance: ['d1'], lease: { leaseTimeout: 300, heartbeatInterval: 75 }, disableUserInput: true });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `contracts.ts` — 定义 `Envelope`、`Manifest`、`ModelEntry`、`ToolEntry`、`PromptTemplate`、`ResourceEntry`、`ComputeProfile`、`PermissionOffer`、`PeerRecord`、`TaskRunParams`、`ChildRunResult`、`ProgressEvent`、`ToolResult`、`MemoryChunk`，字段与 RFC 000–008 严格一致（含 §4.2 `auth: { alg, sig, deviceSig }`）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(mesh): wire contracts (RFC 000/005/002)`

### Task 3: 设备身份

**Files:**
- Create: `mesh/identity/device-identity.ts`
- Test: `mesh/identity/__tests__/device-identity.test.ts`

- [ ] **Step 1: Write failing test** — `loadOrCreate()` 首次生成、二次加载一致；`fingerprint` 为 16 hex；签名/验签往返。

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateDeviceIdentity, verifySignature } from '../device-identity.js';

describe('device identity', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qwicks-mesh-')); });

  it('is stable across loads and signs verifiably', async () => {
    const a = await loadOrCreateDeviceIdentity(dir);
    const b = await loadOrCreateDeviceIdentity(dir);
    expect(a.deviceId).toBe(b.deviceId);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const sig = await a.sign(Buffer.from('hello', 'utf8'));
    expect(await verifySignature(a.publicKey, Buffer.from('hello', 'utf8'), sig)).toBe(true);
  });
});
```
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 用 `@noble/ed25519`（Ed25519）+ `@noble/curves` 的 `x25519`（X25519）+ `@noble/hashes`（SHA-256 指纹）；deviceId = ULID；密钥写 `dir/device-identity.json`（0600）。私钥不通过网络。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 4: Envelope 签名与验签

**Files:**
- Create: `mesh/envelope/envelope.ts`
- Test: `mesh/envelope/__tests__/envelope.test.ts`

- [ ] **Step 1: Write failing test** — 签名后验签通过；篡改 payload 后验签失败；replay（重复 nonce）被拒。

```ts
import { describe, it, expect } from 'vitest';
import { signEnvelope, verifyEnvelope, ReplayWindow } from '../envelope.js';
import { loadOrCreateDeviceIdentity } from '../../identity/device-identity.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('envelope', () => {
  it('signs and verifies, rejects tampering and replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'q-'));
    const id = await loadOrCreateDeviceIdentity(dir);
    const base = { version: '1', from: id.deviceId, to: 'peer', messageId: 'm1', traceId: 't1', timestamp: '2026-06-22T00:00:00Z', nonce: 'n1', kind: 'task/run', payload: { a: 1 } };
    const env = await signEnvelope(base, id, 'sessionKey');
    expect(await verifyEnvelope(env, id.publicKey, 'sessionKey')).toBe(true);
    const tampered = { ...env, payload: { a: 2 } };
    expect(await verifyEnvelope(tampered, id.publicKey, 'sessionKey')).toBe(false);
    const win = new ReplayWindow();
    expect(win.checkAndAdd(id.deviceId, 'n1')).toBe(true);
    expect(win.checkAndAdd(id.deviceId, 'n1')).toBe(false);
  });
});
```
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `signEnvelope` 用会话密钥 HMAC-SHA256(`payload||messageId||nonce||timestamp||taskId`) 写 `auth.sig`，用 Ed25519 私钥签同字段写 `auth.deviceSig`；`verifyEnvelope` 双重校验；`ReplayWindow` 每 Peer 滑动窗口 1024。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 5: 审计日志

**Files:**
- Create: `mesh/audit/audit-log.ts`
- Test: `mesh/audit/__tests__/audit-log.test.ts`

- [ ] **Step 1: Write failing test** — append-only：写入后可查、不可被对端接口修改；记录含 `traceId`/`taskId`/`from`/`to`/`kind`/`outcome`/`timestamp`。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 独立 `mesh-audit.db`（better-sqlite3），`audit_events` 表，仅 `INSERT`/`SELECT`，无 `UPDATE`/`DELETE` API 暴露。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 6: Peer 信任存储

**Files:**
- Create: `mesh/pairing/peer-trust-store.ts`
- Test: `mesh/pairing/__tests__/peer-trust-store.test.ts`

- [ ] **Step 1: Write failing test** — upsert/list/revoke；revoke 后 `listActive` 不返回；持久化跨实例。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 独立 sqlite `mesh-trust.db`，`peers` 表，字段同 RFC 001 §6。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 7: mDNS 发现

**Files:**
- Create: `mesh/discovery/mdns.ts`
- Test: `mesh/discovery/__tests__/mdns.test.ts`

- [ ] **Step 1: Write failing test** — 广播服务含 `_qwicks._tcp` + TXT（`dv`/`fp`/`pv`/`dn`）；监听解析出对端 deviceId。用 fake transport 注入避免真网络依赖（或 `mdns-js` mock）。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `bonjour-service` 发布 + 浏览；TXT 按 RFC 001 §3.1。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 8: WebSocket 传输 + JSON-RPC 编解码

**Files:**
- Create: `mesh/transport/ws-server.ts`, `mesh/transport/ws-client.ts`, `mesh/transport/session.ts`, `mesh/transport/json-rpc.ts`
- Test: `mesh/transport/__tests__/json-rpc.test.ts`, `ws-roundtrip.test.ts`

- [ ] **Step 1: Write failing test** — JSON-RPC request/response/notification 编解码往返；两个 `ws-server`/`ws-client` 在 loopback 端口完成一次 `ping` 方法往返。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `ws` 库；`Session` 管理连接 + nonce 窗口 + 关联 `peerDeviceId`。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 9: 配对协议（6 位码 + ECDH）

**Files:**
- Create: `mesh/pairing/pairing-server.ts`
- Test: `mesh/pairing/__tests__/pairing.test.ts`

- [ ] **Step 1: Write failing test** — 两个 loopback 实例走完 `pairing/hello` → `pairing/verify`（正确码）→ 派生相同 `sessionKeyMaterial`（双方 HKDF 输出一致）→ 双方 `peerTrustStore` 各写入一条；错误码 3 次后 `rejected`。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 状态机（RFC 001 §4）；6 位码（`crypto.randomInt`）；X25519 ECDH + HKDF-SHA256（RFC 001 §5.3）；指纹比对作为协议字段（UI 确认在 Phase 1 可用 stub gate）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 10: Manifest 构建与交换

**Files:**
- Create: `mesh/manifest/manifest-builder.ts`, `mesh/manifest/manifest-store.ts`
- Test: `mesh/manifest/__tests__/manifest.test.ts`

- [ ] **Step 1: Write failing test** — `buildManifest(identity, deps)` 产出含本机模型 + 工具（从既有 tool-host 与 model 配置读取，至少 1 个工具）+ computeProfile；`manifest/push` 后 `manifest-store` 缓存命中；`manifest/changed` 触发失效。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 字段严格按 RFC 005 §3；`toolEntry.riskLevel` 从既有 tool 元数据推导（无则 `low`）；`discoverable=false` 的工具排除。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 11: 远程 executor（Orchestrator 侧）

**Files:**
- Create: `mesh/dispatch/remote-executor.ts`
- Test: `mesh/dispatch/__tests__/remote-executor.test.ts`

- [ ] **Step 1: Write failing test** — 用 fake `Session`（注入 `task/run` 响应 `ChildRunResult{summary,usage,toolInvocations,prefixReused:true,inheritedHistoryItems:0,status:'completed'}`）；`createRemoteChildExecutor(session, router)` 调用后返回的 `ChildRunExecutorResult` 字段与既有 executor 接口一致；`signal.abort` 触发 `task/cancel`。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 按 RFC 002 §3、§4.1 把 `ChildRunExecutorInput` 编为 `TaskRunParams`，发 `task/run`，解包 `ChildRunResult`（§4.2）；监听 `task/progress` 转发为本地 runtime event（通过注入的 `eventBus`）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 12: Task 服务端（Worker 侧）

**Files:**
- Create: `mesh/dispatch/task-server.ts`
- Test: `mesh/dispatch/__tests__/task-server.test.ts`

- [ ] **Step 1: Write failing test** — 收到 `task/run`（fake Envelope + 已配对 Peer）→ 调用注入的 `createChildAgentExecutor`（stub 返回固定 result）→ 回 `ChildRunResult{status:'completed'}` + 至少 1 条 `task/progress`（`turn_started`/`turn_completed`）；未配对 deviceId → `-32002 unauthorized`；重复 `idempotencyKey` → 返回缓存结果不重跑。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 按 RFC 002 §11；权限检查（006 §3.2 最小版：仅验"已配对"）；幂等表（内存，TTL）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 13: 最小租约

**Files:**
- Create: `mesh/lease/lease.ts`
- Test: `mesh/lease/__tests__/lease.test.ts`

- [ ] **Step 1: Write failing test** — `heartbeat` 刷新到期；超时（用 fake clock）触发 `task/cancel` + 标记 `lease_expired`。Phase 1 不测重试/改派。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — 按 RFC 007 §4/§6.1/§6.2（仅超时取消，不含 §6.3 接管决策）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 14: bootMesh 装配 + opt-in 门控

**Files:**
- Create: `mesh/index.ts`
- Modify: `qwicks/server/runtime-factory.ts`（或等价启动处）
- Test: `mesh/__tests__/boot.test.ts`

- [ ] **Step 1: Write failing test** — `bootMesh({enabled:false,...})` 不启动任何子模块、返回 no-op；`bootMesh({enabled:true,...})` 启动 transport+discovery+manifest 并返回含 `remoteExecutor` 的句柄；`shutdownMesh()` 关闭监听并清理。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `index.ts` 装配 Task 1–13；在 `runtime-factory` 中 `if (meshConfig.enabled) { const mesh = await bootMesh(...); delegationRuntime.options.executors.push(mesh.remoteExecutor); }`。**唯一侵入点，受 enabled 门控。**
- [ ] **Step 4: Run, verify pass** + 跑既有 `npm test` 确认无回归（opt-in 零侵入验证）。
- [ ] **Step 5: Commit.**

### Task 15: 端到端冒烟（两实例 loopback）

**Files:**
- Test: `mesh/__tests__/e2e-roundtrip.test.ts`

- [ ] **Step 1: Write failing test** — 同进程起两个 `bootMesh`（loopback 端口 + fake mDNS 发现注入）：A 与 B 配对 → 交换 Manifest → A 的 `DelegationRuntime.runChild` 选 remote executor → B 用 stub `createChildAgentExecutor` 返回 `"hello from B"` → A 收到 `summary === 'hello from B'` 且 `ChildRunRecord.status === 'completed'` 且 telemetry 含 `turn_completed` + `task_run_completed`。
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Wire** — 修复装配缺口（不改协议）。
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(mesh): phase 1 end-to-end task round-trip`

---

## Phase 2–4（后续 plan，本文件仅 scoped outline）

每个 Phase 产出独立可测软件，各自一份详细 plan：

**Phase 2 — 远程工具调用（RFC 003）:** `RemoteToolHost` 适配器（实现既有 `tool-host` port）、`tools/list`/`tools/call`/`tools/cancel`、与 `approval-gate` 集成（high/critical 强制弹窗）、路径白名单、幂等。验收：Worker 执行 Task 时成功借用 Orchestrator 的一个只读工具，critical 工具被拒绝时 Task 失败。

**Phase 3 — 远程记忆 + 安全硬化（RFC 004 + 006 完整）:** `memory/query`/`memory/invalidated`、拥有方权威检索、低敏缓存 + TTL、private 临时授权（grantToken 签名）；补齐 006 的限流、双签名全量、密钥轮换（`identity/rotated`）、撤销传播。验收：Worker miss 后回查 Orchestrian 记忆得 Top-K；private scope 无 grantToken 被拒；限流触发 `-32001`。

**Phase 4 — 路由 + 多设备/多模型/多 Agent（RFC 007 完整 + 008）:** `MeshRouter.selectExecutor`（模型/能力/负载/权限/本地兜底）、重试/改派/接管（007 §6.3）、provenance 循环检测与深度上限、多 Worker fan-out、`auto-model-router` 注入 Peer 模型。验收：A 同时向 B、C fan-out；`provenance` 回环被拒；大算力任务路由到 GPU Worker。

---

## Self-Review（Phase 1）

**Spec coverage:** RFC 000 §4 opt-in（Task 1, 14）、§5 模块结构（文件结构表）、§6 身份（Task 3）、§8 信封（Task 4）、§13 审计（Task 5）；RFC 001 配对（Task 6, 7, 9）；RFC 005 manifest（Task 10）；RFC 002 dispatch（Task 11, 12）；RFC 007 最小 lease（Task 13）；端到端（Task 15）。Phase 1 不覆盖 003/004/008 与 006 的限流/轮换/撤销——显式划入 Phase 2–4，非遗漏。

**Placeholder scan:** Phase 1 每步含真实测试与实现指引；Phase 2–4 标注为后续 plan（按 writing-plans scope-check 拆分），非占位符。

**Type consistency:** `ChildRunExecutorResult` 字段（summary/usage/toolInvocations/prefixReused/inheritedHistoryItems）与既有 `delegation-runtime.js` 一致；`Envelope.auth` = `{alg, sig, deviceSig}` 与 006 §4.1、000 §8.2 一致（已修）。

**环境约束（必读）:** Phase 1 全部 `tsc`/`vitest` 步骤须在 QWicks 源码仓库执行，非安装目录。若当前只有安装目录，则本 plan 的代码步骤产出的是"待集成源文件"，须移入源码仓库后才能 `npm test` 验证。
