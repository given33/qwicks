import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootMesh, type MeshHandle } from '@qwicks/mesh/index.js'
import { MeshConfig } from '@qwicks/mesh/config.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { MeshDispatchBridge } from '@qwicks/mesh/integration/mesh-dispatch-bridge.js'
import { PairingInitiator } from '@qwicks/mesh/pairing/pairing.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import { MeshTransportClient } from '@qwicks/mesh/transport/transport.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'
import type { ChildRunResult } from '@qwicks/mesh/contracts.js'

/**
 * Two-device end-to-end integration (RFC 000 §10).
 *
 * This is the test that actually exercises the full mesh stack the way it runs
 * in production: two independent `bootMesh` instances, each with its own
 * identity / dataDir / transport server, communicating over real loopback
 * WebSockets. The flow:
 *
 *   1. Boot device A (orchestrator) and device B (worker) — each opens a real
 *      transport server on an OS-assigned port.
 *   2. A connects a transport client to B and runs the pairing handshake
 *      (hello → B generates code → A reads code from B's responder → verify).
 *   3. Both trust stores now list each other.
 *   4. A's dispatch bridge connects to B; A dispatches a real task via
 *      `runRemote` → B's task server executes it → result flows back.
 *   5. Cleanup: both meshes shut down cleanly.
 *
 * This test is deliberately written against the public `bootMesh` +
 * `MeshDispatchBridge` surface (no internal transport tampering) so it mirrors
 * what `runtime-factory.ts` does in production. Bugs found here are real
 * integration bugs, not unit-test artefacts.
 */

