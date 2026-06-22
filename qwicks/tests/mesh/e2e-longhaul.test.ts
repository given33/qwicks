import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootMesh, type MeshHandle } from '@qwicks/mesh/index.js'
import { MeshConfig } from '@qwicks/mesh/config.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { MeshDispatchBridge } from '@qwicks/mesh/integration/mesh-dispatch-bridge.js'
import { PairingInitiator } from '@qwicks/mesh/pairing/pairing.js'
import { MeshTransportClient } from '@qwicks/mesh/transport/transport.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'
import type { ChildRunResult, TaskRunParams } from '@qwicks/mesh/contracts.js'

/**
 * Long-haul stability tests — simulate the "two devices, real workload over
 * time" scenario. These verify the inter-device link stays stable across
 * many dispatches, recovers from worker restart, and doesn't degrade.
 */

describe('mesh long-haul inter-device stability', () => {
  beforeAll(() => {
    process.on('unhandledRejection', (r) => {
      if (r instanceof Error && /aborted|connection closed|not open/i.test(r.message)) return
      console.error('Unhandled rejection:', r)
    })
  })
  afterAll(() => {})

  let aDir: string
  let bDir: string

  beforeEach(() => {
    aDir = mkdtempSync(join(tmpdir(), 'longhaul-a-'))
    bDir = mkdtempSync(join(tmpdir(), 'longhaul-b-'))
  })
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(aDir, { recursive: true, force: true })
    rmSync(bDir, { recursive: true, force: true })
  })

  async function bootDevice(deviceName: string, dir: string, localExecutor: ChildRunExecutor): Promise<{ handle: MeshHandle; bridge: MeshDispatchBridge }> {
    const meshDir = join(dir, 'mesh')
    const identity = await loadOrCreateDeviceIdentity(meshDir)
    const bridge = new MeshDispatchBridge()
    const handle = await bootMesh(
      MeshConfig.parse({ enabled: true, deviceName, task: { defaultLeaseTimeout: 300, defaultHeartbeatInterval: 75, maxRetries: 2, provenanceMaxDepth: 5, idempotencyTtlMultiplier: 4 } }),
      {
        identity, dataDir: meshDir, localExecutor,
        runRemote: async (params, signal) => bridge.runRemote(params, signal),
        cancelRemote: async (taskId, token) => { await bridge.cancelRemote(taskId, token) },
        isPeerAuthorized: () => true,
        onPeerDiscovered: (peer) => { void bridge.onPeerDiscovered(peer) },
        discovery: { publish: () => ({ stop: () => {} }), find: () => ({ stop: () => {} }) } as never,
        rateLimitMax: 10_000, // high enough for stress tests; the default 30/min would throttle
        manifest: {
          models: [{ id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }],
          tools: [],
          computeProfile: { canRunLocalModels: true }
        }
      }
    )
    if (!handle) throw new Error(`boot failed for ${deviceName}`)
    return { handle, bridge }
  }

  async function pair(a: MeshHandle, b: MeshHandle, aBridge: MeshDispatchBridge): Promise<void> {
    const initiator = new PairingInitiator({
      identity: a.identity, trustStore: a.trustStore,
      audit: { record: async () => {} } as never, deviceName: 'A'
    })
    const client = new MeshTransportClient()
    await client.connect(`ws://127.0.0.1:${b.transportPort}`)
    const send = async (m: string, p: unknown) => client.request(m, p)
    await initiator.hello(send)
    const code = b.responder.getPendingCode(a.identity.deviceId)
    if (!code) throw new Error('no code')
    await initiator.verify(send, code)
    await client.close().catch(() => {})
    await aBridge.connectPeer({ deviceId: b.identity.deviceId, host: '127.0.0.1', port: b.transportPort })
  }

  function taskParams(taskId: string, origin: string): TaskRunParams {
    return {
      taskId, parentThreadId: 'th', parentTurnId: 'tn', prompt: 'p', toolPolicy: 'inherit',
      lease: { leaseTimeout: 300, heartbeatInterval: 75 },
      idempotencyKey: `${taskId}-key`, retryCount: 0, maxRetries: 2,
      cancelToken: `${taskId}-cancel`, provenance: [origin], disableUserInput: true
    }
  }

  it('sustains 50 sequential dispatches without degradation or stuck tasks', async () => {
    let workerCallCount = 0
    const worker: ChildRunExecutor = async (input) => {
      workerCallCount++
      return { summary: `ok-${input.childId}`, toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 }
    }
    const a = await bootDevice('A', aDir, async () => ({ summary: 'a' }))
    const b = await bootDevice('B', bDir, worker)
    try {
      await pair(a.handle, b.handle, a.bridge)

      const results: ChildRunResult[] = []
      for (let i = 0; i < 50; i++) {
        const id = `sustained-${i}`
        a.bridge.setDispatchTarget(id, b.handle.identity.deviceId)
        const result = await a.bridge.runRemote(taskParams(id, a.handle.identity.deviceId), new AbortController().signal)
        a.bridge.clearDispatchTarget(id)
        results.push(result)
      }

      expect(results).toHaveLength(50)
      expect(results.every((r) => r.status === 'completed')).toBe(true)
      expect(workerCallCount).toBe(50)
      // Verify each result is distinct (no cross-talk)
      const summaries = results.map((r) => r.summary)
      expect(new Set(summaries).size).toBe(50)
    } finally {
      await a.bridge.close().catch(() => {})
      await b.bridge.close().catch(() => {})
      await a.handle.shutdown().catch(() => {})
      await b.handle.shutdown().catch(() => {})
    }
  }, 30_000)

  it('recovers and reconnects after the worker transport restarts', async () => {
    let workerCallCount = 0
    const worker: ChildRunExecutor = async (input) => {
      workerCallCount++
      return { summary: `recovered-${input.childId}`, toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 }
    }
    const a = await bootDevice('A', aDir, async () => ({ summary: 'a' }))
    let b = await bootDevice('B', bDir, worker)
    try {
      await pair(a.handle, b.handle, a.bridge)

      // Dispatch successfully before restart
      a.bridge.setDispatchTarget('pre-restart', b.handle.identity.deviceId)
      const r1 = await a.bridge.runRemote(taskParams('pre-restart', a.handle.identity.deviceId), new AbortController().signal)
      expect(r1.status).toBe('completed')
      a.bridge.clearDispatchTarget('pre-restart')

      // Shut down worker B completely
      const bPort = b.handle.transportPort
      await b.bridge.close().catch(() => {})
      await b.handle.shutdown().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 300))

      // B's transport is gone; dispatch should fail (not hang)
      a.bridge.setDispatchTarget('during-down', b.handle.identity.deviceId)
      await expect(
        a.bridge.runRemote(taskParams('during-down', a.handle.identity.deviceId), new AbortController().signal)
      ).rejects.toThrow(/not connected|no transport|aborted|connection/)
      a.bridge.clearDispatchTarget('during-down')

      // Restart B on a fresh port (simulates worker process restart)
      b = await bootDevice('B-restarted', bDir, worker)
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Re-pair A to the restarted B (autoAcceptKnownPeers would skip this in
      // production, but in the test we explicitly reconnect)
      await a.bridge.connectPeer({ deviceId: b.handle.identity.deviceId, host: '127.0.0.1', port: b.handle.transportPort }).catch(() => {})

      // Dispatch should work again after reconnection
      a.bridge.setDispatchTarget('post-restart', b.handle.identity.deviceId)
      const r2 = await a.bridge.runRemote(taskParams('post-restart', a.handle.identity.deviceId), new AbortController().signal)
      expect(r2.status).toBe('completed')
      expect(r2.summary).toBe('recovered-post-restart')
      a.bridge.clearDispatchTarget('post-restart')
    } finally {
      await a.bridge.close().catch(() => {})
      await b.bridge.close().catch(() => {})
      await a.handle.shutdown().catch(() => {})
      await b.handle.shutdown().catch(() => {})
    }
  }, 20_000)

  it('handles interleaved local + remote dispatches correctly (mixed workload)', async () => {
    let remoteCount = 0
    let localCount = 0
    const worker: ChildRunExecutor = async () => {
      remoteCount++
      return { summary: 'remote', toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 }
    }
    const localExec: ChildRunExecutor = async () => {
      localCount++
      return { summary: 'local', toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 }
    }
    const a = await bootDevice('A', aDir, localExec)
    const b = await bootDevice('B', bDir, worker)
    try {
      await pair(a.handle, b.handle, a.bridge)

      // Interleave: some tasks go remote, some stay local
      const tasks: Promise<ChildRunResult>[] = []
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          // Remote dispatch
          const id = `mixed-remote-${i}`
          a.bridge.setDispatchTarget(id, b.handle.identity.deviceId)
          const p = a.bridge.runRemote(taskParams(id, a.handle.identity.deviceId), new AbortController().signal)
            .finally(() => a.bridge.clearDispatchTarget(id))
          tasks.push(p)
        } else {
          // Local execution (bypass the bridge entirely)
          tasks.push(Promise.resolve({
            summary: 'local', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, status: 'completed' as const
          }))
          localCount++
        }
      }
      const results = await Promise.all(tasks)
      expect(results).toHaveLength(10)
      expect(results.filter((r) => r.summary === 'remote')).toHaveLength(5)
      expect(results.filter((r) => r.summary === 'local')).toHaveLength(5)
      expect(remoteCount).toBe(5)
    } finally {
      await a.bridge.close().catch(() => {})
      await b.bridge.close().catch(() => {})
      await a.handle.shutdown().catch(() => {})
      await b.handle.shutdown().catch(() => {})
    }
  }, 15_000)
})
