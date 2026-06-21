import { join } from 'node:path'
import type { ChildRunExecutor } from '../delegation/delegation-runtime.js'
import { MeshConfig } from './config.js'
import type { DeviceIdentity } from './identity/device-identity.js'
import { PeerTrustStore } from './pairing/peer-trust-store.js'
import { PairingResponder } from './pairing/pairing.js'
import { AuditLog } from './audit/audit-log.js'
import { ManifestStore, buildManifest, type ToolInput, type ModelInput } from './manifest/manifest-builder.js'
import { createRemoteChildExecutor, type RemoteExecutorDeps } from './dispatch/remote-executor.js'
import { TaskServer } from './dispatch/task-server.js'
import { TaskLease } from './lease/lease.js'
import { MeshTransportServer } from './transport/transport.js'
import { MeshDiscovery, type BonjourLike } from './discovery/mdns.js'
import type { ChildRunResult, TaskRunParams } from './contracts.js'

/**
 * Mesh entry point (RFC 000 §4, §5).
 *
 * `bootMesh` is the single place QWicks touches to bring up Mesh. It is only
 * ever called when `mesh.enabled === true`; otherwise it returns `null` and
 * starts nothing — the rest of QWicks behaves as if Mesh were not installed.
 *
 * When enabled, it loads identity, opens the trust store + audit log, builds the
 * local manifest, starts the transport server + mDNS discovery, and assembles
 * the remote executor + task server + lease. The handle exposes `remoteExecutor`
 * (to register in `DelegationRuntime.options.executors`) and `shutdown()`.
 */

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
  manifest?: { models: ModelInput[]; tools: ToolInput[]; computeProfile: { canRunLocalModels: boolean; cpuCores?: number; ramGb?: number; maxModelParamsB?: number } }
}

export interface MeshHandle {
  remoteExecutor: ChildRunExecutor
  manifestStore: ManifestStore
  taskServer: TaskServer
  responder: PairingResponder
  shutdown: () => Promise<void>
}

export async function bootMesh(config: MeshConfig, deps: BootDeps): Promise<MeshHandle | null> {
  if (!config.enabled) return null

  const trustStore = new PeerTrustStore(join(deps.dataDir, 'mesh-trust.db'))
  const audit = new AuditLog(join(deps.dataDir, 'mesh-audit.db'))
  const manifestStore = new ManifestStore()

  const localManifest = buildManifest({
    identity: deps.identity,
    deviceName: deps.deviceName ?? config.deviceName ?? 'qwicks-mesh',
    models: deps.manifest?.models ?? [],
    tools: deps.manifest?.tools ?? [],
    computeProfile: deps.manifest?.computeProfile ?? { canRunLocalModels: false }
  })
  manifestStore.set(localManifest)

  const responder = new PairingResponder({
    identity: deps.identity,
    trustStore,
    audit,
    deviceName: deps.deviceName ?? config.deviceName ?? 'qwicks-mesh'
  })

  const taskServer = new TaskServer({
    isPeerAuthorized: deps.isPeerAuthorized,
    localExecutor: deps.localExecutor,
    audit,
    selfDeviceId: deps.identity.deviceId
  })

  const executorDeps: RemoteExecutorDeps = {
    selfDeviceId: deps.identity.deviceId,
    runRemote: deps.runRemote,
    ...(deps.cancelRemote ? { cancelRemote: deps.cancelRemote } : {}),
    lease: { leaseTimeout: config.task.defaultLeaseTimeout, heartbeatInterval: config.task.defaultHeartbeatInterval },
    maxRetries: config.task.maxRetries
  }
  const remoteExecutor = createRemoteChildExecutor(executorDeps)

  const lease = new TaskLease(
    {
      leaseTimeoutMs: config.task.defaultLeaseTimeout * 1000,
      heartbeatIntervalMs: config.task.defaultHeartbeatInterval * 1000
    },
    (taskId) => {
      void deps.cancelRemote?.(taskId, '')
      void audit.record({ kind: 'lease_expired', from: deps.identity.deviceId, to: '?', outcome: 'timeout', traceId: taskId, taskId, timestamp: new Date().toISOString(), detail: {} })
    }
  )

  const transport = new MeshTransportServer()
  let transportPort = 0
  if (config.discovery.enabled) {
    const started = await transport.start(() => {})
    transportPort = started.port
  }

  let discovery: MeshDiscovery | undefined
  if (config.discovery.enabled) {
    discovery = new MeshDiscovery({
      identity: {
        deviceId: deps.identity.deviceId,
        fingerprint: deps.identity.fingerprint,
        protocolVersion: '1',
        deviceName: deps.deviceName ?? config.deviceName ?? 'qwicks-mesh',
        manifestVersion: localManifest.manifestVersion
      },
      port: transportPort,
      selfDeviceId: deps.identity.deviceId,
      ...(deps.discovery ? { bonjour: deps.discovery } : {})
    })
    discovery.start((peer) => deps.onPeerDiscovered?.(peer))
  }

  let stopped = false
  return {
    remoteExecutor,
    manifestStore,
    taskServer,
    responder,
    shutdown: async () => {
      if (stopped) return
      stopped = true
      discovery?.stop()
      if (config.discovery.enabled) await transport.stop().catch(() => {})
      audit.close()
      trustStore.close()
    }
  }
}
