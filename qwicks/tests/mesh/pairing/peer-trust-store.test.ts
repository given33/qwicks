import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PeerTrustStore } from '@qwicks/mesh/pairing/peer-trust-store.js'

const sample = {
  peerDeviceId: 'd-bbb',
  peerDeviceName: 'gpu-host',
  peerPublicKey: 'pk-hex',
  peerFingerprint: '0123456789abcdef',
  pairedAt: '2026-06-22T00:00:00.000Z',
  lastSeenAt: '2026-06-22T00:00:00.000Z',
  trustLevel: 'standard' as const,
  permissions: { memory: { scopes: ['public'] } }
}

describe('PeerTrustStore (RFC 001 §6)', () => {
  let dir: string
  const opened: PeerTrustStore[] = []
  let store: PeerTrustStore
  const openStore = (path?: string): PeerTrustStore => {
    const s = new PeerTrustStore(path ?? join(dir, 'mesh-trust.db'))
    opened.push(s)
    return s
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'q-trust-'))
    store = openStore()
  })
  afterEach(() => {
    for (const s of opened.splice(0)) s.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('upserts and gets a peer', async () => {
    await store.upsert(sample)
    const got = await store.get('d-bbb')
    expect(got?.peerDeviceName).toBe('gpu-host')
    expect(got?.peerFingerprint).toBe('0123456789abcdef')
  })

  it('returns undefined for an unknown peer', async () => {
    expect(await store.get('d-zzz')).toBeUndefined()
  })

  it('listActive excludes revoked peers', async () => {
    await store.upsert(sample)
    await store.upsert({ ...sample, peerDeviceId: 'd-ccc', peerDeviceName: 'laptop' })
    await store.revoke('d-bbb')
    const active = await store.listActive()
    expect(active.map((p) => p.peerDeviceId).sort()).toEqual(['d-ccc'])
  })

  it('revoking sets revokedAt and makes get return undefined for active lookups', async () => {
    await store.upsert(sample)
    await store.revoke('d-bbb')
    expect(await store.get('d-bbb')).toBeUndefined()
    const all = await store.listAll()
    expect(all[0].revokedAt).toBeTruthy()
  })

  it('touchLastSeen updates lastSeenAt', async () => {
    await store.upsert(sample)
    await store.touchLastSeen('d-bbb', '2026-06-22T01:00:00.000Z')
    const got = await store.get('d-bbb')
    expect(got?.lastSeenAt).toBe('2026-06-22T01:00:00.000Z')
  })

  it('persists across instances (same file)', async () => {
    await store.upsert(sample)
    store.close()
    const reopened = openStore()
    const got = await reopened.get('d-bbb')
    expect(got?.peerDeviceName).toBe('gpu-host')
  })
})
