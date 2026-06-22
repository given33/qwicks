import { randomInt } from 'node:crypto'
import type { DeviceIdentity } from '../identity/device-identity.js'
import {
  deriveSessionKeyMaterial,
  verifySignature,
  toHex,
  fromHex
} from '../identity/device-identity.js'
import type { PeerTrustStore } from './peer-trust-store.js'
import type { AuditLog } from '../audit/audit-log.js'

/**
 * Pairing protocol (RFC 001 §4-§5).
 *
 * Two-party handshake over an injected request transport (so the logic is
 * testable without real sockets). The responder generates a 6-digit code, both
 * sides run X25519 ECDH, derive a direction-bound session key, and persist each
 * other's Ed25519 public key + fingerprint as trusted peers. A wrong code is
 * rejected; three failures drop the pending challenge.
 */

const PROTOCOL_VERSION = '1'
const SESSION_INFO_PREFIX = 'qwicks-mesh-v1'
const CODE_TTL_MS = 120_000
const MAX_CODE_TRIES = 3

export interface HelloParams {
  initiatorDeviceId: string
  initiatorDeviceName: string
  initiatorPublicKey: string // Ed25519 hex
  initiatorFingerprint: string
  initiatorEphemeralPublic: string // X25519 hex
  initiatorNonce: string
  protocolVersion: string
  proposedAt: string
}

export interface HelloResult {
  accepted: boolean
  reason?: string
  responderDeviceId?: string
  responderDeviceName?: string
  responderPublicKey?: string
  responderFingerprint?: string
  responderEphemeralPublic?: string
  responderNonce?: string
  expiresAt?: string
}

export interface VerifyParams {
  initiatorDeviceId: string
  responderDeviceId: string
  code: string
  initiatorSignature: string // Ed25519 hex over (initiatorNonce || code)
}

export interface VerifyResult {
  verified: boolean
  reason?: string
  sessionKeyHint?: string
}

export interface SessionKeyMaterial {
  aToBKey: Uint8Array
  bToAKey: Uint8Array
}

interface PendingChallenge {
  code: string
  params: HelloParams
  responderNonce: string
  expiresAt: number
  tries: number
}

type Send = (method: string, params: unknown) => Promise<unknown>

export class PairingResponder {
  private readonly identity: DeviceIdentity
  private readonly trustStore: PeerTrustStore
  private readonly audit: AuditLog
  private readonly deviceName: string
  private readonly pending = new Map<string, PendingChallenge>()
  private readonly responderNonce = randomNonce()
  /** Material derived by the most recent successful verify (for session boot). */
  lastSessionKeyMaterial?: SessionKeyMaterial

  constructor(opts: { identity: DeviceIdentity; trustStore: PeerTrustStore; audit: AuditLog; deviceName: string }) {
    this.identity = opts.identity
    this.trustStore = opts.trustStore
    this.audit = opts.audit
    this.deviceName = opts.deviceName
  }

  async handleHello(params: HelloParams): Promise<HelloResult> {
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      return { accepted: false, reason: 'incompatible_protocol' }
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.pending.set(params.initiatorDeviceId, {
      code,
      params,
      responderNonce: this.responderNonce,
      expiresAt: Date.now() + CODE_TTL_MS,
      tries: 0
    })
    return {
      accepted: true,
      responderDeviceId: this.identity.deviceId,
      responderDeviceName: this.deviceName,
      responderPublicKey: toHex(this.identity.publicKey),
      responderFingerprint: this.identity.fingerprint,
      responderEphemeralPublic: toHex(this.identity.ephemeralPublicKey),
      responderNonce: this.responderNonce,
      expiresAt: new Date(this.pending.get(params.initiatorDeviceId)!.expiresAt).toISOString()
    }
  }

  async handleVerify(params: VerifyParams): Promise<VerifyResult> {
    const challenge = this.pending.get(params.initiatorDeviceId)
    if (!challenge) return { verified: false, reason: 'no_pending_challenge' }
    if (Date.now() > challenge.expiresAt) {
      this.pending.delete(params.initiatorDeviceId)
      return { verified: false, reason: 'challenge_expired' }
    }
    if (params.code !== challenge.code) {
      challenge.tries += 1
      if (challenge.tries >= MAX_CODE_TRIES) {
        this.pending.delete(params.initiatorDeviceId)
        await this.audit.record({ kind: 'pairing_code_mismatch', from: params.initiatorDeviceId, to: this.identity.deviceId, outcome: 'denied', traceId: params.initiatorDeviceId, timestamp: nowIso(), detail: { tries: challenge.tries } })
      }
      return { verified: false, reason: 'code_mismatch' }
    }

    // Verify the initiator's Ed25519 signature over (initiatorNonce || code).
    const signedMessage = new TextEncoder().encode(`${challenge.params.initiatorNonce}||${params.code}`)
    const ok = await verifySignature(fromHex(challenge.params.initiatorPublicKey), signedMessage, fromHex(params.initiatorSignature))
    if (!ok) {
      this.pending.delete(params.initiatorDeviceId)
      await this.audit.record({ kind: 'pairing_fingerprint_mismatch', from: params.initiatorDeviceId, to: this.identity.deviceId, outcome: 'denied', traceId: params.initiatorDeviceId, timestamp: nowIso(), detail: {} })
      return { verified: false, reason: 'signature_invalid' }
    }

    const info = sessionInfo(params.initiatorDeviceId, this.identity.deviceId)
    const material = deriveSessionKeyMaterial({
      selfEphemeralPrivate: this.identity.ephemeralPrivateKey,
      peerEphemeralPublic: fromHex(challenge.params.initiatorEphemeralPublic),
      salt: `${params.code}||${challenge.params.initiatorNonce}||${challenge.responderNonce}`,
      info
    })
    this.lastSessionKeyMaterial = material

    await this.trustStore.upsert({
      peerDeviceId: params.initiatorDeviceId,
      peerDeviceName: challenge.params.initiatorDeviceName,
      peerPublicKey: challenge.params.initiatorPublicKey,
      peerFingerprint: challenge.params.initiatorFingerprint,
      pairedAt: nowIso(),
      lastSeenAt: nowIso(),
      trustLevel: 'standard',
      permissions: {}
    })
    await this.audit.record({ kind: 'pairing_completed', from: params.initiatorDeviceId, to: this.identity.deviceId, outcome: 'success', traceId: params.initiatorDeviceId, timestamp: nowIso(), detail: {} })
    this.pending.delete(params.initiatorDeviceId)
    return { verified: true, sessionKeyHint: info }
  }

