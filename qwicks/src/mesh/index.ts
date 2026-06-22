import { join } from 'node:path'
import type { ChildRunExecutor } from '../delegation/delegation-runtime.js'
import { MeshConfig } from './config.js'
import type { DeviceIdentity } from './identity/device-identity.js'
import { PeerTrustStore } from './pairing/peer-trust-store.js'
import { PairingResponder } from './pairing/pairing.js'
import type { HelloParams, VerifyParams } from './pairing/pairing.js'
import { AuditLog } from './audit/audit-log.js'
import { ManifestStore, buildManifest, type ToolInput, type ModelInput } from './manifest/manifest-builder.js'
import { createRemoteChildExecutor, type RemoteExecutorDeps } from './dispatch/remote-executor.js'
import { createFanOutDispatcher, type FanOutDispatcherDeps, type FanOutParams, type FanOutResult } from './dispatch/fan-out.js'
import { TaskServer } from './dispatch/task-server.js'
import { TaskLease } from './lease/lease.js'
import { decideRecovery } from './lease/recovery.js'
import { MeshTransportServer } from './transport/transport.js'
import { MeshDiscovery, type BonjourLike } from './discovery/mdns.js'
import { ToolRpcServer } from './remote-tool/tool-rpc.js'
import { MemoryRpcServer } from './remote-memory/memory-rpc.js'
import { RateLimiter } from './security/rate-limiter.js'
import type { TaskLease as TaskLeaseType } from './lease/lease.js'
import { buildMeshAwareDecide, buildMeshAwareFanOut } from './integration/router-decide.js'
import { SessionKeyStore } from './identity/session-key-store.js'
import { verifyEnvelope, ReplayWindow } from './envelope/envelope.js'
import { fromHex } from './identity/device-identity.js'
import { verifyGrantToken, parseGrantToken } from './security/grant-token.js'
import { createPeerModelRegistry, type PeerModelRegistry } from './roles/peer-model-registry.js'
import { Envelope as EnvelopeSchema, type Envelope as EnvelopeType } from './contracts.js'
import type { FanOutDecision } from './roles/mesh-router.js'
import type {
  ChildRunResult, TaskRunParams,
  ToolCallRequest, ToolResult,
  MemoryQueryRequest, MemoryChunk,
  RiskLevel
} from './contracts.js'

/**
 * Mesh entry point (RFC 000 §4, §5; Phase 2-4 dispatch wiring).
 *
 * `bootMesh` is the single place QWicks touches to bring up Mesh. It is only
 * ever called when `mesh.enabled === true`; otherwise it returns `null` and
 * starts nothing — the rest of QWicks behaves as if Mesh were not installed.
 *
 * When enabled, it loads identity, opens the trust store + audit log, builds the
 * local manifest, creates the ToolRpcServer + MemoryRpcServer (if the owning
 * callbacks are provided), starts the transport server + mDNS discovery, and
 * assembles the remote executor + task server + lease + dispatch router.
 */

/* ------------------------------------------------------------------ *
 * Dependency injection types
 * ------------------------------------------------------------------ */

export interface BootDeps {
  identity: DeviceIdentity
  dataDir: string
  /** The local Agent-loop runner (createChildAgentExecutor in production). */
  localExecutor: ChildRunExecutor
  /** Ship task/run to a peer and await its result (wired by the session layer). */
  runRemote: (params: TaskRunParams, signal: AbortSignal) => Promise<ChildRunResult>
  cancelRemote?: (taskId: string, cancelToken: string) => Promise<void>
  isPeerAuthorized: (deviceId: string) => boolean
  onPeerDiscovered?: (peer: { deviceId: string; host: string; port: number }) => void
  /** Injectable discovery (tests pass a no-op so no real mDNS broadcast happens). */
  discovery?: BonjourLike
  deviceName?: string
  manifest?: {
    models: ModelInput[]
    tools: ToolInput[]
    computeProfile: { canRunLocalModels: boolean; cpuCores?: number; ramGb?: number; maxModelParamsB?: number; gpu?: { name: string; vramGb: number; computeCapability: string } }
  }

