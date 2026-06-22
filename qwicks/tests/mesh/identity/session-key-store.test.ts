import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionKeyStore } from '@qwicks/mesh/identity/session-key-store.js'
import type { SessionKeyMaterial } from '@qwicks/mesh/pairing/pairing.js'

const fakeKey = (seed: number) => new Uint8Array(32).fill(seed)
const material: SessionKeyMaterial = { aToBKey: fakeKey(1), bToAKey: fakeKey(2) }

describe('SessionKeyStore (RFC 001 §5.3, 006 §4.2)', () => {
  it("stores bToAKey when self is A (self < peer), for verifying B's messages", async () => {
    const store = new SessionKeyStore('d-aaa')
    await store.storeFromPairing('d-bbb', material)
    expect(store.getVerifyKey('d-bbb')).toEqual(material.bToAKey)
  })

  it("stores aToBKey when self is B (self > peer), for verifying A's messages", async () => {
    const store = new SessionKeyStore('d-ccc')
    await store.storeFromPairing('d-aaa', material)
    expect(store.getVerifyKey('d-aaa')).toEqual(material.aToBKey)
  })

  it('returns undefined for unknown peers', () => {
    const store = new SessionKeyStore('d-a')
    expect(store.getVerifyKey('d-unknown')).toBeUndefined()
  })

  it("revokes a peer's session key", async () => {
    const store = new SessionKeyStore('d-aaa')
    await store.storeFromPairing('d-bbb', material)
    expect(store.getVerifyKey('d-bbb')).toBeDefined()
    await store.revoke('d-bbb')
    expect(store.getVerifyKey('d-bbb')).toBeUndefined()
  })

  it('reports size correctly', async () => {
    const store = new SessionKeyStore('d-mid')
    expect(store.size).toBe(0)
    await store.storeFromPairing('d-aaa', material)
    await store.storeFromPairing('d-zzz', material)
    expect(store.size).toBe(2)
    await store.revoke('d-aaa')
    expect(store.size).toBe(1)
  })
})

describe('SessionKeyStore persistence (Phase 2 — no re-pair on restart)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sks-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists keys to disk and reloads them on a fresh instance', async () => {
    // First instance: store a key (this writes session-keys.json)
    const store1 = new SessionKeyStore('d-aaa', dir)
    await store1.storeFromPairing('d-bbb', material)
    expect(existsSync(join(dir, 'session-keys.json'))).toBe(true)

    // Second instance: simulates a restart — load() should restore the key
    const store2 = new SessionKeyStore('d-aaa', dir)
    await store2.load()
    expect(store2.size).toBe(1)
    expect(store2.getVerifyKey('d-bbb')).toEqual(material.bToAKey)
  })

  it('starts empty when no persisted file exists (first run)', async () => {
    const store = new SessionKeyStore('d-aaa', dir)
    await store.load()
    expect(store.size).toBe(0)
  })

  it('persists revocation (deleted key does not reappear after reload)', async () => {
    const store1 = new SessionKeyStore('d-aaa', dir)
    await store1.storeFromPairing('d-bbb', material)
    await store1.storeFromPairing('d-ccc', material)
    await store1.revoke('d-bbb')

    const store2 = new SessionKeyStore('d-aaa', dir)
    await store2.load()
    expect(store2.size).toBe(1)
    expect(store2.getVerifyKey('d-bbb')).toBeUndefined()
    expect(store2.getVerifyKey('d-ccc')).toBeDefined()
  })

  it('stays in-memory-only when no dataDir is supplied', async () => {
    const store = new SessionKeyStore('d-aaa')
    await store.storeFromPairing('d-bbb', material)
    expect(store.size).toBe(1)
    // No file path → load() is a no-op, no file written
    await store.load()
    expect(existsSync(join(dir, 'session-keys.json'))).toBe(false)
  })

  it('tolerates a corrupt session-keys.json (starts empty)', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'session-keys.json'), 'not-json{', 'utf8')
    const store = new SessionKeyStore('d-aaa', dir)
    await store.load() // must not throw
    expect(store.size).toBe(0)
  })
})
