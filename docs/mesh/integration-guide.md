# Mesh Integration Guide

How the LAN-distributed agent collaboration subsystem (`src/mesh/`) integrates with the QWicks Agent Runtime.

## Architecture Principle: Opt-in, Seam-based, Byte-identical When Disabled

```
mesh.enabled=false (default)
  → bootMesh returns null
  → MeshRuntimeSlot never installed
  → DelegationRuntime uses pure-local executor
  → byte-for-byte identical to pre-mesh behavior

mesh.enabled=true
  → bootMesh assembles full subsystem
  → MeshRuntimeSlot.install() routes to mesh-aware decide()
  → DelegationRuntime can dispatch to peers
```

## Integration Points (3 seams)

### 1. DelegationRuntime.executor → MeshRuntimeSlot

**File:** `qwicks/src/server/runtime-factory.ts`  
**Change:** Lines 306-328

```typescript
// Before:
executor: createChildAgentExecutor({...})

// After:
const meshSlot = createMeshRuntimeSlot(createChildAgentExecutor({...}))
// ...
executor: meshSlot.executor  // async-boot-safe slot
```

**How it works:**
- `createMeshRuntimeSlot(localExecutor)` creates an empty slot + executor
- Before `install()`: executor passes through to `localExecutor` (byte-identical)
- After `install()`: executor calls `decide()` → routes to local or remote
- `clear()`: reverts to pure-local pass-through

**Gating:** The mesh slot is only created when `options.capabilities?.subagents.enabled` is true (line 322). When false, `delegationRuntime` is `undefined` and the slot is never used.

### 2. bootMesh → Transport Dispatch

**File:** `qwicks/src/mesh/index.ts`  
**Assembly:** `bootMesh(config, deps)` returns `MeshHandle | null`

**Dispatch table:**

| JSON-RPC Method | Handler | Phase |
|---|---|---|
| `pairing/hello` | `PairingResponder.handleHello` | 1 |
| `pairing/verify` | `PairingResponder.handleVerify` | 1 |
| `task/run` | `TaskServer.handleTaskRun` + rate limit | 1 |
| `task/cancel` | Cancel tracking + `cancelRemote` | 1 |
| `tools/call` | `ToolRpcServer.handleToolCall` + rate limit | 2 |
| `tools/list` | Returns `localManifest.tools` | 2 |
| `tools/cancel` | Cancel acknowledgment | 2 |
| `memory/query` | `MemoryRpcServer.handleMemoryQuery` + rate limit | 3 |
| `memory/invalidated` | Acknowledged | 3 |
| `manifest/get` | Returns `localManifest` | 4 |
| `lease/heartbeat` | `TaskLease.heartbeat` | 4 |
| `identity/rotated` | Audit + trust store update | 3 |

### 3. MeshRouter → MeshRuntimeSlot.decide

**File:** `qwicks/src/mesh/integration/router-decide.ts`  
**Wired in:** `bootMesh` via `buildMeshAwareDecide({manifestStore, getLoad, selfDeviceId})`

Routing priority:
1. Forced model → only candidates hosting it
2. Required tools → filter by manifest
3. Capacity → spare concurrency slots
4. Compute preference → higher maxModelParamsB / GPU for planning
5. Load balance → least-busy eligible worker
6. Local fallback → run on this device

## Boot Sequence