  /* Phase 2 — Tool RPC (optional; when absent tools/call returns not-available) */
  /** Execute a tool locally on this device (wraps ToolHost.execute). */
  executeLocalTool?: (req: ToolCallRequest) => Promise<{ output: unknown; truncated?: boolean }>
  /** Risk profile lookup for tool names advertised in the local manifest. */
  toolRisk?: (name: string) => { riskLevel: RiskLevel; requiresUserConfirm: boolean } | undefined
  /** Approval gate for high/critical tools (wraps ApprovalGate via createApprovalGateAdapter). */
  approvalGate?: { request: (req: ToolCallRequest) => Promise<'allow' | 'deny'> }

  /* Phase 3 — Memory RPC (optional; when absent memory/query returns not-available) */
  /** Query local memory store (wraps MemoryStore.retrieve via createMemoryStoreQueryAdapter). */
  queryLocalMemory?: (req: MemoryQueryRequest) => Promise<MemoryChunk[]>
  /** Maximum topK for memory queries (default 20). */
  maxTopK?: number
      /** Called when a remote tool execution emits progress (RFC 003 §7.1). */
      onToolProgress?: (event: { callId: string; taskId?: string; progress: number; message?: string }) => void
      /** Called when a remote peer broadcasts memory/invalidated so the local
       *  MemoryRpcClient cache can be purged. Receives the owner deviceId and
       *  optional finer-grained chunkId/scope filters (RFC 004 §7.2). */
      onMemoryInvalidated?: (deviceId: string, opts?: { chunkIds?: string[]; scopes?: string[] }) => void

      /* Phase 4 — Routing */
  /** Periodic manifest refresh interval in ms (default 30_000). */
  manifestRefreshMs?: number

  /* Security */
  /** Per-peer rate limit: max calls per window (default 30). */
  rateLimitMax?: number
  /** Rate-limit window in seconds (default 60). */
  rateLimitWindowSec?: number
}

export interface MeshHandle {
  remoteExecutor: ChildRunExecutor
  manifestStore: ManifestStore
  taskServer: TaskServer
  responder: PairingResponder
  /** Persistent trust store (paired peers). Exposed for status/UI routes. */
  trustStore: PeerTrustStore
  /** The device identity this mesh is running as. */
  identity: DeviceIdentity
  /** Orchestrator-side lease watchdog (acquire on dispatch, release on
   *  completion). Exposed so the dispatch bridge can drive lease lifecycle. */
  lease: TaskLeaseType
  /** Peer model registry for UI model selection across the mesh. */
  peerModelRegistry: PeerModelRegistry
  /** The dispatch-aware decide callback for MeshRuntimeSlot / mesh-aware executor. */
  meshDecide: (input: { childId: string; prompt: string; model?: string; label?: string; workspace?: string }) => { executor: 'local' | 'remote'; workerDeviceId?: string; reason?: string }
  /** Fan-out decide: returns all eligible workers for parallel dispatch. */
  fanOutDecide: (input: { childId: string; prompt: string; model?: string; label?: string; workspace?: string }) => FanOutDecision
  /** Fan-out dispatcher: ships the same task to multiple workers in parallel. */
  fanOutDispatch: (params: FanOutParams) => Promise<FanOutResult>
  /** Broadcast a JSON-RPC notification to all connected peers. */
  broadcast: (method: string, params?: unknown) => void
  /** The port the transport server is listening on (0 if discovery disabled). */
  transportPort: number
  shutdown: () => Promise<void>
}

/* ------------------------------------------------------------------ *
 * bootMesh
 * ------------------------------------------------------------------ */

