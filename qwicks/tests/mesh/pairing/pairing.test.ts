import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateDeviceIdentity, toHex } from '@qwicks/mesh/identity/device-identity.js'
import { PeerTrustStore } from '@qwicks/mesh/pairing/peer-trust-store.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import { PairingResponder, PairingInitiator } from '@qwicks/mesh/pairing/pairing.js'

describe('pairing (RFC 001 §4-§5)', () => {
  let aDir: string
  let bDir: string
  const trustStores: PeerTrustStore[] = []
  const auditLogs: AuditLog[] = []

  beforeEach(() => {
    aDir = mkdtempSync(join(tmpdir(), 'pair-a-'))
    bDir = mkdtempSync(join(tmpdir(), 'pair-b-'))
  })
  afterEach(() => {
    for (const t of trustStores.splice(0)) t.close()
    for (const a of auditLogs.splice(0)) a.close()
    rmSync(aDir, { recursive: true, force: true })
    rmSync(bDir, { recursive: true, force: true })
  })

  async function setup() {
    const a = await loadOrCreateDeviceIdentity(aDir)
    const b = await loadOrCreateDeviceIdentity(bDir)
    const aTrust = new PeerTrustStore(join(aDir, 'trust.db'))
    const bTrust = new PeerTrustStore(join(bDir, 'trust.db'))
    const aAudit = new AuditLog(join(aDir, 'audit.db'))
    const bAudit = new AuditLog(join(bDir, 'audit.db'))
    trustStores.push(aTrust, bTrust)
    auditLogs.push(aAudit, bAudit)

    const responder = new PairingResponder({ identity: b, trustStore: bTrust, audit: bAudit, deviceName: 'gpu-host' })
    // In-memory request pipe: initiator calls land directly on the responder.
    const send = async (method: string, params: unknown) => {
      if (method === 'pairing/hello') return responder.handleHello(params as never)
      if (method === 'pairing/verify') return responder.handleVerify(params as never)
      throw new Error(`unknown method ${method}`)
    }
    const initiator = new PairingInitiator({ identity: a, trustStore: aTrust, audit: aAudit, deviceName: 'laptop' })
    return { a, b, responder, initiator, send, aTrust, bTrust }
  }

  it('completes a full handshake: matching session keys + mutual trust persistence', async () => {
    const { a, b, responder, initiator, send, aTrust, bTrust } = await setup()

    const helloResult = await initiator.hello(send)
    expect(helloResult.accepted).toBe(true)
    expect(helloResult.responderDeviceId).toBe(b.deviceId)
    expect(helloResult.responderEphemeralPublic).toBeTruthy()

    const code = responder.getPendingCode(a.deviceId)
    expect(code).toMatch(/^\d{6}$/)
    if (!code) throw new Error('expected a pending code')

    const initiatorMaterial = await initiator.verify(send, code)
    const responderMaterial = responder.lastSessionKeyMaterial!

    expect(toHex(initiatorMaterial.aToBKey)).toBe(toHex(responderMaterial.aToBKey))
    expect(toHex(initiatorMaterial.bToAKey)).toBe(toHex(responderMaterial.bToAKey))
    expect(initiatorMaterial.aToBKey).not.toEqual(initiatorMaterial.bToAKey)

    // A persisted B; B persisted A.
    const aTrustEntry = await aTrust.get(b.deviceId)
    const bTrustEntry = await bTrust.get(a.deviceId)
    expect(aTrustEntry?.peerFingerprint).toBe(b.fingerprint)
    expect(bTrustEntry?.peerFingerprint).toBe(a.fingerprint)
    expect(bTrustEntry?.peerPublicKey).toBe(toHex(a.publicKey))
  })

  it('rejects an incorrect pairing code (3 attempts then locked out)', async () => {
    const { a, responder, initiator, send } = await setup()
    await initiator.hello(send)
    for (let i = 0; i < 3; i++) {
      await expect(initiator.verify(send, '000000')).rejects.toThrow()
    }
    // After 3 failures the responder must have dropped the pending challenge.
    expect(responder.getPendingCode(a.deviceId)).toBeNull()
  })

  it('refuses verify with no pending hello (no challenge to answer)', async () => {
    const { initiator, send } = await setup()
    await expect(initiator.verify(send, '123456')).rejects.toThrow()
  })
})
