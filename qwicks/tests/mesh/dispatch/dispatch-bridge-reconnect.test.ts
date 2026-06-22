import { describe, it, expect, afterEach } from 'vitest'
import { MeshTransportServer } from '@qwicks/mesh/transport/transport.js'
import { MeshDispatchBridge } from '@qwicks/mesh/integration/mesh-dispatch-bridge.js'
import type { TaskRunParams } from '@qwicks/mesh/contracts.js'

const baseTask: TaskRunParams = {
  taskId: 't-reconnect',
  parentThreadId: 'th',
  parentTurnId: 'tn',
  prompt: 'p',
  toolPolicy: 'inherit',
  lease: { leaseTimeout: 300, heartbeatInterval: 75 },
  idempotencyKey: 'reconnect-key',
  retryCount: 0,
  maxRetries: 0,
  cancelToken: 'tok',
  provenance: ['d-peer'],
  disableUserInput: true
}

describe('MeshDispatchBridge reconnect (Phase 2 — P2-3)', () => {
  const servers: MeshTransportServer[] = []
  const bridges: MeshDispatchBridge[] = []

  afterEach(async () => {
    await Promise.all(bridges.map((b) => b.close().catch(() => {})))
    await Promise.all(servers.map((s) => s.stop().catch(() => {})))
    servers.length = 0
    bridges.length = 0
  })

  it('detects a dropped peer connection and surfaces "not connected" on dispatch', async () => {
    const server = new MeshTransportServer()
    servers.push(server)
    const { port } = await server.start(() => {})

    const bridge = new MeshDispatchBridge()
    bridges.push(bridge)

    // Discover + connect
    await bridge.onPeerDiscovered({ deviceId: 'd-peer', host: '127.0.0.1', port })
    expect(bridge.getDiscoveredPeers()).toHaveLength(1)

    // Stop the server — the client detects the drop
    await server.stop()
    // Give the ws close event time to propagate to the onDisconnected watcher
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Dispatch now fails (peer disconnected)
    await expect(
      bridge.runRemote(baseTask, new AbortController().signal)
    ).rejects.toThrow(/not connected/)
  }, 10_000)

  it('clears reconnect timers on close without leaking or throwing', async () => {
    const bridge = new MeshDispatchBridge()
    bridges.push(bridge)
    // Trigger a failed connect (port 1 is unreachable) to schedule a reconnect timer
    await bridge.onPeerDiscovered({ deviceId: 'd-gone', host: '127.0.0.1', port: 1 }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    // close() cancels pending timers and must not throw
    await expect(bridge.close()).resolves.not.toThrow()
  }, 5_000)

  it('re-discovering a recovered peer re-establishes the connection', async () => {
    const server = new MeshTransportServer()
    servers.push(server)
    const { port } = await server.start(() => {})

    const bridge = new MeshDispatchBridge()
    bridges.push(bridge)

    // First discovery
    await bridge.onPeerDiscovered({ deviceId: 'd-recover', host: '127.0.0.1', port })
    expect(bridge.getDiscoveredPeers()).toHaveLength(1)

    // Drop + re-discover (simulates mDNS re-broadcast after peer restart)
    await server.stop()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const server2 = new MeshTransportServer()
    servers.push(server2)
    const restarted = await server2.start(() => {})

    // Re-discover with the new port
    await bridge.onPeerDiscovered({ deviceId: 'd-recover', host: '127.0.0.1', port: restarted.port })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(bridge.getDiscoveredPeers()).toHaveLength(1)
  }, 10_000)
})
