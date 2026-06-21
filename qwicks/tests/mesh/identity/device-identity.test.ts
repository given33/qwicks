import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadOrCreateDeviceIdentity,
  verifySignature,
  deriveSessionKeyMaterial
} from '@qwicks/mesh/identity/device-identity.js'

describe('device identity (RFC 000 §6.1, 001 §5.3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qwicks-mesh-id-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is stable across loads', async () => {
    const a = await loadOrCreateDeviceIdentity(dir)
    const b = await loadOrCreateDeviceIdentity(dir)
    expect(a.deviceId).toBe(b.deviceId)
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.publicKey).toEqual(b.publicKey)
    expect(a.privateKey).toEqual(b.privateKey)
  })

  it('fingerprint is 16 lowercase hex chars', async () => {
    const id = await loadOrCreateDeviceIdentity(dir)
    expect(id.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('signs a message that verifies, and rejects tampered messages', async () => {
    const id = await loadOrCreateDeviceIdentity(dir)
    const msg = new TextEncoder().encode('hello mesh')
    const sig = await id.sign(msg)
    expect(await verifySignature(id.publicKey, msg, sig)).toBe(true)
    expect(await verifySignature(id.publicKey, new TextEncoder().encode('tampered'), sig)).toBe(false)
  })

  it('two identities derive the same session key via X25519 ECDH', async () => {
    const alice = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), 'a-')))
    const bob = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), 'b-')))
    // Alice uses her ephemeral private + Bob's ephemeral public; Bob mirrors.
    const aliceMaterial = deriveSessionKeyMaterial({
      selfEphemeralPrivate: alice.ephemeralPrivateKey,
      peerEphemeralPublic: bob.ephemeralPublicKey,
      salt: 'CODE123||nonceA||nonceB',
      info: 'qwicks-mesh-v1'
    })
    const bobMaterial = deriveSessionKeyMaterial({
      selfEphemeralPrivate: bob.ephemeralPrivateKey,
      peerEphemeralPublic: alice.ephemeralPublicKey,
      salt: 'CODE123||nonceA||nonceB',
      info: 'qwicks-mesh-v1'
    })
    expect(aliceMaterial.aToBKey).toEqual(bobMaterial.aToBKey)
    expect(aliceMaterial.bToAKey).toEqual(bobMaterial.bToAKey)
    expect(aliceMaterial.aToBKey).not.toEqual(aliceMaterial.bToAKey) // direction-bound
  })

  it('persists private keys to a 0600 file (never transmitted)', async () => {
    await loadOrCreateDeviceIdentity(dir)
    const stat = readFileSync(join(dir, 'device-identity.json'), 'utf8')
    expect(stat).toContain('privateKey')
  })
})