describe('mesh two-device e2e (RFC 000 §10)', () => {
  let aDir: string
  let bDir: string
  let aHandle: MeshHandle | null
  let bHandle: MeshHandle | null
  let aBridge: MeshDispatchBridge
  let bBridge: MeshDispatchBridge

  beforeEach(() => {
    aDir = mkdtempSync(join(tmpdir(), 'e2e-2dev-a-'))
    bDir = mkdtempSync(join(tmpdir(), 'e2e-2dev-b-'))
    aHandle = null
    bHandle = null
  })

  afterEach(async () => {
    await aBridge?.close().catch(() => {})
    await bBridge?.close().catch(() => {})
    await aHandle?.shutdown().catch(() => {})
    await bHandle?.shutdown().catch(() => {})
    // Windows needs a tick for sqlite handles to release before rmSync
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(aDir, { recursive: true, force: true })
    rmSync(bDir, { recursive: true, force: true })
  })

  /** A fake local executor that returns a recognisable summary so we can tell
   *  which device actually ran the task. */
  function fakeExecutor(label: string): ChildRunExecutor {
    return async () => ({
      summary: `ran on ${label}`,
      toolInvocations: 0,
      prefixReused: true,
      inheritedHistoryItems: 0
    })
  }

  /** Boot a mesh device with the given identity + dataDir. Returns the handle
   *  plus a dispatch bridge wired to discover peers. The `runRemote` callback
   *  ships task/run over the bridge. */
  async function bootDevice(opts: {
    dir: string
    deviceName: string
    localExecutor: ChildRunExecutor
    runRemote: (params: any, signal: AbortSignal) => Promise<ChildRunResult>
  }): Promise<{ handle: MeshHandle; bridge: MeshDispatchBridge }> {
    const meshDir = join(opts.dir, 'mesh')
    const identity = await loadOrCreateDeviceIdentity(meshDir)
    const bridge = new MeshDispatchBridge()
    const handle = await bootMesh(MeshConfig.parse({ enabled: true, deviceName: opts.deviceName }), {
      identity,
      dataDir: meshDir,
      localExecutor: opts.localExecutor,
      runRemote: opts.runRemote,
      isPeerAuthorized: () => true,
      onPeerDiscovered: (peer) => {
        void bridge.onPeerDiscovered(peer)
      },
      manifest: {
        models: [{ id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }],
        tools: [],
        computeProfile: { canRunLocalModels: true }
      }
    })
    if (!handle) throw new Error(`failed to boot mesh for ${opts.deviceName}`)
    return { handle, bridge }
  }

  it('pairs two devices and round-trips a task over real loopback WebSocket', async () => {
    // --- Boot A (orchestrator) and B (worker) ---
    const aBoot = await bootDevice({
      dir: aDir,
      deviceName: 'orchestrator-A',
      localExecutor: fakeExecutor('A'),
      runRemote: async () => {
        throw new Error('A should not be a worker target in this test')
      }
    })
    aHandle = aBoot.handle
    aBridge = aBoot.bridge

    const bBoot = await bootDevice({
      dir: bDir,
      deviceName: 'worker-B',
      localExecutor: fakeExecutor('B'),
      runRemote: async () => {
        throw new Error('B is not an orchestrator')
      }
    })
    bHandle = bBoot.handle
    bBridge = bBoot.bridge

    expect(aHandle.transportPort).toBeGreaterThan(0)
    expect(bHandle.transportPort).toBeGreaterThan(0)

    // --- Pairing: A initiates, B responds ---
    const bPort = bHandle.transportPort
    const bIdentity = bHandle.identity

    const aInitiator = new PairingInitiator({
      identity: aHandle.identity,
      trustStore: aHandle.trustStore,
      // Reuse the boot audit log so we don't open (and leak) a separate db file.
      audit: { record: async () => {} } as unknown as AuditLog,
      deviceName: 'orchestrator-A'
    })

    // A connects to B and sends hello
    const aClientToB = new MeshTransportClient()
    await aClientToB.connect(`ws://127.0.0.1:${bPort}`)
    const send = async (method: string, params: unknown) => aClientToB.request(method, params)

    const helloResult = await aInitiator.hello(send)
    expect(helloResult.accepted).toBe(true)
    expect(helloResult.responderDeviceId).toBe(bIdentity.deviceId)

    // B's responder generated a code — read it out (in production the user
    // reads it off B's screen and types it into A's UI)
    const code = bHandle.responder.getPendingCode(aHandle.identity.deviceId)
    if (!code) throw new Error('expected a pending pairing code on B')
    expect(code).toMatch(/^\d{6}$/)

    // A submits the code to complete pairing
    await aInitiator.verify(send, code)
    await aClientToB.close().catch(() => {})

    // --- Both trust stores now list each other ---
    const bTrustedByA = await aHandle.trustStore.get(bIdentity.deviceId)
    expect(bTrustedByA).toBeDefined()
    expect(bTrustedByA?.peerFingerprint).toBe(bIdentity.fingerprint)

    const aTrustedByB = await bHandle.trustStore.get(aHandle.identity.deviceId)
    expect(aTrustedByB).toBeDefined()
    expect(aTrustedByB?.peerFingerprint).toBe(aHandle.identity.fingerprint)

    // --- Dispatch a task from A to B over the bridge ---
    // Manually connect A's bridge to B (in production mDNS does this)
    await aBridge.connectPeer({
      deviceId: bIdentity.deviceId,
      host: '127.0.0.1',
      port: bPort
    })

    // Build the task params the way the remote executor would
    const taskId = 'e2e-task-1'
    aBridge.setDispatchTarget(taskId, bIdentity.deviceId)

    const result = await aBridge.runRemote(
      {
        taskId,
        parentThreadId: 'th-e2e',
        parentTurnId: 'tn-e2e',
        prompt: 'compute something on B',
        toolPolicy: 'inherit',
        lease: { leaseTimeout: 300, heartbeatInterval: 75 },
        idempotencyKey: 'e2e-key-1',
        retryCount: 0,
        maxRetries: 2,
        cancelToken: 'cancel-e2e',
        provenance: [aHandle.identity.deviceId],
        disableUserInput: true
      },
      new AbortController().signal
    )

    expect(result.status).toBe('completed')
    expect(result.summary).toBe('ran on B')
  }, 15_000)

  it('returns a clear error when dispatching to an undiscovered peer', async () => {
    const aBoot = await bootDevice({
      dir: aDir,
      deviceName: 'orchestrator-A',
      localExecutor: fakeExecutor('A'),
      runRemote: async () => {
        throw new Error('unused')
      }
    })
    aHandle = aBoot.handle
    aBridge = aBoot.bridge

    // No peer discovered — runRemote should fail with a clear message
    await expect(
      aBridge.runRemote(
        {
          taskId: 'orphan-task',
          parentThreadId: 'th',
          parentTurnId: 'tn',
          prompt: 'p',
          toolPolicy: 'inherit',
          lease: { leaseTimeout: 300, heartbeatInterval: 75 },
          idempotencyKey: 'orphan-key',
          retryCount: 0,
          maxRetries: 0,
          cancelToken: 'tok',
          provenance: [aHandle.identity.deviceId],
          disableUserInput: true
        },
        new AbortController().signal
      )
    ).rejects.toThrow(/not connected|no transport client for peer/)
  }, 10_000)
})