```
Application start
  ↓
RuntimeFactory.createServerRuntime(options)
  ↓
  ├─ Create child tool registry, local tool host
  ├─ Create local executor: createChildAgentExecutor({model, toolHost, ...})
  ├─ Create MeshRuntimeSlot: createMeshRuntimeSlot(localExecutor)
  │   └─ slot = empty; executor = pure-local pass-through
  ├─ Create DelegationRuntime({..., executor: meshSlot.executor})
  │   └─ Immediately functional — calls go to local executor
  ↓
  ⋮ (async: load identity, open sockets, start mDNS)
  ↓
bootMesh(config, deps)  ← called when mesh.enabled=true
  ↓
  ├─ Load device identity (Ed25519 + X25519)
  ├─ Open PeerTrustStore, AuditLog
  ├─ Build local Manifest (models, tools, compute profile)
  ├─ Create PairingResponder
  ├─ Create TaskServer (wraps local executor)
  ├─ [Phase 2] Create ToolRpcServer (if executeLocalTool + toolRisk provided)
  ├─ [Phase 3] Create MemoryRpcServer (if queryLocalMemory provided)
  ├─ Create RemoteExecutor (maps input → TaskRunParams)
  ├─ Create TaskLease (heartbeat watchdog)
  ├─ Build meshDecide via buildMeshAwareDecide
  ├─ Start MeshTransportServer with full dispatch handler
  ├─ Start mDNS discovery (_qwicks._tcp)
  ├─ Start manifest refresh timer
  ↓
meshSlot.install({remoteExecutor, decide: meshDecide})
  ↓
  Executor now routes: local or remote based on MeshRouter decision
```

## Wiring ToolHost for Remote Tool Calls

```typescript
import { createApprovalGateAdapter } from './mesh/integration/approval-gate-adapter.js'

const deps: BootDeps = {
  // ... standard deps ...
  executeLocalTool: async (req) => {
    // Wrap real ToolHost.execute with a constructed context
    const ctx: ToolHostContext = {
      threadId: req.taskId ?? 'mesh',
      turnId: req.callId,
      workspace: '.',
      approvalPolicy: { allowBash: true, allowFileWrite: true, maxRiskLevel: 'high' },
      abortSignal: new AbortController().signal,
      awaitApproval: async (approval) => 'allow' // or wire real approval gate
    }
    // ... call toolHost.execute(toolCall, ctx) ...
  },
  toolRisk: (name) => {
    // Look up from manifest or tool registry
    return { riskLevel: 'medium', requiresUserConfirm: false }
  },
  approvalGate: createApprovalGateAdapter(realApprovalGate)
}
```

## Wiring MemoryStore for Remote Memory Queries

```typescript
import { createMemoryStoreQueryAdapter } from './mesh/integration/memory-store-adapter.js'

const deps: BootDeps = {
  // ... standard deps ...
  queryLocalMemory: createMemoryStoreQueryAdapter(memoryStore, deviceId),
  maxTopK: 20
}
```

The adapter automatically:
- Maps workspace/project scopes → `public`
- Maps user scopes → `private` (requires grantToken from requester)
- Filters out soft-deleted records
- Caps results at requested topK

## Security

### Caller Identity
The dispatch handler extracts caller identity:
- `task/run`: `params.provenance[0]`
- `pairing/*`: `params.initiatorDeviceId`
- `tools/*`, `memory/*`: `params._caller` (set by envelope layer in production)

In production, envelope verification (Ed25519 + HMAC) authenticates the caller before dispatch. This is the Phase 3 hardening item.

### Rate Limiting
Per-peer, per-method fixed-window counters. Configured via:
- `deps.rateLimitMax` (default 30)
- `deps.rateLimitWindowSec` (default 60)

## Test Suite

```bash
# Full mesh suite (27 files, 135 tests)
node node_modules/vitest/vitest.mjs run tests/mesh

# Type check
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

All mesh tests use Node ≥20.12. The vendored Node 22.13.1 at `.codex-tools/node-v22.13.1-win-x64/node.exe` satisfies this.

## Remaining Protocol Features (Phase 2-4 completion)

- [ ] `tools/progress` — streaming progress events from remote tool execution
- [ ] GrantToken generation and signing for private memory scope access
- [ ] Revocation propagation — broadcast revoke to all connected peers
- [ ] Multi-device fan-out — concurrent dispatch of same task to multiple peers
- [ ] Full lease recovery with retry/reassign/take-over at dispatch site
- [ ] Envelope verification in transport handler (currently caller from params convention)
- [ ] Auto-model-router injection — peer models as candidates in the main model selection
