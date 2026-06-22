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
 * keeps it for the lifetime of the mesh. If the connection drops, the bridge
 * automatically reconnects with exponential backoff (1s → 2s → 4s → …, capped
 * at 30s) until the peer comes back or the mesh shuts down. `runRemote` looks
 * up the client for the task's target.
 */

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

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
  /** Per-task AbortController, aborted when the lease expires or the task is
   *  cancelled. runRemote passes this into client.request() so a lease-expiry
   *  or external cancel breaks the pending request immediately (G3). */
  private readonly dispatchControllers = new Map<string, AbortController>()
  /** Reconnect timers per peer, so we can cancel them on shutdown. */
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopped = false

  constructor(deps: MeshDispatchBridgeDeps = {}) {
    this.deps = deps
  }

  /** Record which peer a task should be dispatched to. Called by the mesh
   *  runtime slot just before it hands off to `remoteExecutor`. */
  setDispatchTarget(taskId: string, targetDeviceId: string): void {
    this.dispatchTargets.set(taskId, targetDeviceId)
    this.dispatchControllers.set(taskId, new AbortController())
  }

  /** Clear a dispatch target after the task completes. */
  clearDispatchTarget(taskId: string): void {
    this.dispatchTargets.delete(taskId)
    this.dispatchControllers.delete(taskId)
  }

  /** Abort the pending request for a task (called on lease expiry or cancel).
   *  Breaks the client.request() promise so the caller's runRemote rejects
   *  promptly instead of waiting for the request's own timeout. */
  abortDispatch(taskId: string): void {
    this.dispatchControllers.get(taskId)?.abort()
  }

  /** Called by `bootMesh`'s `onPeerDiscovered` hook when mDNS surfaces a peer. */
  async onPeerDiscovered(peer: DiscoveredPeer): Promise<void> {
    this.peers.set(peer.deviceId, peer)
    // If we already have an open connection, skip.
    const existing = this.clients.get(peer.deviceId)
    if (existing?.isOpen) return
    await this.connectPeerWithRetry(peer, 0).catch(() => {
      // best-effort; the reconnect loop is already scheduled
    })
  }

  /** Connect to a peer, retrying with exponential backoff on failure. */
  private async connectPeerWithRetry(peer: DiscoveredPeer, attempt: number): Promise<void> {
    if (this.stopped) return
    const client = new MeshTransportClient()
    client.onDisconnected = () => {
      if (this.stopped) return
      console.warn(`[qwicks mesh] peer ${peer.deviceId.slice(0, 8)}… disconnected; scheduling reconnect`)
      this.clients.delete(peer.deviceId)
      this.scheduleReconnect(peer, 0)
    }
    try {
      await client.connect(`ws://${peer.host}:${peer.port}`)
      // Re-check stopped after the await: close() may have run while we were
      // connecting. If so, tear down the just-opened socket and bail —
      // otherwise we'd leak an orphaned client on a shut-down bridge (F9).
      if (this.stopped) {
        await client.close().catch(() => {})
        return
      }
      this.clients.set(peer.deviceId, client)
      console.warn(`[qwicks mesh] connected to peer ${peer.deviceId.slice(0, 8)}… (${peer.host}:${peer.port})`)
    } catch (error) {
      if (this.stopped) return
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 0) {
        console.warn(`[qwicks mesh] failed to connect to peer ${peer.deviceId.slice(0, 8)}… at ${peer.host}:${peer.port}: ${message}`)
      }
      this.scheduleReconnect(peer, attempt + 1)
    }
  }

  /** Schedule a reconnect after exponential backoff. */
  private scheduleReconnect(peer: DiscoveredPeer, attempt: number): void {
    if (this.stopped) return
    // Clear any existing timer for this peer
    const existing = this.reconnectTimers.get(peer.deviceId)
    if (existing) clearTimeout(existing)
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peer.deviceId)
      void this.connectPeerWithRetry(peer, attempt)
    }, delay)
    this.reconnectTimers.set(peer.deviceId, timer)
  }

  /** The `runRemote` callback handed to `bootMesh`. Ships `task/run` to the
   *  target peer and awaits its result. The abort signal is plumbed into the
   *  underlying request so a half-open socket (no close/error) still times out
   *  and a user/lease-initiated abort breaks the pending request promptly. */
  runRemote = async (params: TaskRunParams, signal: AbortSignal): Promise<ChildRunResult> => {
    const targetDeviceId =
      this.dispatchTargets.get(params.taskId) ??
      this.deps.resolveTarget?.(params) ??
      params.provenance[0]
    if (!targetDeviceId) {
      throw new Error('mesh dispatch bridge: cannot resolve target device for task')
    }

    const client = this.clients.get(targetDeviceId)
    if (!client || !client.isOpen) {
      throw new Error(`mesh dispatch bridge: peer ${targetDeviceId} is not connected (discovered: ${this.peers.has(targetDeviceId)})`)
    }

    // Merge the caller's abort signal with the bridge's per-task controller
    // so either one (user cancel, lease expiry via abortDispatch, or the
    // caller's own signal) breaks the pending request promptly.
    const taskController = this.dispatchControllers.get(params.taskId)
    const effectiveSignal = mergeAbortSignals(signal, taskController?.signal)

    // timeoutMs tied to the lease so the request fails before the lease does.
    const leaseTimeoutMs = (params.lease?.leaseTimeout ?? 300) * 1000
    const result = (await client.request('task/run', params, {
      timeoutMs: leaseTimeoutMs,
      signal: effectiveSignal
    })) as ChildRunResult
    return result
  }

  /** Send a JSON-RPC notification (e.g. `task/cancel`) to a specific peer. */
  async notifyPeer(deviceId: string, method: string, params?: unknown): Promise<void> {
    const client = this.clients.get(deviceId)
    if (!client) return
    client.notify(method, params)
  }

  /** Orchestrator-side cancel: looks up the worker that owns `taskId` (via
   *  the dispatch map) and sends `task/cancel` so the worker aborts its
   *  in-flight local executor. Also aborts the pending request() on this
   *  side so runRemote rejects immediately instead of waiting for timeout.
   *  No-op if the task already completed or the peer is disconnected. */
  async cancelRemote(taskId: string, _cancelToken: string): Promise<void> {
    // Abort the pending request locally first (fast path).
    this.abortDispatch(taskId)
    const targetDeviceId = this.dispatchTargets.get(taskId)
    if (!targetDeviceId) return
    const client = this.clients.get(targetDeviceId)
    if (!client?.isOpen) return
    client.notify('task/cancel', { taskId, cancelToken: _cancelToken })
  }

  /** Send a JSON-RPC request (e.g. `pairing/hello`) to a specific peer. */
  async requestPeer(deviceId: string, method: string, params?: unknown): Promise<unknown> {
    const client = this.clients.get(deviceId)
    if (!client) throw new Error(`no transport client for peer ${deviceId}`)
    return client.request(method, params)
  }

  /** Open a transport client to a peer that may not have been discovered via
   *  mDNS (e.g. manual pairing by host:port). Used by the pairing initiator.
   *  Registers the disconnect→reconnect watcher so the connection self-heals. */
  async connectPeer(peer: DiscoveredPeer): Promise<MeshTransportClient> {
    this.peers.set(peer.deviceId, peer)
    let client = this.clients.get(peer.deviceId)
    if (client?.isOpen) return client
    // Go through the retry-capable path so pairing-initiated connections also
    // self-heal on disconnect.
    await this.connectPeerWithRetry(peer, 0)
    client = this.clients.get(peer.deviceId)
    if (!client) throw new Error(`failed to connect to peer ${peer.deviceId}`)
    return client
  }

  /** Known discovered peers (deviceId → endpoint), for status reporting. */
  getDiscoveredPeers(): DiscoveredPeer[] {
    return [...this.peers.values()]
  }

  /** Close all transport clients and cancel reconnect timers. Called from
   *  mesh shutdown. */
  async close(): Promise<void> {
    this.stopped = true
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
    const closers = [...this.clients.values()].map((c) => c.close().catch(() => {}))
    await Promise.all(closers)
    this.clients.clear()
    this.peers.clear()
  }
}

/** Merge two abort signals into one that fires when EITHER source aborts.
 *  If both are undefined, returns a never-aborting signal. Used by runRemote
 *  to combine the caller's signal (user/DelegationRuntime) with the bridge's
 *  per-task controller (lease expiry / cancelRemote). */
function mergeAbortSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal {
  if (!a) return b ?? new AbortController().signal
  if (!b) return a
  if (a.aborted) return a
  if (b.aborted) return b
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return controller.signal
}