export async function bootMesh(config: MeshConfig, deps: BootDeps): Promise<MeshHandle | null> {
  if (!config.enabled) return null

  const trustStore = new PeerTrustStore(join(deps.dataDir, 'mesh-trust.db'))
  const audit = new AuditLog(join(deps.dataDir, 'mesh-audit.db'))
  const sessionKeyStore = new SessionKeyStore(deps.identity.deviceId, deps.dataDir)
  await sessionKeyStore.load()
  const replayWindow = new ReplayWindow()
  const manifestStore = new ManifestStore()
  const rateLimiter = new RateLimiter({
    maxCalls: deps.rateLimitMax ?? 30,
    windowSeconds: deps.rateLimitWindowSec ?? 60
  })

  const deviceName = deps.deviceName ?? config.deviceName ?? 'qwicks-mesh'
  const localManifest = buildManifest({
    identity: deps.identity,
    deviceName,
    models: deps.manifest?.models ?? [],
    tools: deps.manifest?.tools ?? [],
    computeProfile: deps.manifest?.computeProfile ?? { canRunLocalModels: false }
  })
  manifestStore.set(localManifest)

  /* ---- Pairing ---- */
  const responder = new PairingResponder({
    identity: deps.identity,
    trustStore,
    audit,
    deviceName
  })

      /* ---- Task server ---- */
      const taskServer = new TaskServer({
        isPeerAuthorized: deps.isPeerAuthorized,
        localExecutor: deps.localExecutor,
        audit,
        selfDeviceId: deps.identity.deviceId,
        maxDepth: config.task.provenanceMaxDepth
      })

  /* ---- Tool RPC server (Phase 2) ---- */
  let toolRpcServer: ToolRpcServer | undefined
  if (deps.executeLocalTool && deps.toolRisk) {
    toolRpcServer = new ToolRpcServer({
      isPeerAuthorized: deps.isPeerAuthorized,
      toolRisk: deps.toolRisk,
      executeLocal: deps.executeLocalTool,
      ...(deps.approvalGate ? { approvalGate: deps.approvalGate } : {}),
      audit
    })
  }

      /* ---- Memory RPC server (Phase 3) ---- */
      let memoryRpcServer: MemoryRpcServer | undefined
      if (deps.queryLocalMemory) {
        memoryRpcServer = new MemoryRpcServer({
          isPeerAuthorized: deps.isPeerAuthorized,
          queryLocal: deps.queryLocalMemory,
          maxTopK: deps.maxTopK ?? 20,
          audit,
          allowPrivateGrants: config.memory?.allowPrivateGrants ?? false,
          verifyGrantToken: async (token) => {
            const peerRecord = await trustStore.get(token.issuer)
            if (!peerRecord || peerRecord.revokedAt) return false
            const publicKey = fromHex(peerRecord.peerPublicKey)
            return verifyGrantToken(token, publicKey)
          }
        })
      }

      /* ---- Remote executor ---- */
      const executorDeps: RemoteExecutorDeps = {
        selfDeviceId: deps.identity.deviceId,
        runRemote: deps.runRemote,
        ...(deps.cancelRemote ? { cancelRemote: deps.cancelRemote } : {}),
        lease: { leaseTimeout: config.task.defaultLeaseTimeout, heartbeatInterval: config.task.defaultHeartbeatInterval },
        maxRetries: config.task.maxRetries,
        provenanceMaxDepth: config.task.provenanceMaxDepth
      }
  const remoteExecutor = createRemoteChildExecutor(executorDeps)

  /* ---- Task retry tracking (Phase 4 recovery) ---- */
  const taskRetries = new Map<string, number>()

  /* ---- Lease ---- */
  const lease = new TaskLease(
    {
      leaseTimeoutMs: config.task.defaultLeaseTimeout * 1000,
      heartbeatIntervalMs: config.task.defaultHeartbeatInterval * 1000
    },
    async (taskId) => {
      const retryCount = taskRetries.get(taskId) ?? 0
      const maxRetries = config.task.maxRetries ?? 3
      const taskEntry = inflightTasks.get(taskId)

      // Determine worker reachability: if we have a worker and it hasn't
      // explicitly disconnected, consider it reachable (lease just timed out).
      const originalWorkerReachable = taskEntry != null
      const alternativeWorkersAvailable = manifestStore.list().length > 1

      const decision = decideRecovery({
        retryCount,
        maxRetries,
        originalWorkerReachable,
        alternativeWorkersAvailable,
        retryable: true // lease timeout is retryable
      })

      await audit.record({
        kind: 'lease_expired',
        from: deps.identity.deviceId,
        to: taskEntry?.workerDeviceId ?? '?',
        outcome: decision.action === 'fail' ? 'failure' : 'timeout',
        traceId: taskId,
        taskId,
        timestamp: new Date().toISOString(),
        detail: { retryCount, maxRetries, action: decision.action, reason: decision.reason }
      })

      switch (decision.action) {
        case 'retry_same_worker':
          taskRetries.set(taskId, retryCount + 1)
          lease.heartbeat(taskId) // re-arm lease for retry
          break
        case 'reassign':
        case 'take_over_locally':
          void deps.cancelRemote?.(taskId, 'lease_expired')
          inflightTasks.delete(taskId)
          lease.release(taskId)
          taskRetries.delete(taskId)
          break
        case 'fail':
          void deps.cancelRemote?.(taskId, 'lease_expired')
          inflightTasks.delete(taskId)
          lease.release(taskId)
          taskRetries.delete(taskId)
          break
      }
    }
  )

  /* ---- In-flight task tracking (Phase 4 fan-out) ---- */
  const inflightTasks = new Map<string, { workerDeviceId: string; startedAt: number }>()

      /* ---- Mesh router decide (Phase 4) ---- */
      const meshDecide = buildMeshAwareDecide({
        manifestStore,
        getLoad: (deviceId) => {
          let count = 0
          for (const t of inflightTasks.values()) {
            if (t.workerDeviceId === deviceId) count++
          }
          return count
        },
        selfDeviceId: deps.identity.deviceId,
        maxDepth: config.task.provenanceMaxDepth
      })

      const fanOutDecide = buildMeshAwareFanOut({
        manifestStore,
        getLoad: (deviceId) => {
          let count = 0
          for (const t of inflightTasks.values()) {
            if (t.workerDeviceId === deviceId) count++
          }
          return count
        },
        selfDeviceId: deps.identity.deviceId,
        maxDepth: config.task.provenanceMaxDepth
      })

      /* ---- Peer model registry (Phase 4) ---- */
      const peerModelRegistry = createPeerModelRegistry({
        manifestStore,
        getLoad: (deviceId) => {
          let count = 0
          for (const t of inflightTasks.values()) {
            if (t.workerDeviceId === deviceId) count++
          }
          return count
        },
        selfDeviceId: deps.identity.deviceId
      })

      /* ---- Fan-out dispatcher (Phase 4 / RFC 008 §4.2) ---- */
      const fanOutDispatcherDeps: FanOutDispatcherDeps = {
        selfDeviceId: deps.identity.deviceId,
        runRemote: deps.runRemote,
        ...(deps.cancelRemote ? { cancelRemote: deps.cancelRemote } : {}),
        lease: { leaseTimeout: config.task.defaultLeaseTimeout, heartbeatInterval: config.task.defaultHeartbeatInterval },
        maxRetries: config.task.maxRetries
      }
      const fanOutDispatch = createFanOutDispatcher(fanOutDispatcherDeps)

  /* ---- Envelope verification (Phase 3) ---- */
  const ENVELOPE_SKEW_MS = 60_000

  async function verifyAndUnwrap(
    method: string,
    rawParams: unknown
  ): Promise<{ method: string; params: Record<string, unknown> }> {
    const parsed = EnvelopeSchema.safeParse(rawParams)
    if (!parsed.success) {
      // Not an envelope — legacy or internal dispatch
      return { method, params: (rawParams ?? {}) as Record<string, unknown> }
    }
    const env = parsed.data

    // Look up peer's public key from trust store
    const peerRecord = await trustStore.get(env.from)
    if (!peerRecord || peerRecord.revokedAt) {
      throw { code: -32002, message: `unauthorized: peer ${env.from} not trusted` }
    }

    // Look up session key
    const sessionKey = sessionKeyStore.getVerifyKey(env.from)
    if (!sessionKey) {
      throw { code: -32002, message: `no session key for ${env.from}` }
    }

    // Replay check
    if (!replayWindow.checkAndAdd(env.from, env.nonce)) {
      throw { code: -32000, message: 'replay detected' }
    }

    // Timestamp skew check (±60s, RFC 006 §4.3)
    const ts = new Date(env.timestamp).getTime()
    if (Math.abs(Date.now() - ts) > ENVELOPE_SKEW_MS) {
      throw { code: -32000, message: 'timestamp skew too large' }
    }

    // Verify dual-auth envelope (HMAC + Ed25519)
    const peerPublicKey = fromHex(peerRecord.peerPublicKey)
    const ok = await verifyEnvelope(env, peerPublicKey, sessionKey)
    if (!ok) {
      throw { code: -32002, message: 'envelope verification failed' }
    }

    // Extract method from envelope kind, inject _caller for backward compat
    return {
      method: env.kind,
      params: { ...env.payload, _caller: env.from }
    }
  }

  /* ---- Transport start ---- */
  const transport = new MeshTransportServer()
  let transportPort = 0
  const selfDeviceId = deps.identity.deviceId

  /**
   * Extract caller identity from an incoming JSON-RPC request.
   *
   * For enveloped messages, `_caller` is injected by `verifyAndUnwrap` above.
   * This function handles non-enveloped (legacy / internal) dispatch paths:
   *   - task/run          → params.provenance[0]
   *   - pairing/hello     → params.initiatorDeviceId
   *   - pairing/verify    → params.initiatorDeviceId
   *   - tools/*, memory/* → params._caller (set by caller-side envelope)
   * Falls back to 'unknown' so auth checks still reject unauthorised callers.
   */
  function extractCaller(method: string, params: Record<string, unknown>): string {
    if (method === 'task/run' && Array.isArray(params.provenance) && params.provenance.length > 0) {
      return String(params.provenance[0])
    }
    if (method === 'pairing/hello' || method === 'pairing/verify') {
      return String(params.initiatorDeviceId ?? 'unknown')
    }
    if (typeof params._caller === 'string') return params._caller
    return 'unknown'
  }

  /* ---- Cancel tracking (Phase 2) ---- */
  const cancelledTasks = new Set<string>()

  const dispatch = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      /* ---- pairing ---- */
      case 'pairing/hello':
        return responder.handleHello(params as unknown as HelloParams)
      case 'pairing/verify': {
        const result = await responder.handleVerify(params as unknown as VerifyParams)
        if (result.verified) {
          // Use the per-initiator getter to avoid the race where two
          // concurrent pairings overwrite lastSessionKeyMaterial (F14).
          const initiatorDeviceId = (params as unknown as VerifyParams).initiatorDeviceId
          const material = responder.sessionKeyMaterialFor(initiatorDeviceId) ?? responder.lastSessionKeyMaterial
          if (material) {
            await sessionKeyStore.storeFromPairing(initiatorDeviceId, material)
            console.warn(`[qwicks mesh] pairing completed with ${initiatorDeviceId.slice(0, 8)}…`)
          }
        }
        return result
      }

      /* ---- task ---- */
      case 'task/run': {
        const p = params as unknown as TaskRunParams
        if (cancelledTasks.has(p.taskId)) {
          return { summary: '', status: 'aborted' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
        }
        const caller = extractCaller('task/run', params as Record<string, unknown>)
        if (!rateLimiter.checkAndConsume(caller, 'task/run')) {
          throw { code: -32003, message: `rate limited; retry in ${rateLimiter.retryAfterMs(caller, 'task/run')}ms` }
        }
        inflightTasks.set(p.taskId, { workerDeviceId: selfDeviceId, startedAt: Date.now() })
        try {
          return await taskServer.handleTaskRun(p, caller)
        } finally {
          inflightTasks.delete(p.taskId)
        }
      }
      case 'task/cancel': {
        const { taskId, cancelToken } = params as Record<string, string>
        cancelledTasks.add(taskId)
        // Abort the in-flight local execution on this worker (F5 fix): without
        // this the agent loop keeps burning tokens after the orchestrator gave up.
        taskServer.cancel(taskId)
        void deps.cancelRemote?.(taskId, cancelToken ?? '')
        return { acknowledged: true }
      }

      /* ---- tools (Phase 2) ---- */
      case 'tools/call': {
        if (!toolRpcServer) throw { code: -32601, message: 'tools not available on this peer' }
        const p = params as unknown as ToolCallRequest
        const caller = extractCaller('tools/call', params as Record<string, unknown>)
        if (!rateLimiter.checkAndConsume(caller, 'tools/call')) {
          throw { code: -32003, message: `rate limited; retry in ${rateLimiter.retryAfterMs(caller, 'tools/call')}ms` }
        }
        return toolRpcServer.handleToolCall(p, caller)
      }
      case 'tools/list': {
        const tools = (localManifest.tools ?? []).filter((t) => t.discoverable)
        return { tools, manifestVersion: localManifest.manifestVersion }
      }
      case 'tools/cancel': {
        const { callId } = params as Record<string, string>
        return { acknowledged: true, callId }
      }
      case 'tools/progress': {
        const { callId, taskId, progress, message } = params as Record<string, unknown>
        deps.onToolProgress?.({
          callId: String(callId ?? ''),
          taskId: taskId != null ? String(taskId) : undefined,
          progress: Number(progress ?? 0),
          message: message != null ? String(message) : undefined
        })
        return { acknowledged: true }
      }

      /* ---- memory (Phase 3) ---- */
      case 'memory/query': {
        if (!memoryRpcServer) throw { code: -32601, message: 'memory not available on this peer' }
        const p = params as unknown as MemoryQueryRequest
        const caller = extractCaller('memory/query', params as Record<string, unknown>)
        if (!rateLimiter.checkAndConsume(caller, 'memory/query')) {
          throw { code: -32003, message: `rate limited; retry in ${rateLimiter.retryAfterMs(caller, 'memory/query')}ms` }
        }
        return memoryRpcServer.handleMemoryQuery(p, caller)
      }
        case 'memory/invalidated': {
          const { deviceId, chunkIds, scopes } = params as Record<string, unknown>
          if (typeof deviceId === 'string' && deps.onMemoryInvalidated) {
            const opts: { chunkIds?: string[]; scopes?: string[] } = {}
            if (Array.isArray(chunkIds)) opts.chunkIds = chunkIds.map(String)
            if (Array.isArray(scopes)) opts.scopes = scopes.map(String)
            deps.onMemoryInvalidated(deviceId, Object.keys(opts).length > 0 ? opts : undefined)
          }
          return { acknowledged: true }
        }

      /* ---- manifest ---- */
      case 'manifest/get': {
        return localManifest
      }

      /* ---- lease ---- */
      case 'lease/heartbeat': {
        const { taskId } = params as Record<string, string>
        lease.heartbeat(taskId)
        return { alive: true }
      }

      /* ---- identity ---- */
      case 'identity/rotated': {
        const { deviceId, newPublicKey, newFingerprint, rotatedAt } = params as Record<string, string>
        await audit.record({
          kind: 'key_rotated',
          from: deviceId,
          to: selfDeviceId,
          outcome: 'success',
          traceId: deviceId,
          taskId: undefined,
          timestamp: new Date().toISOString(),
          detail: { rotatedAt }
        })
        const existing = await trustStore.get(deviceId)
        if (existing) {
          await trustStore.upsert({
            ...existing,
            peerPublicKey: newPublicKey,
            peerFingerprint: newFingerprint,
            lastSeenAt: new Date().toISOString()
          })
        }
        // Revoke session keys for this peer (they must re-pair)
        await sessionKeyStore.revoke(deviceId)
        // Propagate to all other connected peers (RFC 006 §7.2)
        transport.broadcast('identity/rotated', params)
        return { acknowledged: true }
      }

      default:
        throw { code: -32601, message: `method not found: ${method}` }
    }
  }

  if (config.discovery.enabled) {
    transport.onClientEvent = (event, detail) => {
      if (event === 'error') {
        console.warn(`[qwicks mesh] transport error: ${detail ?? 'unknown'}`)
      }
    }
    const started = await transport.start((msg, reply) => {
      if (msg.type === 'notification') {
        // Fire-and-forget: verify envelope, dispatch, ignore result
        verifyAndUnwrap(msg.method, msg.params)
          .then(({ method, params }) => dispatch(method, params))
          .catch(() => { /* notifications are best-effort */ })
        return
      }
      if (msg.type !== 'request') return
      verifyAndUnwrap(msg.method, msg.params)
        .then(({ method, params }) => dispatch(method, params))
        .then((result) => reply({ result }))
        .catch((err) => {
          const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: number }).code : -32603
          const message = typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : 'internal error'
          reply({ error: { code, message } })
        })
    })
    transportPort = started.port
  }

  /* ---- mDNS Discovery ---- */
  let discovery: MeshDiscovery | undefined
  if (config.discovery.enabled) {
    discovery = new MeshDiscovery({
      identity: {
        deviceId: deps.identity.deviceId,
        fingerprint: deps.identity.fingerprint,
        protocolVersion: '1',
        deviceName,
        manifestVersion: localManifest.manifestVersion
      },
      port: transportPort,
      selfDeviceId: deps.identity.deviceId,
      ...(deps.discovery ? { bonjour: deps.discovery } : {})
    })
    discovery.start((peer) => {
      console.warn(`[qwicks mesh] discovered peer ${peer.deviceId.slice(0, 8)}… at ${peer.host}:${peer.port}`)
      deps.onPeerDiscovered?.(peer)
    })
    console.warn(`[qwicks mesh] mDNS discovery started (advertising as ${deviceName})`)

    // autoAcceptKnownPeers: reconnect already-trusted peers without re-pairing.
    // On discovery, if the peer is in our trust store and the flag is set,
    // surface them as discovered so the dispatch bridge connects — they don't
    // need a fresh pairing handshake (their session keys are persisted).
    if (config.autoAcceptKnownPeers) {
      console.warn('[qwicks mesh] autoAcceptKnownPeers enabled — trusted peers reconnect without re-pairing')
    }
  } else {
    console.warn('[qwicks mesh] discovery disabled — peers must connect manually by host:port')
  }

  /* ---- Manifest refresh timer (Phase 4) ---- */
  let manifestRefreshTimer: ReturnType<typeof setInterval> | undefined
  if (config.discovery.enabled) {
    const intervalMs = deps.manifestRefreshMs ?? 30_000
    manifestRefreshTimer = setInterval(() => {
      const fresh = buildManifest({
        identity: deps.identity,
        deviceName,
        models: deps.manifest?.models ?? [],
        tools: deps.manifest?.tools ?? [],
        computeProfile: deps.manifest?.computeProfile ?? { canRunLocalModels: false }
      })
      manifestStore.set(fresh)
    }, intervalMs)
  }

  let stopped = false
  return {
    remoteExecutor,
    manifestStore,
    taskServer,
    responder,
    trustStore,
    identity: deps.identity,
    lease,
    peerModelRegistry,
    meshDecide,
    fanOutDecide,
    fanOutDispatch,
    broadcast: (method: string, params?: unknown) => transport.broadcast(method, params),
    transportPort,
    shutdown: async () => {
      if (stopped) return
      stopped = true
      if (manifestRefreshTimer) clearInterval(manifestRefreshTimer)
      discovery?.stop()
      if (config.discovery.enabled) await transport.stop().catch(() => {})
      // Release all tracked inflight tasks
      for (const taskId of inflightTasks.keys()) {
        lease.release(taskId)
      }
      inflightTasks.clear()
      cancelledTasks.clear()
      taskRetries.clear()
      audit.close()
      trustStore.close()
    }
  }
}
