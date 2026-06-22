import { MeshTransportClient } from '../transport/transport.js'
import type { MeshHandle } from '../index.js'
import type { MeshDispatchBridge } from './mesh-dispatch-bridge.js'
import type { PairingInitiator } from '../pairing/pairing.js'
import type { PeerTrustStore } from '../pairing/peer-trust-store.js'
import type { PairingResponder } from '../pairing/pairing.js'

/**
 * Read-only + action facade over the booted mesh, surfaced on `ServerRuntime`
 * so the HTTP route layer can query status and drive pairing without depending
 * on the full `MeshHandle` (which carries executors and other internals).
 *
 * Constructed by `runtime-factory.ts` from a successful `bootMesh` result +
 * the dispatch bridge. Routes under `/v1/mesh/*` consume this exclusively.
 */
export interface MeshRuntimeHandle {
  /** The underlying mesh handle (for advanced callers). */
  readonly handle: MeshHandle
  /** The outbound dispatch bridge (connects to discovered peers). */
  readonly bridge: MeshDispatchBridge

  /** Snapshot of mesh status for `GET /v1/mesh/status`. */
  status(): {
    enabled: true
    deviceId: string
    deviceName: string
    transportPort: number
    connectedPeers: number
    discoveredPeers: number
  }

  /** List paired peers (from the trust store inside bootMesh) + liveness. */
  peers(): Promise<Array<{
    deviceId: string
    deviceName?: string
    fingerprint?: string
    lastSeenAt?: string
    pairedAt?: string
    online: boolean
  }>>

  /** List models offered by remote peers (for model-router UI injection). */
  models(): ReturnType<MeshHandle['peerModelRegistry']['listModels']>

  /** Pairing initiator: connect to a responder by host:port, run hello. */
  pairInitiate(input: { host: string; port: number }): Promise<{
    accepted: boolean
    responderDeviceId?: string
    responderDeviceName?: string
    reason?: string
  }>

  /** Pairing initiator: submit the 6-digit code shown on the responder. */
  pairVerify(input: { code: string }): Promise<{
    verified: boolean
    peerDeviceId?: string
    reason?: string
  }>

  /** Pending pairing challenges seen by this device as responder (for UI). */
  pendingPairings(): Array<{
    initiatorDeviceId: string
    initiatorDeviceName: string
    code: string
    expiresAt: string
  }>
}

/**
 * Adapt a booted `MeshHandle` + `MeshDispatchBridge` into the read-only
 * `MeshRuntimeHandle` consumed by the route layer.
 */
export function createMeshRuntimeHandle(
  handle: MeshHandle,
  bridge: MeshDispatchBridge,
  opts: {
    identity: { deviceId: string }
    deviceName: string
    trustStore: PeerTrustStore
    responder: PairingResponder
    createInitiator: () => PairingInitiator
  }
): MeshRuntimeHandle {
  // In-flight pairing initiator state (hello must precede verify).
  let pendingInitiator: PairingInitiator | undefined
  let pendingResponderEndpoint: { host: string; port: number; deviceId?: string } | undefined

  return {
    handle,
    bridge,

    status() {
      const discovered = bridge.getDiscoveredPeers()
      return {
        enabled: true as const,
        deviceId: opts.identity.deviceId,
        deviceName: opts.deviceName,
        transportPort: handle.transportPort,
        connectedPeers: discovered.length,
        discoveredPeers: discovered.length
      }
    },

    async peers() {
      const trusted = await opts.trustStore.listAll()
      const discoveredIds = new Set(bridge.getDiscoveredPeers().map((p) => p.deviceId))
      return trusted
        .filter((p) => !p.revokedAt)
        .map((p) => ({
          deviceId: p.peerDeviceId,
          ...(p.peerDeviceName ? { deviceName: p.peerDeviceName } : {}),
          ...(p.peerFingerprint ? { fingerprint: p.peerFingerprint } : {}),
          ...(p.lastSeenAt ? { lastSeenAt: p.lastSeenAt } : {}),
          ...(p.pairedAt ? { pairedAt: p.pairedAt } : {}),
          online: discoveredIds.has(p.peerDeviceId)
        }))
    },

    models() {
      return handle.peerModelRegistry.listModels()
    },

    async pairInitiate(input) {
      pendingInitiator = opts.createInitiator()
      pendingResponderEndpoint = { host: input.host, port: input.port }
      const client = new MeshTransportClient()
      try {
        await client.connect(`ws://${input.host}:${input.port}`)
        const send = async (method: string, params: unknown) => client.request(method, params)
        const result = await pendingInitiator.hello(send)
        if (result.accepted && result.responderDeviceId) {
          pendingResponderEndpoint.deviceId = result.responderDeviceId
          await bridge.connectPeer({ deviceId: result.responderDeviceId, host: input.host, port: input.port }).catch(() => {})
        }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { accepted: false, reason: message }
      } finally {
        await client.close().catch(() => {})
      }
    },

    async pairVerify(input) {
      if (!pendingInitiator || !pendingResponderEndpoint) {
        return { verified: false, reason: 'no_pending_pairing (call pairInitiate first)' }
      }
      const client = new MeshTransportClient()
      try {
        await client.connect(`ws://${pendingResponderEndpoint.host}:${pendingResponderEndpoint.port}`)
        const send = async (method: string, params: unknown) => client.request(method, params)
        // PairingInitiator.verify returns SessionKeyMaterial on success and
        // throws on failure — adapt to the {verified,...} facade shape.
        await pendingInitiator.verify(send, input.code)
        const peerDeviceId = pendingResponderEndpoint.deviceId
        pendingInitiator = undefined
        pendingResponderEndpoint = undefined
        return { verified: true, ...(peerDeviceId ? { peerDeviceId } : {}) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { verified: false, reason: message }
      } finally {
        await client.close().catch(() => {})
      }
    },

    pendingPairings() {
      return opts.responder.listPending()
    }
  }
}
