import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signEnvelope, verifyEnvelope, ReplayWindow, canonicalSigningInput } from '@qwicks/mesh/envelope/envelope.js'
import { loadOrCreateDeviceIdentity, toHex } from '@qwicks/mesh/identity/device-identity.js'

const base = {
  version: '1' as const,
  from: 'd-aaa',
  to: 'd-bbb',
  messageId: 'm1',
  traceId: 't1',
  timestamp: '2026-06-22T00:00:00.000Z',
  nonce: 'n1',
  kind: 'task/run',
  taskId: 'task-1',
  payload: { taskId: 'task-1', prompt: 'hi' }
}

describe('envelope (RFC 000 §8.2, 006 §4.1)', () => {
  it('signs with HMAC + Ed25519 and verifies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'))
    const id = await loadOrCreateDeviceIdentity(dir)
    const sessionKey = new Uint8Array(32).fill(7)
    const env = await signEnvelope(base, id, sessionKey)
    expect(await verifyEnvelope(env, id.publicKey, sessionKey)).toBe(true)
  })

  it('rejects a tampered payload (deviceSig mismatch)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-tamper-'))
    const id = await loadOrCreateDeviceIdentity(dir)
    const sessionKey = new Uint8Array(32).fill(7)
    const env = await signEnvelope(base, id, sessionKey)
    const tampered = { ...env, payload: { taskId: 'task-1', prompt: 'EVIL' } }
    expect(await verifyEnvelope(tampered, id.publicKey, sessionKey)).toBe(false)
  })

  it('rejects when the session key is wrong (MAC mismatch)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-mac-'))
    const id = await loadOrCreateDeviceIdentity(dir)
    const env = await signEnvelope(base, id, new Uint8Array(32).fill(7))
    expect(await verifyEnvelope(env, id.publicKey, new Uint8Array(32).fill(8))).toBe(false)
  })

  it('rejects when the device signature is from a different identity', async () => {
    const signerDir = mkdtempSync(join(tmpdir(), 'env-signer-'))
    const otherDir = mkdtempSync(join(tmpdir(), 'env-other-'))
    const signer = await loadOrCreateDeviceIdentity(signerDir)
    const other = await loadOrCreateDeviceIdentity(otherDir)
    const sessionKey = new Uint8Array(32).fill(7)
    const env = await signEnvelope(base, signer, sessionKey)
    expect(await verifyEnvelope(env, other.publicKey, sessionKey)).toBe(false)
  })

  it('canonical signing input is stable and order-independent of payload key insertion', () => {
    const a = canonicalSigningInput({
      payload: { b: 2, a: 1 },
      messageId: 'm1',
      nonce: 'n1',
      timestamp: 't',
      taskId: 'x'
    })
    const b = canonicalSigningInput({
      payload: { a: 1, b: 2 },
      messageId: 'm1',
      nonce: 'n1',
      timestamp: 't',
      taskId: 'x'
    })
    expect(toHex(a)).toBe(toHex(b))
  })
})

describe('ReplayWindow (RFC 006 §4.3)', () => {
  it('accepts a new nonce once, then rejects it as replay', () => {
    const win = new ReplayWindow()
    expect(win.checkAndAdd('d-bbb', 'n1')).toBe(true)
    expect(win.checkAndAdd('d-bbb', 'n1')).toBe(false)
  })

  it('tracks nonces per-device independently', () => {
    const win = new ReplayWindow()
    expect(win.checkAndAdd('d-bbb', 'n1')).toBe(true)
    expect(win.checkAndAdd('d-ccc', 'n1')).toBe(true)
  })

  it('evicts the oldest entry past capacity', () => {
    const win = new ReplayWindow(3)
    expect(win.checkAndAdd('d', '1')).toBe(true)
    expect(win.checkAndAdd('d', '2')).toBe(true)
    expect(win.checkAndAdd('d', '3')).toBe(true)
    // capacity reached; '4' evicts '1'. Replaying '1' should now be ACCEPTED
    // again only if the window dropped it — assert it was dropped.
    expect(win.checkAndAdd('d', '4')).toBe(true)
    expect(win.checkAndAdd('d', '1')).toBe(true)
  })
})