  getPendingCode(initiatorDeviceId: string): string | null {
    const challenge = this.pending.get(initiatorDeviceId)
    if (!challenge || Date.now() > challenge.expiresAt) return null
    return challenge.code
  }

  /** List pending pairing challenges (for UI display). Expired entries are
   *  filtered out. Each entry includes the 6-digit code so a user on this
   *  device can read it to the initiator's operator. */
  listPending(): Array<{ initiatorDeviceId: string; initiatorDeviceName: string; code: string; expiresAt: string }> {
    const now = Date.now()
    const result: Array<{ initiatorDeviceId: string; initiatorDeviceName: string; code: string; expiresAt: string }> = []
    for (const [initiatorDeviceId, challenge] of this.pending) {
      if (now > challenge.expiresAt) continue
      result.push({
        initiatorDeviceId,
        initiatorDeviceName: challenge.params.initiatorDeviceName,
        code: challenge.code,
        expiresAt: new Date(challenge.expiresAt).toISOString()
      })
    }
    return result
  }
}

export class PairingInitiator {
  private readonly identity: DeviceIdentity
  private readonly trustStore: PeerTrustStore
  private readonly audit: AuditLog
  private readonly deviceName: string
  private helloResult?: HelloResult
  private helloParams?: HelloParams

  constructor(opts: { identity: DeviceIdentity; trustStore: PeerTrustStore; audit: AuditLog; deviceName: string }) {
    this.identity = opts.identity
    this.trustStore = opts.trustStore
    this.audit = opts.audit
    this.deviceName = opts.deviceName
  }

  async hello(send: Send): Promise<HelloResult> {
    const nonce = randomNonce()
    const params: HelloParams = {
      initiatorDeviceId: this.identity.deviceId,
      initiatorDeviceName: this.deviceName,
      initiatorPublicKey: toHex(this.identity.publicKey),
      initiatorFingerprint: this.identity.fingerprint,
      initiatorEphemeralPublic: toHex(this.identity.ephemeralPublicKey),
      initiatorNonce: nonce,
      protocolVersion: PROTOCOL_VERSION,
      proposedAt: nowIso()
    }
    const result = (await send('pairing/hello', params)) as HelloResult
    if (!result.accepted) throw new Error(`pairing rejected: ${result.reason ?? 'unknown'}`)
    this.helloParams = params
    this.helloResult = result
    await this.audit.record({ kind: 'pairing_hello', from: this.identity.deviceId, to: result.responderDeviceId ?? '?', outcome: 'success', traceId: this.identity.deviceId, timestamp: nowIso(), detail: {} })
    return result
  }

  async verify(send: Send, code: string): Promise<SessionKeyMaterial> {
    if (!this.helloResult || !this.helloParams) throw new Error('hello not sent')
    const signedMessage = new TextEncoder().encode(`${this.helloParams.initiatorNonce}||${code}`)
    const initiatorSignature = toHex(await this.identity.sign(signedMessage))

    const verifyResult = (await send('pairing/verify', {
      initiatorDeviceId: this.identity.deviceId,
      responderDeviceId: this.helloResult.responderDeviceId!,
      code,
      initiatorSignature
    } as VerifyParams)) as VerifyResult

    if (!verifyResult.verified) throw new Error(`pairing verify failed: ${verifyResult.reason ?? 'unknown'}`)

    const info = verifyResult.sessionKeyHint!
    const material = deriveSessionKeyMaterial({
      selfEphemeralPrivate: this.identity.ephemeralPrivateKey,
      peerEphemeralPublic: fromHex(this.helloResult.responderEphemeralPublic!),
      salt: `${code}||${this.helloParams.initiatorNonce}||${this.helloResult.responderNonce}`,
      info
    })

    await this.trustStore.upsert({
      peerDeviceId: this.helloResult.responderDeviceId!,
      peerDeviceName: this.helloResult.responderDeviceName!,
      peerPublicKey: this.helloResult.responderPublicKey!,
      peerFingerprint: this.helloResult.responderFingerprint!,
      pairedAt: nowIso(),
      lastSeenAt: nowIso(),
      trustLevel: 'standard',
      permissions: {}
    })
    await this.audit.record({ kind: 'pairing_completed', from: this.identity.deviceId, to: this.helloResult.responderDeviceId!, outcome: 'success', traceId: this.identity.deviceId, timestamp: nowIso(), detail: {} })
    return material
  }
}

function randomNonce(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
}

function sessionInfo(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${SESSION_INFO_PREFIX}|${lo}|${hi}`
}

function nowIso(): string {
  return new Date().toISOString()
}
