import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import {
  issueGrantToken,
  verifyGrantToken,
  parseGrantToken,
  type GrantToken
} from '@qwicks/mesh/security/grant-token.js'

describe('GrantToken (RFC 004 §6.4)', () => {
  let issuerDir: string
  let subjectDir: string
  let issuerId: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>>
  let subjectId: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>>

  beforeAll(async () => {
    issuerDir = mkdtempSync(join(tmpdir(), 'gt-issuer-'))
    subjectDir = mkdtempSync(join(tmpdir(), 'gt-subj-'))
    issuerId = await loadOrCreateDeviceIdentity(issuerDir)
    subjectId = await loadOrCreateDeviceIdentity(subjectDir)
  })

  it('issues a valid token that verifies successfully', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    expect(token.version).toBe('1')
    expect(token.issuer).toBe(issuerId.deviceId)
    expect(token.subject).toBe(subjectId.deviceId)
    expect(token.scopes).toEqual(['private'])
    expect(token.sig).toBeTruthy()

    const valid = await verifyGrantToken(token, issuerId.publicKey)
    expect(valid).toBe(true)
  })

  it('rejects a token with wrong issuer public key', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const valid = await verifyGrantToken(token, subjectId.publicKey)
    expect(valid).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'], -1)
    const valid = await verifyGrantToken(token, issuerId.publicKey)
    expect(valid).toBe(false)
  })

  it('rejects a token with tampered subject', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const tampered: GrantToken = { ...token, subject: 'evil-device' }
    const valid = await verifyGrantToken(tampered, issuerId.publicKey)
    expect(valid).toBe(false)
  })

  it('rejects a token with tampered scopes', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const tampered: GrantToken = { ...token, scopes: ['private', 'admin'] }
    const valid = await verifyGrantToken(tampered, issuerId.publicKey)
    expect(valid).toBe(false)
  })

  it('parseGrantToken parses a valid JSON token string', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const raw = JSON.stringify(token)
    const parsed = parseGrantToken(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.tokenId).toBe(token.tokenId)
    expect(parsed!.issuer).toBe(token.issuer)
    expect(parsed!.sig).toBe(token.sig)
  })

  it('parseGrantToken returns null for invalid JSON', () => {
    expect(parseGrantToken('not-json')).toBeNull()
    expect(parseGrantToken('{}')).toBeNull()
    expect(parseGrantToken('{"version":"1"}')).toBeNull()
  })

  it('parseGrantToken returns null with missing fields', () => {
    const partial = JSON.stringify({ version: '1', tokenId: 'x' })
    expect(parseGrantToken(partial)).toBeNull()
  })

  it('round-trips through parse and verify', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const raw = JSON.stringify(token)
    const parsed = parseGrantToken(raw)!
    const valid = await verifyGrantToken(parsed, issuerId.publicKey)
    expect(valid).toBe(true)
  })

  it('defaults TTL to 5 minutes', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    const issued = new Date(token.issuedAt).getTime()
    const expires = new Date(token.expiresAt).getTime()
    expect(expires - issued).toBe(300_000)
  })

  it('binds to a taskId when opts.taskId is supplied', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'], 300_000, { taskId: 'task-42' })
    expect(token.taskId).toBe('task-42')
    // Still verifies correctly against the issuer's key
    const valid = await verifyGrantToken(token, issuerId.publicKey)
    expect(valid).toBe(true)
  })

  it('rejects a tampered taskId in a bound token', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'], 300_000, { taskId: 'task-42' })
    const tampered: GrantToken = { ...token, taskId: 'task-evil' }
    const valid = await verifyGrantToken(tampered, issuerId.publicKey)
    expect(valid).toBe(false)
  })

  it('omits taskId from the canonical hash when unset (no undefined serialization drift)', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'])
    expect(token.taskId).toBeUndefined()
    // The token still verifies — confirms hash excludes absent taskId
    const valid = await verifyGrantToken(token, issuerId.publicKey)
    expect(valid).toBe(true)
  })

  it('parses a token with taskId via parseGrantToken', async () => {
    const token = await issueGrantToken(issuerId, subjectId.deviceId, ['private'], 300_000, { taskId: 'task-99' })
    const parsed = parseGrantToken(JSON.stringify(token))
    expect(parsed).not.toBeNull()
    expect(parsed!.taskId).toBe('task-99')
  })
})
