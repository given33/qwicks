import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { toHex, fromHex } from './device-identity.js'
import type { SessionKeyMaterial } from '../pairing/pairing.js'

/**
 * Session key store (RFC 001 §5.3, 006 §4.2).
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
 * Persistence: when a `dataDir` is supplied, keys are loaded on construction
 * and flushed on every mutation, so a restart no longer forces re-pairing.
 * The on-disk file (`session-keys.json`) is written 0o600 (best-effort on
 * Windows). Keys never leave the device.
 */

const SESSION_KEYS_FILE = 'session-keys.json'

interface StoredEntry {
  peerDeviceId: string
  /** Hex of the verify key, keyed by peerDeviceId. */
  verifyKeyHex: string
}

export class SessionKeyStore {
  private readonly keys = new Map<string, Uint8Array>()
  private readonly selfDeviceId: string
  private readonly filePath?: string

  constructor(selfDeviceId: string, dataDir?: string) {
    this.selfDeviceId = selfDeviceId
    this.filePath = dataDir ? join(dataDir, SESSION_KEYS_FILE) : undefined
  }

  /**
   * Load persisted session keys from disk. No-op when no dataDir was supplied
   * or the file doesn't exist yet (first run). Safe to call once at boot.
   */
  async load(): Promise<void> {
    if (!this.filePath) return
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const entries = JSON.parse(raw) as StoredEntry[]
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        if (entry && typeof entry.peerDeviceId === 'string' && typeof entry.verifyKeyHex === 'string') {
          this.keys.set(entry.peerDeviceId, fromHex(entry.verifyKeyHex))
        }
      }
    } catch {
      // Missing file or parse error → start empty (first run / corrupt file)
    }
  }

  /**
   * Store the session key material from a successful pairing.
   * Automatically selects the correct direction-bound key for verifying
   * messages FROM `peerDeviceId`, then persists to disk if configured.
   */
  async storeFromPairing(peerDeviceId: string, material: SessionKeyMaterial): Promise<void> {
    const verifyKey = this.selfDeviceId < peerDeviceId ? material.bToAKey : material.aToBKey
    this.keys.set(peerDeviceId, verifyKey)
    await this.persist()
  }

  /** Look up the verification key for messages from `peerDeviceId`. */
  getVerifyKey(peerDeviceId: string): Uint8Array | undefined {
    return this.keys.get(peerDeviceId)
  }

  /** Remove a peer's session keys (e.g., on revocation), then persist. */
  async revoke(peerDeviceId: string): Promise<void> {
    this.keys.delete(peerDeviceId)
    await this.persist()
  }

  /** Number of active session keys. */
  get size(): number {
    return this.keys.size
  }

  /** Flush the current key set to disk (best-effort, 0o600). */
  private async persist(): Promise<void> {
    if (!this.filePath) return
    const entries: StoredEntry[] = [...this.keys.entries()].map(([peerDeviceId, key]) => ({
      peerDeviceId,
      verifyKeyHex: toHex(key)
    }))
    try {
      await mkdir(join(this.filePath, '..'), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(entries, null, 2), 'utf8')
      await chmod(this.filePath, 0o600).catch(() => {})
    } catch {
      // Persistence is best-effort; in-memory keys still work.
    }
  }
}
