import { describe, it, expect } from 'vitest'
import { SessionKeyStore } from '@qwicks/mesh/identity/session-key-store.js'
import type { SessionKeyMaterial } from '@qwicks/mesh/pairing/pairing.js'

const fakeKey = (seed: number) => new Uint8Array(32).fill(seed)
const material: SessionKeyMaterial = { aToBKey: fakeKey(1), bToAKey: fakeKey(2) }

describe('SessionKeyStore (RFC 001 §5.3, 006 §4.2)', () => {
  it('stores bToAKey when self is A (self < peer), for verifying B\'s messages', () => {
    const store = new SessionKeyStore('d-aaa')
    store.storeFromPairing('d-bbb', material)
    expect(store.getVerifyKey('d-bbb')).toEqual(material.bToAKey)
  })

  it('stores aToBKey when self is B (self > peer), for verifying A\'s messages', () => {
    const store = new SessionKeyStore('d-ccc')
    store.storeFromPairing('d-aaa', material)
    expect(store.getVerifyKey('d-aaa')).toEqual(material.aToBKey)
  })

  it('returns undefined for unknown peers', () => {
    const store = new SessionKeyStore('d-a')
    expect(store.getVerifyKey('d-unknown')).toBeUndefined()
  })

  it('revokes a peer\'s session key', () => {
    const store = new SessionKeyStore('d-aaa')
    store.storeFromPairing('d-bbb', material)
    expect(store.getVerifyKey('d-bbb')).toBeDefined()
    store.revoke('d-bbb')
    expect(store.getVerifyKey('d-bbb')).toBeUndefined()
  })

  it('reports size correctly', () => {
    const store = new SessionKeyStore('d-mid')
    expect(store.size).toBe(0)
    store.storeFromPairing('d-aaa', material)
    store.storeFromPairing('d-zzz', material)
    expect(store.size).toBe(2)
    store.revoke('d-aaa')
    expect(store.size).toBe(1)
  })
})
