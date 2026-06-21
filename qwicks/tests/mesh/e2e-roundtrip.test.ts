import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { PeerTrustStore } from '@qwicks/mesh/pairing/peer-trust-store.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import { PairingResponder, PairingInitiator } from '@qwicks/mesh/pairing/pairing.js'
import { TaskServer } from '@qwicks/mesh/dispatch/task-server.js'
import { createRemoteChildExecutor } from '@qwicks/mesh/dispatch/remote-executor.js'
import { MeshTransportServer, MeshTransportClient } from '@qwicks/mesh/transport/transport.js'
import type { JsonRpcMessage } from '@qwicks/mesh/transport/json-rpc.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'

const fakeLocal: ChildRunExecutor = async () => ({
  summary: 'computed on peer B',
  toolInvocations: 3,
  prefixReused: true,
  inheritedHistoryItems: 0
})

describe('mesh e2e over real loopback WebSocket (RFC 000 §10)', () => {
  let aDir: string
  let bDir: string
  let server: MeshTransportServer
  let client: MeshTransportClient
  const closables: Array<{ close?: () => void; stop?: () => Promise<void> }> = []

  beforeEach(() => {
    aDir = mkdtempSync(join(tmpdir(), 'e2e-a-'))
    bDir = mkdtempSync(join(tmpdir(), 'e2e-b-'))
  })
  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.stop().catch(() => {})
    for (const c of closables.splice(0)) {
      c.close?.()
      await c.stop?.()
    }
    rmSync(aDir, { recursive: true, force: true })
    rmSync(bDir, { recursive: true, force: true })
  })

  it('pairs two instances and round-trips a task over the wire', async () => {
    // --- Worker B ---
    const b = await loadOrCreateDeviceIdentity(bDir)
    const bTrust = new PeerTrustStore(join(bDir, 'trust.db'))
    const bAudit = new AuditLog(join(bDir, 'audit.db'))
    closables.push(bTrust, bAudit)
    const responder = new PairingResponder({ identity: b, trustStore: bTrust, audit: bAudit, deviceName: 'gpu-host' })
    const taskServer = new TaskServer({ isPeerAuthorized: () => true, localExecutor: fakeLocal, audit: bAudit, selfDeviceId: b.deviceId })

    server = new MeshTransportServer()
    const { port } = await server.start((msg, reply) => handleB(msg, reply, responder, taskServer))

    // --- Orchestrator A ---
    const a = await loadOrCreateDeviceIdentity(aDir)
    const aTrust = new PeerTrustStore(join(aDir, 'trust.db'))
    const aAudit = new AuditLog(join(aDir, 'audit.db'))
    closables.push(aTrust, aAudit)
    client = new MeshTransportClient()
    await client.connect(`ws://127.0.0.1:${port}`)
    const send = async (method: string, params: unknown) => client.request(method, params)

    const initiator = new PairingInitiator({ identity: a, trustStore: aTrust, audit: aAudit, deviceName: 'laptop' })
    await initiator.hello(send)
    const code = responder.getPendingCode(a.deviceId)
    if (!code) throw new Error('expected a pending code')
    await initiator.verify(send, code)

    // Both sides now trust each other.
    expect((await aTrust.get(b.deviceId))?.peerFingerprint).toBe(b.fingerprint)
    expect((await bTrust.get(a.deviceId))?.peerFingerprint).toBe(a.fingerprint)

    // --- Dispatch a task from A to B over the same connection ---
    const remoteExecutor = createRemoteChildExecutor({
      selfDeviceId: a.deviceId,
      runRemote: async (params) => (await client.request('task/run', params)) as never,
      cancelRemote: async () => {}
    })
    const result = await remoteExecutor({
      childId: 'child-e2e',
      parentThreadId: 'th-1',
      parentTurnId: 'tn-1',
      prompt: 'compute something',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })
    expect(result.summary).toBe('computed on peer B')
    expect(result.toolInvocations).toBe(3)
  })
})

function handleB(
  msg: JsonRpcMessage,
  reply: (r: { result: unknown } | { error: { code: number; message: string } }) => void,
  responder: PairingResponder,
  taskServer: TaskServer
): void {
  if (msg.type !== 'request') return
  const params = msg.params as never
  const dispatch = async () => {
    if (msg.method === 'pairing/hello') return responder.handleHello(params)
    if (msg.method === 'pairing/verify') return responder.handleVerify(params)
    if (msg.method === 'task/run') return taskServer.handleTaskRun(params, (params as { provenance: string[] }).provenance[0])
    throw { code: -32601, message: 'method not found' }
  }
  dispatch()
    .then((result) => reply({ result }))
    .catch((err) => reply({ error: err as { code: number; message: string } }))
}
