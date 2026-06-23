import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRouter } from './routes/index.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileSessionStore, FileThreadStore } from '../adapters/file/index.js'
import { HybridSessionStore, HybridThreadStore } from '../adapters/hybrid/index.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { buildGoalLocalTools } from '../adapters/tool/goal-tools.js'
import { buildTodoLocalTools } from '../adapters/tool/todo-tools.js'
import { LocalToolHost, buildDefaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { buildSkillToolProviders } from '../adapters/tool/skill-tool-provider.js'
import { buildDelegationToolProviders } from '../adapters/tool/delegation-tool-provider.js'
import { buildWebToolProviders } from '../adapters/tool/web-tool-provider.js'
import { buildImageGenToolProviders } from '../adapters/tool/image-gen-tool-provider.js'
import { buildComputerUseToolProviders } from '../adapters/tool/computer-use-tool-provider.js'
import {
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders
} from '../adapters/tool/media-gen-tool-provider.js'
import { LocalWorkspaceInspector } from '../adapters/workspace/local-workspace-inspector.js'
import { createImmutablePrefix, setSystemPrompt } from '../cache/immutable-prefix.js'
import {
  buildRuntimeCapabilityManifest,
  type MemoryCapabilityConfig,
  type QWicksCapabilitiesConfig
} from '../contracts/capabilities.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig
} from '../loop/model-context-profile.js'
import {
  DEFAULT_QUALITY_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  expandHomePath,
  type QualityConfig,
  type RuntimeTuningConfig,
  type ServeProviderConfig,
  type StorageConfig
} from '../config/qwicks-config.js'
import { buildBuiltinHooks } from '../hooks/builtins/index.js'
import { mergeBuiltinSubagentProfiles } from '../delegation/builtin-profiles.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { QWICKS_SYSTEM_PROMPT } from '../prompt/qwicks-system-prompt.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { LlmDebugRecorder } from '../services/llm-debug-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { ReviewService } from '../services/review-service.js'
import { UsageService } from '../services/usage-service.js'
import type { UsageEvent } from '../contracts/events.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  type ModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { SkillRuntime } from '../skills/skill-runtime.js'
import { resolveConfiguredHooks, type HooksConfig } from '../hooks/hook-config.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { DreamMemoryStore } from '../dream/dream-store.js'
import { SqliteMemoryRepository } from '../dream/storage/sqlite-repository.js'
import { DreamMemorySystem } from '../dream/chat/pipeline.js'
import { DelegationRuntime, FileDelegationStore } from '../delegation/delegation-runtime.js'
import { createChildAgentExecutor } from '../delegation/child-agent-executor.js'
import { createMeshRuntimeSlot } from '../mesh/integration/mesh-runtime-slot.js'
import { bootMesh, type MeshHandle } from '../mesh/index.js'
import { MeshConfig, type MeshConfig as MeshConfigType } from '../mesh/config.js'
import { loadOrCreateDeviceIdentity } from '../mesh/identity/device-identity.js'
import { MeshDispatchBridge } from '../mesh/integration/mesh-dispatch-bridge.js'
import { createMemoryStoreQueryAdapter } from '../mesh/integration/memory-store-adapter.js'
import { createMeshRuntimeHandle, type MeshRuntimeHandle } from '../mesh/integration/mesh-runtime-handle.js'
import { PairingInitiator } from '../mesh/pairing/pairing.js'
import { AuditLog } from '../mesh/audit/audit-log.js'
import type { ToolInput, ModelInput } from '../mesh/manifest/manifest-builder.js'

export type QWicksServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  runtimeToken: string
  apiKey: string
  baseUrl: string
  modelProxyUrl?: string
  endpointFormat?: ModelEndpointFormat
  /**
   * Extra providers the runtime can route to per request. Keyed by
   * provider id (matched against `ModelRequest.providerId`); each entry
   * supplies its own HTTP credentials. Threads created with a
   * `providerId` matching a key here route their turns to that client;
   * any unrecognized id falls back to the default credentials above.
   * Empty/absent → runtime stays single-provider (current behavior).
   */
  providers?: Record<string, ServeProviderConfig>
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  storage?: StorageConfig
  capabilities?: QWicksCapabilitiesConfig
  /** Command hooks from config.json; resolved and wired into tool hosts and the loop. */
  hooks?: HooksConfig
  /** Design-quality linter config; drives the builtin PostToolUse hook. */
  quality?: QualityConfig
  /** LAN-distributed agent collaboration (RFC 000). When `mesh.enabled=true`
   *  the runtime boots the mesh subsystem and routes eligible child runs to
   *  discovered peers. Disabled by default; byte-identical to pre-mesh when off. */
  mesh?: MeshConfigType
  startedAt?: string
}

