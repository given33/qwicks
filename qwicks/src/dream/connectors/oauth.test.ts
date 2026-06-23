import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OAuthToken, OAuthTokenStore, TokenRefresher, PermissionRevocation } from './oauth.js'

describe('OAuthToken', () => {
  it('isExpired is true past expires_at (with skew)', () => {
    const past = new OAuthToken('access', 'refresh', Math.floor(Date.now() / 1000) - 100)
    expect(past.isExpired()).toBe(true)
    const future = new OAuthToken('access', 'refresh', Math.floor(Date.now() / 1000) + 10000)
    expect(future.isExpired()).toBe(false)
  })

  it('round-trips through toDict/fromDict', () => {
    const t = new OAuthToken('a', 'r', 1234567890, ['scope1'], 'cid', 'csec', 'alice@gmail.com', 'google')
    const round = OAuthToken.fromDict(t.toDict())
    expect(round).toEqual(t)
  })
})

describe('OAuthTokenStore (encrypted JSONL persistence)', () => {
  let dir: string
  let store: OAuthTokenStore
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-oauth-'))
    store = new OAuthTokenStore({ persistDir: dir, passphrase: 'test-key' })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('save/load round-trips a token (decrypted back to plaintext)', () => {
    const t = new OAuthToken('access123', 'refresh456', 9999999999, ['gmail.readonly'], 'cid', 'csec', 'alice@gmail.com', 'google')
    store.save('alice@gmail.com', t)
    const loaded = store.load('alice@gmail.com')
    expect(loaded).not.toBeNull()
    expect(loaded!.accessToken).toBe('access123')
    expect(loaded!.refreshToken).toBe('refresh456')
    expect(loaded!.accountEmail).toBe('alice@gmail.com')
  })

  it('returns null for an unknown account', () => {
    expect(store.load('nobody@gmail.com')).toBeNull()
  })

  it('delete removes the token and returns true', () => {
    const t = new OAuthToken('a', 'r', 9999999999, [], 'cid', 'csec', 'alice@gmail.com', 'google')
    store.save('alice@gmail.com', t)
    expect(store.delete('alice@gmail.com')).toBe(true)
    expect(store.load('alice@gmail.com')).toBeNull()
    expect(store.delete('alice@gmail.com')).toBe(false)
  })

  it('listAccounts returns all stored accounts', () => {
    store.save('a@gmail.com', new OAuthToken('a', 'r', 9999999999, [], 'cid', 'csec', 'a@gmail.com', 'google'))
    store.save('b@gmail.com', new OAuthToken('a', 'r', 9999999999, [], 'cid', 'csec', 'b@gmail.com', 'google'))
    const accts = store.listAccounts()
    expect(accts.map((a) => a.account).sort()).toEqual(['a@gmail.com', 'b@gmail.com'])
  })

  it('stored file content is NOT plaintext (encrypted/obfuscated)', async () => {
    const t = new OAuthToken('SECRET_ACCESS_TOKEN', 'SECRET_REFRESH', 9999999999, [], 'cid', 'csec', 'alice@gmail.com', 'google')
    store.save('alice@gmail.com', t)
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(join(dir, 'oauth_tokens.jsonl'), 'utf8')
    expect(raw).not.toContain('SECRET_ACCESS_TOKEN')
    expect(raw).not.toContain('SECRET_REFRESH')
  })
})

describe('TokenRefresher', () => {
  it('refreshes via injected network and returns a new token with extended expiry', async () => {
    const refresher = new TokenRefresher({
      network: {
        post: async () => ({ access_token: 'new_access', refresh_token: 'same_refresh', expires_in: 3600, scope: 'gmail.readonly drive.readonly' })
      }
    })
    const old = new OAuthToken('old_access', 'same_refresh', 1, ['gmail.readonly'], 'cid', 'csec', 'alice@gmail.com', 'google')
    const fresh = await refresher.refresh(old)
    expect(fresh.accessToken).toBe('new_access')
    expect(fresh.refreshToken).toBe('same_refresh')
    expect(fresh.expiresAt).toBeGreaterThan(old.expiresAt)
    expect(fresh.scopes).toContain('drive.readonly')
  })

  it('throws when there is no refresh_token', async () => {
    const refresher = new TokenRefresher()
    const noRefresh = new OAuthToken('a', '', 9999999999, [], 'cid', 'csec', 'alice@gmail.com', 'google')
    await expect(refresher.refresh(noRefresh)).rejects.toThrow(/refresh_token/)
  })
})

describe('PermissionRevocation', () => {
  it('records account/provider/reason/affected_count', () => {
    const r = new PermissionRevocation('alice@gmail.com', 'google', 'user_request')
    r.affectedCount = 5
    expect(r.account).toBe('alice@gmail.com')
    expect(r.reason).toBe('user_request')
    expect(r.affectedCount).toBe(5)
  })
})
