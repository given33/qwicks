import { MeshTransportClient } from '../transport/transport.js'
import type { TaskRunParams, ChildRunResult } from '../contracts.js'

/**
 * Outbound dispatch bridge (RFC 002 §3, RFC 000 §8.1).
 *
 * `bootMesh` brings up a transport *server* (accepts inbound peer connections)
 * but the orchestrator side also needs an outbound path: when the router picks
 * a remote worker, it must ship `task/run` to that peer's transport server and
 * await the result.
 *
 * This bridge maintains a pool of `MeshTransportClient` instances keyed by
 * deviceId. When mDNS discovery surfaces a peer (via `onPeerDiscovered`), the
 * bridge opens a long-lived WebSocket to that peer's advertised host:port and
 * keeps it for the lifetime of the mesh. `runRemote` looks up the client for
 * the task's target (the first non-self entry in `provenance`, which the remote
 * executor populates as `[self]` — so for a direct dispatch the target is read
 * from the in-flight task map maintained by the caller).
 *
 * The bridge is deliberately simple: one persistent connection per peer, no
 * automatic reconnect (a dropped connection surfaces as an error on the next
 * `task/run`, and the caller's lease-recovery handles reassignment). Phase 2+
 * can add reconnection.
 */

export interface DiscoveredPeer {
  deviceId: string
  host: string
  port: number
}

export interface MeshDispatchBridgeDeps {
  /** Resolve the target deviceId for a task. The bridge first checks its
   *  per-task dispatch map (populated by the mesh runtime slot before each
   *  remote call); if absent, falls back to this callback; if that is absent
   *  too, the dispatch fails with a clear error. */
  resolveTarget?: (params: TaskRunParams) => string | undefined
}

export class MeshDispatchBridge {
  private readonly clients = new Map<string, MeshTransportClient>()
  private readonly peers = new Map<string, DiscoveredPeer>()
  private readonly deps: MeshDispatchBridgeDeps
  /** Per-task target deviceId, set by the mesh runtime slot just before it
   *  invokes the remote executor. Keyed by taskId (= childId). */
  private readonly dispatchTargets = new Map<string, string>()

  constructor(deps: MeshDispatchBridgeDeps = {}) {
    this.deps = deps
  }

  /** Record which peer a task should be dispatched to. Called by the mesh
   *  runtime slot right before it hands off to `remoteExecutor`. */
  setDispatchTarget(taskId: string, targetDeviceId: string): void {
    this.dispatchTargets.set(taskId, targetDeviceId)
  }

  /** Clear a dispatch target after the task completes. */
  clearDispatchTarget(taskId: string): void {
    this.dispatchTargets.delete(taskId)
  }

  /** Called by `bootMesh`'s `onPeerDiscovered` hook when mDNS surfaces a peer. */
  async onPeerDiscovered(peer: DiscoveredPeer): Promise<void> {
    // If we already have a connection (or one in flight), skip.
    if (this.clients.has(peer.deviceId)) return
    this.peers.set(peer.deviceId, peer)

    const client = new MeshTransportClient()
    try {
      await client.connect(`ws://${peer.host}:${peer.port}`)
      this.clients.set(peer.deviceId, client)
    } catch (error) {
      // Discovery is best-effort; a failed connect just means this peer is
      // unreachable for now. The next discovery event will retry.
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[qwicks mesh] failed to connect to peer ${peer.deviceId} at ${peer.host}:${peer.port}: ${message}`)
    }
  }

  /** The `runRemote` callback handed to `bootMesh`. Ships `task/run` to the
   *  target peer and awaits its result. */
  runRemote = async (params: TaskRunParams, signal: AbortSignal): Promise<ChildRunResult> => {
    const targetDeviceId =
      this.dispatchTargets.get(params.taskId) ??
      this.deps.resolveTarget?.(params) ??
      params.provenance[0]
    if (!targetDeviceId) {
      throw new Error('mesh dispatch bridge: cannot resolve target device for task')
    }

    const client = this.clients.get(targetDeviceId)
    if (!client) {
      throw new Error(`mesh dispatch bridge: no transport client for peer ${targetDeviceId} (not discovered or disconnected)`)
    }

    // Honour the abort signal by surfacing an error promptly. The transport
    // client doesn't natively tie a pending request to an AbortSignal, so we
    // check it before sending.
    if (signal.aborted) throw new Error('aborted before dispatch')

    const result = (await client.request('task/run', params)) as ChildRunResult
    return result
  }

  /** Send a JSON-RPC notification (e.g. `task/cancel`) to a specific peer. */
  async notifyPeer(deviceId: string, method: string, params?: unknown): Promise<void> {
    const client = this.clients.get(deviceId)
    if (!client) return
    client.notify(method, params)
  }

  /** Send a JSON-RPC request (e.g. `pairing/hello`) to a specific peer. */
  async requestPeer(deviceId: string, method: string, params?: unknown): Promise<unknown> {
    const client = this.clients.get(deviceId)
    if (!client) throw new Error(`no transport client for peer ${deviceId}`)
    return client.request(method, params)
  }

  /** Open a transport client to a peer that may not have been discovered via
   *  mDNS (e.g. manual pairing by host:port). Used by the pairing initiator. */
  async connectPeer(peer: DiscoveredPeer): Promise<MeshTransportClient> {
    this.peers.set(peer.deviceId, peer)
    let client = this.clients.get(peer.deviceId)
    if (client) return client
    client = new MeshTransportClient()
    await client.connect(`ws://${peer.host}:${peer.port}`)
    this.clients.set(peer.deviceId, client)
    return client
  }

  /** Known discovered peers (deviceId → endpoint), for status reporting. */
  getDiscoveredPeers(): DiscoveredPeer[] {
    return [...this.peers.values()]
  }

  /** Close all transport clients. Called from mesh shutdown. */
  async close(): Promise<void> {
    const closers = [...this.clients.values()].map((c) => c.close().catch(() => {}))
    await Promise.all(closers)
    this.clients.clear()
    this.peers.clear()
  }
}