export type QWicksServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
export async function createQWicksServeRuntime(
  options: QWicksServeRuntimeOptions
): Promise<ServerRuntime> {
  await mkdir(options.dataDir, { recursive: true })
  const eventBus = new InMemoryEventBus()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
  })
  const sessionStore = stores.sessionStore
  const threadStore = stores.threadStore
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const workspaceInspector = new LocalWorkspaceInspector()
  const usageService = new UsageService()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq, nowIso })
  let prefix = createImmutablePrefix({
    systemPrompt: QWICKS_SYSTEM_PROMPT,
    pinnedConstraints: [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable QWicks prefix byte-stable for prompt-cache reuse'
    ]
  })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  const modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const modelCapabilities = (model: string) => modelCapabilitiesForModel(model, modelProfiles)
  const llmDebug = new LlmDebugRecorder()
  const streamIdleOverride =
    options.runtime?.streamIdleTimeoutMs !== undefined
      ? { streamIdleTimeoutMs: options.runtime.streamIdleTimeoutMs }
      : {}
  const defaultModelClient = new CompatModelClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    modelProxyUrl: options.modelProxyUrl,
    endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
    model: options.model,
    modelCapabilities,
    debugSink: llmDebug,
    ...streamIdleOverride
  })
  // Per-provider HTTP clients (workflow/scheduled task can pick a non-default
  // provider per request via `ModelRequest.providerId`). The wrapper falls
  // back to the default client when the id is absent or unknown, so behavior
  // is unchanged for single-provider deployments.
  const providerClients = new Map<string, CompatModelClient>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (!trimmedId) continue
    providerClients.set(
      trimmedId,
      new CompatModelClient({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelProxyUrl: provider.modelProxyUrl ?? options.modelProxyUrl,
        endpointFormat: provider.endpointFormat ?? options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
        model: options.model,
        modelCapabilities,
        debugSink: llmDebug,
        ...streamIdleOverride
      })
    )
  }
  const modelClient = new MultiProviderModelClient({
    default: defaultModelClient,
    providers: providerClients
  })
  // Independent I/O; all must still finish before the server listens.
  const [mcpProviders, skillRuntime] = await Promise.all([
    buildMcpToolProviders(options.capabilities?.mcp),
    SkillRuntime.create(options.capabilities?.skills),
    seedUsageCarryover({ threadStore, sessionStore, usageService })
  ])
  // Fold the available-skills catalog into the stable prefix once per session so
  // the model knows which skills exist (and where to read them) even when no
  // trigger fires. Stays byte-stable across turns, preserving prompt-cache reuse.
  const skillCatalog = skillRuntime.catalogInstruction()
  if (skillCatalog) {
    prefix = setSystemPrompt(prefix, `${QWICKS_SYSTEM_PROMPT}\n\n${skillCatalog}`)
  }
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    model: modelClient,
    usage: usageService,
    prefix,
    defaultModel: options.model,
    contextCompaction: options.contextCompaction,
    ids,
    nowIso
  })
  const reviewService = new ReviewService({
    threadStore,
    turns: turnService,
    model: modelClient,
    defaultModel: options.model,
    nowIso,
    modelCapabilities,
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(tokenEconomy ? { tokenEconomy } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {})
  })
  const webProviders = buildWebToolProviders(options.capabilities?.web)
  const attachmentStore = options.capabilities?.attachments.enabled
    ? new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config: options.capabilities.attachments,
        nowIso
      })
    : undefined
  const memory = options.capabilities?.memory.enabled
    ? buildMemoryStore(options.capabilities.memory, join(options.dataDir, 'memory'))
    : undefined
  const memoryStore = memory?.store
  const dreamSystem = memory?.dreamSystem
  const imageGenProviders = buildImageGenToolProviders(options.capabilities?.imageGen, {
    attachmentStore,
    nowIso
  })
  const speechGenProviders = buildSpeechGenToolProviders(options.capabilities?.speechGen, { nowIso })
  const musicGenProviders = buildMusicGenToolProviders(options.capabilities?.musicGen, { nowIso })
  const videoGenProviders = buildVideoGenToolProviders(options.capabilities?.videoGen, { nowIso })
  const computerUseProviders = await buildComputerUseToolProviders(options.capabilities?.computerUse)
  const baseToolProviders = [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    },
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore),
    ...buildSkillToolProviders(skillRuntime),
    ...imageGenProviders.providers,
    ...speechGenProviders.providers,
    ...musicGenProviders.providers,
    ...videoGenProviders.providers
    // NOTE: computer_use is intentionally NOT in baseToolProviders — host
    // control must not be delegable to subagents. It is added to the main
    // registry only (below).
  ]
  // Builtin hooks are first-party and always assembled before config hooks.
  // The design-quality linter folds findings into write/edit results so the
  // model self-corrects; config-loaded command hooks run after it.
  const resolvedHooks = [
    ...buildBuiltinHooks({ quality: options.quality ?? DEFAULT_QUALITY_CONFIG }),
    ...resolveConfiguredHooks(options.hooks)
  ]
  const childRegistry = new CapabilityRegistry(baseToolProviders)
  const childToolHost = new LocalToolHost({
    registry: childRegistry,
    readTracker: true,
    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {})
  })
  // Mesh slot: async-boot-safe; before install() it is a pure pass-through.
  const meshSlot = createMeshRuntimeSlot(createChildAgentExecutor({
    model: modelClient,
    toolHost: childToolHost,
    prefix,
    defaultModel: options.model,
    models: options.models,
    contextCompaction: options.contextCompaction,
    approvalPolicy: options.approvalPolicy,
    sandboxMode: options.sandboxMode,
    modelCapabilities,
    skillRuntime,
    tokenEconomy,
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    ...(dreamSystem ? { dreamSystem } : {}),
    nowIso
  }))

  /* ---- Mesh boot (RFC 000 §4) ----
   * Only boot when (a) the user opted in via `mesh.enabled` and (b) subagents
   * are also enabled — the remote executor routes through DelegationRuntime,
   * so without subagents there's nowhere for mesh-dispatched tasks to land.
   * When either is off, `meshHandle` stays null, the slot is never installed,
   * and `meshSlot.executor` remains a pure local pass-through — byte-identical
   * to the pre-mesh path. */
  let meshHandle: MeshHandle | null = null
  let meshBridge: MeshDispatchBridge | null = null
  let meshRuntimeHandle: MeshRuntimeHandle | undefined
  if (options.mesh?.enabled && options.capabilities?.subagents.enabled) {
    try {
      const meshDataDir = join(options.dataDir, 'mesh')
      await mkdir(meshDataDir, { recursive: true })
      const identity = await loadOrCreateDeviceIdentity(meshDataDir)
      meshBridge = new MeshDispatchBridge()

      // Build the manifest inputs from the runtime's model + tool registry.
      const meshModels: ModelInput[] = options.models?.profiles
        ? Object.entries(options.models.profiles).map(([id, _profile]) => ({
            id,
            provider: 'local',
            contextWindow: 32768,
            maxOutput: 8192,
            supportsTools: true,
            supportsVision: false,
            available: true,
            version: '1'
          }))
        : [{ id: options.model, provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '1' }]
      const meshTools: ToolInput[] = []

      meshHandle = await bootMesh(MeshConfig.parse(options.mesh), {
        identity,
        dataDir: meshDataDir,
        localExecutor: meshSlot.executor,
        runRemote: meshBridge.runRemote,
        cancelRemote: async (taskId, cancelToken) => {
          await meshBridge!.cancelRemote(taskId, cancelToken)
        },
        isPeerAuthorized: () => true, // trust store check happens inside bootMesh via envelope verify
        onPeerDiscovered: (peer) => {
          void meshBridge!.onPeerDiscovered(peer)
        },
        ...(memoryStore
          ? {
              queryLocalMemory: createMemoryStoreQueryAdapter(memoryStore, identity.deviceId),
              maxTopK: options.mesh?.memory?.maxTopK ?? 10
            }
          : {}),
        ...(options.mesh?.deviceName ? { deviceName: options.mesh.deviceName } : {}),
        manifest: {
          models: meshModels,
          tools: meshTools,
          computeProfile: { canRunLocalModels: true }
        }
      })

      if (meshHandle) {
        const handle = meshHandle
        meshSlot.slot.install({
          remoteExecutor: handle.remoteExecutor,
          decide: handle.meshDecide,
          onDispatchRemote: (childId, workerDeviceId) => {
            meshBridge!.setDispatchTarget(childId, workerDeviceId)
            // Arm the lease so a silently-dropped worker (half-open TCP) is
            // detected and recovered instead of hanging the orchestrator.
            handle.lease.acquire(childId)
          },
          onDispatchComplete: (childId) => {
            meshBridge!.clearDispatchTarget(childId)
            // Task completed (or aborted) → release the lease so its expiry
            // timer doesn't fire a spurious recovery.
            handle.lease.release(childId)
          }
        })
        // Build the read-only facade the HTTP route layer consumes.
        meshRuntimeHandle = createMeshRuntimeHandle(meshHandle, meshBridge, {
          identity: { deviceId: identity.deviceId },
          deviceName: options.mesh?.deviceName ?? 'qwicks-mesh',
          trustStore: meshHandle.trustStore,
          responder: meshHandle.responder,
          createInitiator: () =>
            new PairingInitiator({
              identity,
              trustStore: meshHandle!.trustStore,
              audit: new AuditLog(join(meshDataDir, 'pair-initiator-audit.db')),
              deviceName: options.mesh?.deviceName ?? 'qwicks-mesh'
            })
        })
        console.warn(`[qwicks mesh] enabled (device=${identity.deviceId.slice(0, 8)}…, port=${meshHandle.transportPort})`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[qwicks mesh] failed to boot: ${message}`)
      meshHandle = null
      meshBridge = null
    }
  }

  const delegationRuntime = options.capabilities?.subagents.enabled
    ? new DelegationRuntime({
        config: mergeBuiltinSubagentProfiles(options.capabilities.subagents),
        store: new FileDelegationStore(join(options.dataDir, 'child-runs')),
        events,
        nowIso,
        executor: meshSlot.executor,
        recordExternalUsage: (threadId, usage) => {
          usageService.record(threadId, usage)
        }
      })
    : undefined
  const capabilities = buildRuntimeCapabilityManifest({
    config: options.capabilities,
    model: modelCapabilities(options.model),
    mcp: {
      configuredServers: Object.keys(options.capabilities?.mcp.servers ?? {}).length,
      connectedServers: mcpProviders.connectedServers,
      toolCount: mcpProviders.toolCount,
      lastError: mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
      search: {
        active: mcpProviders.search.active,
        indexedToolCount: mcpProviders.search.indexedToolCount,
        advertisedToolCount: mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: webProviders.fetchAvailable,
      searchAvailable: webProviders.searchAvailable,
      provider: webProviders.provider,
      reason: webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    skills: {
      configuredRoots: options.capabilities?.skills.roots.length,
      discoveredSkills: skillRuntime.count(),
      reason: skillRuntime.diagnostics().validationErrors[0]?.message
    },
    attachments: {
      available: Boolean(attachmentStore)
    },
    memory: {
      available: Boolean(memoryStore)
    },
    subagents: {
      available: Boolean(delegationRuntime)
    },
    imageGen: {
      available: imageGenProviders.available,
      reason: imageGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    speechGen: {
      available: speechGenProviders.available,
      reason: speechGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    musicGen: {
      available: musicGenProviders.available,
      reason: musicGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    videoGen: {
      available: videoGenProviders.available,
      reason: videoGenProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    computerUse: {
      available: computerUseProviders.available,
      reason: computerUseProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    }
  })
  const registry = new CapabilityRegistry([
    ...baseToolProviders,
    // Host control is available to the top-level agent only, never to
    // delegated subagents (which use childRegistry/baseToolProviders).
    ...computerUseProviders.providers,
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(threadService)
    },
    ...buildDelegationToolProviders(delegationRuntime)
  ])
  const toolHost = new LocalToolHost({
    registry,
    readTracker: true,
    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {})
  })
  // Keep retrying MCP servers that lost the fast startup connect race so a slow
  // npx cold start eventually shows up as connected instead of staying "error"
  // until the next runtime restart (issue #342). Both registries advertise the
  // MCP providers, so a late connection must be registered into each.
  void mcpProviders.startBackgroundReconnect((provider) => {
    try {
      registry.registerProvider(provider)
    } catch {
      // ignore duplicate/colliding registration
    }
    try {
      childRegistry.registerProvider(provider)
    } catch {
      // ignore duplicate/colliding registration
    }
  })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model: modelClient,
    toolHost,
    usage: usageService,
    events,
    turns: turnService,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso,
    modelCapabilities,
    skillRuntime,
    tokenEconomy,
    contextCompaction: options.contextCompaction,
    ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
    ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {}),
    ...(resolvedHooks.length ? { hooks: resolvedHooks } : {}),
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    ...(dreamSystem ? { dreamSystem } : {}),
    onPlanWritten: async ({ threadId, planId, relativePath, markdown }) => {
      await threadService.syncTodosFromPlan(threadId, {
        planId,
        relativePath,
        markdown,
        preserveCompleted: true
      })
    }
  })
  const startedAt = options.startedAt ?? nowIso()
  return {
    threadService,
    turnService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    llmDebug,
    approvalGate,
    userInputGate,
    workspaceInspector,
    toolHost,
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    ...(dreamSystem ? { dreamSystem } : {}),
    runTurn(threadId, turnId) {
      return loop.runTurn(threadId, turnId)
    },
    resumeInterruptedGoals(threadIds) {
      return loop.resumeInterruptedGoals(threadIds)
    },
    runReview(input) {
      return reviewService.runReview(input)
    },
    runtimeToken: options.runtimeToken,
    insecure: options.insecure,
    allocateSeq,
    nowIso,
    info: () => ({
      host: options.host,
      port: options.port,
      configPath: options.configPath,
      dataDir: options.dataDir,
      model: options.model,
      endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
      approvalPolicy: options.approvalPolicy,
      sandboxMode: options.sandboxMode,
      tokenEconomyMode: options.tokenEconomyMode,
      insecure: options.insecure,
      startedAt,
      pid: process.pid,
      capabilities
    }),
    toolDiagnostics: async () => ({
      providers: registry.diagnostics(),
      mcpServers: mcpProviders.diagnostics,
      mcpSearch: mcpProviders.search,
      webProviders: webProviders.diagnostics,
      skills: skillRuntime.diagnostics(),
      attachments: attachmentStore
        ? await attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: memoryStore
        ? await memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] },
      imageGen: imageGenProviders.diagnostics,
      speechGen: speechGenProviders.diagnostics,
      musicGen: musicGenProviders.diagnostics,
      videoGen: videoGenProviders.diagnostics
    }),
    skills: () => skillRuntime.diagnostics(),
    ...(meshRuntimeHandle ? { mesh: meshRuntimeHandle } : {}),
    shutdown: async () => {
      try {
        loop.shutdownGoalResume()
        await mcpProviders.close()
      } finally {
        // Tear down mesh last so in-flight remote tasks get a chance to drain.
        if (meshHandle) {
          meshSlot.slot.clear()
          await meshBridge?.close().catch(() => {})
          await meshHandle.shutdown().catch(() => {})
        }
        await stores.shutdown?.()
        // 释放 memory 后端可能持有的原生句柄(Dream SQLite 文件锁 / fd)。
        memory?.close()
      }
    }
  }
}

function tokenEconomyConfigForOptions(
  options: Pick<QWicksServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    return {
      sessionStore: new FileSessionStore({ dataDir: input.dataDir }),
      threadStore: new FileThreadStore({ dataDir: input.dataDir })
    }
  }

  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso
  })
  await threadStore.ready()
  return {
    threadStore,
    sessionStore: new HybridSessionStore({
      dataDir: input.dataDir,
      index: threadStore
    }),
    shutdown: async () => {
      threadStore.close()
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  if (typeof input.sessionStore.loadLatestUsageSnapshots === 'function') {
    try {
      const latest = await input.sessionStore.loadLatestUsageSnapshots()
      for (const record of latest) {
        input.usageService.seedThread(record.threadId, record.usage)
      }
      return
    } catch {
      // Fall through to JSONL replay when the optional index is unavailable.
    }
  }
  const threadSummaries = await input.threadStore.list()
  await Promise.all(threadSummaries.map(async (thread) => {
    const events = await input.sessionStore.loadEventsSince(thread.id, 0)
    const latestUsage = events.reduce<UsageEvent | null>((latest, event) => {
      if (event.kind !== 'usage') return latest
      if (!latest || event.seq > latest.seq) return event
      return latest
    }, null)
    if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
  }))
}

export async function startQWicksServe(
  options: QWicksServeRuntimeOptions
): Promise<QWicksServeHandle> {
  const runtime = await createQWicksServeRuntime(options)
  const router = buildRouter(runtime)
  const server = await startNodeHttpServer({
    router,
    host: options.host,
    port: options.port
  })
  // Background sweep after listen: settle turns orphaned by a crash so
  // clients stop spinning on them, without delaying readiness. Then resume
  // goals that were interrupted mid-run so an active goal doesn't sit "in
  // progress" forever with nothing running (QWicksAgent/QWicks#370).
  void runtime.turnService
    .reconcileOrphanedTurns()
    .then(async (threadIds) => {
      if (threadIds.length > 0) {
        console.warn(`[qwicks] marked orphaned turn(s) on ${threadIds.length} thread(s) as failed after restart`)
      }
      if (threadIds.length > 0 && runtime.resumeInterruptedGoals) {
        const resumed = await runtime.resumeInterruptedGoals(threadIds)
        if (resumed > 0) {
          console.warn(`[qwicks] auto-resumed ${resumed} interrupted goal(s) after restart`)
        }
      }
    })
    .catch((error) => {
      console.warn('[qwicks] orphaned turn reconciliation failed:', error)
    })
  return {
    ...server,
    runtime,
    close: async () => {
      try {
        await server.close()
      } finally {
        await runtime.shutdown?.()
      }
    }
  }
}

/**
 * Select the memory store backend by capability config.
 *
 * Strangler migration: `backend: 'file'` (default) keeps the legacy
 * JSON-per-record FileMemoryStore unchanged; `backend: 'dream'` switches to
 * the Dream memory system (SQLite + lifecycle + embeddings, phased in P0-P6).
 * Both implement the same `MemoryStore` interface, so the rest of the runtime
 * (HTTP routes, LLM memory tools, agent-loop injection, mesh sync, GUI) is
 * agnostic to the choice.
 *
 * Returns the store plus a `close()` for any backend holding native handles
 * (the Dream SQLite repository). The runtime must call `close()` on shutdown
 * to release file locks / file descriptors.
 */
export function buildMemoryStore(
  config: MemoryCapabilityConfig,
  legacyRootDir: string
): { store: MemoryStore; close: () => void; dreamSystem?: DreamMemorySystem } {
  if (config.backend === 'dream') {
    const sqlitePath = join(legacyRootDir, 'dream_memory.db')
    // 构建完整 DreamMemorySystem(facade),这样 HTTP 路由能暴露 summary/ledger/versions。
    // DreamMemorySystem 内部会创建自己的 repository + DreamMemoryStore,这里复用它的 store。
    const dreamSystem = new DreamMemorySystem({ dataDir: legacyRootDir })
    const store = dreamSystem.dreamStore
    return {
      store,
      dreamSystem,
      close: () => {
        try {
          dreamSystem.close()
        } catch {
          // 防御性:关闭失败不应阻塞 shutdown。
        }
      }
    }
  }
  return { store: new FileMemoryStore({ rootDir: legacyRootDir, config }), close: () => {} }
}
