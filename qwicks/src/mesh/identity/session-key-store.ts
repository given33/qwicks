import type { SessionKeyMaterial } from '../pairing/pairing.js'

/**
 * In-memory session key store (RFC 001 §5.3, 006 §4.2).
 *
 * After a successful pairing, both sides derive identical `SessionKeyMaterial`
 * via X25519 ECDH + HKDF-SHA256. The material contains two direction-bound keys:
 *   - `aToBKey`: A→B direction (A's messages HMAC'd with this; B verifies with it)
 *   - `bToAKey`: B→A direction (B's messages HMAC'd with this; A verifies with it)
 *
 * This store maps `peerDeviceId → verifyKey` where `verifyKey` is the key used
 * to authenticate messages FROM that peer. The choice depends on which side we
 * are in the device-id-ordered pairing:
 *   - If `selfDeviceId < peerDeviceId`: we are A, peer is B → verify with `bToAKey`
 *   - If `selfDeviceId > peerDeviceId`: we are B, peer is A → verify with `aToBKey`
 *
 * Session keys are NOT persisted to disk — they are ephemeral per-process. A
 * restart requires re-pairing (or Phase 3 key rotation).
 */

export class SessionKeyStore {
  private readonly keys = new Map<string, Uint8Array>()
  private readonly selfDeviceId: string

  constructor(selfDeviceId: string) {
    this.selfDeviceId = selfDeviceId
  }

  /**
   * Store the session key material from a successful pairing.
   * Automatically selects the correct direction-bound key for verifying
   * messages FROM `peerDeviceId`.
   */
  storeFromPairing(peerDeviceId: string, material: SessionKeyMaterial): void {
    const verifyKey = this.selfDeviceId < peerDeviceId ? material.bToAKey : material.aToBKey
    this.keys.set(peerDeviceId, verifyKey)
  }

  /** Look up the verification key for messages from `peerDeviceId`. */
  getVerifyKey(peerDeviceId: string): Uint8Array | undefined {
    return this.keys.get(peerDeviceId)
  }

  /** Remove a peer's session keys (e.g., on revocation). */
  revoke(peerDeviceId: string): void {
    this.keys.delete(peerDeviceId)
  }

  /** Number of active session keys. */
  get size(): number {
    return this.keys.size
  }
}
