import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { randomUUID } from 'node:crypto'
import type { DeviceIdentity } from '../identity/device-identity.js'
import { verifySignature, toHex, fromHex } from '../identity/device-identity.js'
import { Envelope, type Envelope as EnvelopeType } from '../contracts.js'

/**
 * Envelope signing & replay protection (RFC 000 §8.2, 006 §4.1/§4.3).
 *
 * Every cross-device message carries dual authentication:
 *   - auth.sig       : HMAC-SHA256 over the canonical signing input, keyed by
 *                      the session MAC key (direction-bound, from ECDH). Proves
 *                      the message was not tampered with in transit and binds
 *                      it to the live session.
 *   - auth.deviceSig : the sender's Ed25519 signature over the same input.
 *                      Survives session re-keying and lets the receiver hold
 *                      the sender accountable even if a session key leaks.
 *
 * The canonical signing input is a deterministic JSON encoding of the
 * authenticated fields so that key-ordering in the payload object cannot
 * change what is signed.
 */

/**
 * Canonical JSON: object keys sorted recursively (depth-first), arrays keep
 * element order, no insignificant whitespace. Two peers that build the same
 * logical payload with different key insertion order produce identical bytes,
 * so the signature is stable across them.
 *
 * (Numbers are not JCS-value-sorted; mesh payloads are strings/objects/arrays,
 * so insertion-vs-sorted ordering of numbers is not a concern for v1.)
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}'
}

export function canonicalSigningInput(input: {
  payload: unknown
  messageId: string
  nonce: string
  timestamp: string
  taskId?: string
}): Uint8Array {
  const canonical = canonicalStringify({
    payload: input.payload,
    messageId: input.messageId,
    nonce: input.nonce,
    timestamp: input.timestamp,
    taskId: input.taskId ?? null
  })
  return new TextEncoder().encode(canonical)
}

export async function signEnvelope(
  base: Omit<EnvelopeType, 'auth'>,
  identity: DeviceIdentity,
  sessionKey: Uint8Array
): Promise<EnvelopeType> {
  const signingInput = canonicalSigningInput({
    payload: base.payload,
    messageId: base.messageId,
    nonce: base.nonce,
    timestamp: base.timestamp,
    taskId: base.taskId
  })
  const sig = hmac(sha256, sessionKey, signingInput)
  const deviceSig = await identity.sign(signingInput)
  const env: EnvelopeType = {
    ...base,
    auth: { alg: 'hmac', sig: toHex(sig), deviceSig: toHex(deviceSig) }
  }
  return Envelope.parse(env)
}

export async function verifyEnvelope(
  env: EnvelopeType,
  expectedPeerPublicKey: Uint8Array,
  sessionKey: Uint8Array
): Promise<boolean> {
  const signingInput = canonicalSigningInput({
    payload: env.payload,
    messageId: env.messageId,
    nonce: env.nonce,
    timestamp: env.timestamp,
    taskId: env.taskId
  })
  const expectedMac = hmac(sha256, sessionKey, signingInput)
  if (toHex(expectedMac) !== env.auth.sig) return false
  return verifySignature(expectedPeerPublicKey, signingInput, fromHex(env.auth.deviceSig))
}

/**
 * Per-peer sliding replay window (RFC 006 §4.3).
 *
 * Stores seen nonces per `from` device; a nonce is accepted exactly once and
 * rejected on any repeat. The window is capacity-bounded (default 1024) and
 * evicts in FIFO order, so a nonce dropped from the window would be accepted
 * again — callers MUST therefore also enforce a timestamp skew bound (±60s,
 * RFC 006 §4.3) so stale nonces are rejected by time, not by the window alone.
 */
export class ReplayWindow {
  private readonly capacity: number
  private readonly seen = new Map<string, Set<string>>()
  private readonly order = new Map<string, string[]>()

  constructor(capacity = 1024) {
    this.capacity = capacity
  }

  checkAndAdd(fromDeviceId: string, nonce: string): boolean {
    let set = this.seen.get(fromDeviceId)
    let order = this.order.get(fromDeviceId)
    if (!set || !order) {
      set = new Set()
      order = []
      this.seen.set(fromDeviceId, set)
      this.order.set(fromDeviceId, order)
    }
    if (set.has(nonce)) return false
    set.add(nonce)
    order.push(nonce)
    if (order.length > this.capacity) {
      const evicted = order.shift()!
      set.delete(evicted)
    }
    return true
  }
}

/** Generate a fresh message id / nonce pair for a new outgoing envelope. */
export function freshEnvelopeIds(): { messageId: string; nonce: string } {
  return {
    messageId: randomUUID(),
    nonce: randomUUID().replace(/-/g, '')
  }
}
