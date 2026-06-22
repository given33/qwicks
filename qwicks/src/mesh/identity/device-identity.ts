import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import * as ed from '@noble/ed25519'
import { etc } from '@noble/ed25519'
import { x25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { hkdf } from '@noble/hashes/hkdf'

// @noble/ed25519 v2 deliberately ships without a SHA-512 implementation so it
// stays free of Node crypto deps in browsers. Wire one up once at module load.
etc.sha512Sync = (m: Uint8Array) => sha512(m)

/**
 * Persistent device identity (RFC 000 §6.1).
 *
 * Each QWicks install generates, on first Mesh enable, a permanent Ed25519
 * signing keypair (used for `auth.deviceSig` on every envelope) and an X25519
 * ephemeral keypair (used during pairing ECDH, RFC 001 §5.3). Private keys are
 * stored in a 0600 file and never transmitted; the fingerprint (first 16 hex of
 * SHA-256 over the Ed25519 public key) is the human-verifiable identity.
 */
export interface DeviceIdentity {
  deviceId: string
  deviceName?: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  ephemeralPublicKey: Uint8Array
  ephemeralPrivateKey: Uint8Array
  fingerprint: string
  sign: (message: Uint8Array) => Promise<Uint8Array>
}

const IDENTITY_FILE = 'device-identity.json'

export async function loadOrCreateDeviceIdentity(rootDir: string): Promise<DeviceIdentity> {
  const path = join(rootDir, IDENTITY_FILE)
  let stored: StoredIdentity
  try {
    const raw = await readFile(path, 'utf8')
    stored = JSON.parse(raw) as StoredIdentity
  } catch {
    stored = await generateIdentity()
    // Ensure the parent directory exists before writing (the caller may pass a
    // nested path like `<dataDir>/mesh` that doesn't exist yet).
    await mkdir(rootDir, { recursive: true }).catch(() => {})
    await writeFile(path, JSON.stringify(stored, null, 2), 'utf8')
    // 0o600: readable/writable by owner only. Best-effort on Windows.
    await chmod(path, 0o600).catch(() => {})
  }
  return materialize(stored)
}

interface StoredIdentity {
  deviceId: string
  publicKey: string // hex
  privateKey: string // hex
  ephemeralPublicKey: string // hex
  ephemeralPrivateKey: string // hex
}

async function generateIdentity(): Promise<StoredIdentity> {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKey(privateKey)
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey()
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey)
  return {
    deviceId: randomUUID(),
    publicKey: toHex(publicKey),
    privateKey: toHex(privateKey),
    ephemeralPublicKey: toHex(ephemeralPublicKey),
    ephemeralPrivateKey: toHex(ephemeralPrivateKey)
  }
}

function materialize(stored: StoredIdentity): DeviceIdentity {
  const publicKey = fromHex(stored.publicKey)
  const privateKey = fromHex(stored.privateKey)
  const ephemeralPublicKey = fromHex(stored.ephemeralPublicKey)
  const ephemeralPrivateKey = fromHex(stored.ephemeralPrivateKey)
  return {
    deviceId: stored.deviceId,
    publicKey,
    privateKey,
    ephemeralPublicKey,
    ephemeralPrivateKey,
    fingerprint: toHex(sha256(publicKey).slice(0, 8)),
    sign: (message: Uint8Array) => ed.signAsync(message, privateKey)
  }
}

export async function verifySignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  return ed.verify(signature, message, publicKey)
}

/**
 * Derive the bidirectional session key material from a pairing ECDH (RFC 001 §5.3).
 * The shared secret `Z` comes from X25519; HKDF-SHA256 expands it into two
 * direction-bound keys: aToBKey (A→B MAC) and bToAKey (B→A MAC).
 *
 * Both peers derive identical material because X25519 getSharedSecret is
 * symmetric and the HKDF salt/info are agreed out-of-band (pairing code +
 * nonces).
 */
export function deriveSessionKeyMaterial(input: {
  selfEphemeralPrivate: Uint8Array
  peerEphemeralPublic: Uint8Array
  salt: string
  info: string
}): { aToBKey: Uint8Array; bToAKey: Uint8Array } {
  // X25519: getSharedSecret(privateKey, publicKey) — private scalar first,
  // peer public point second. Alice: alicePriv · bobPub == Bob: bobPriv · alicePub.
  const shared = x25519.getSharedSecret(input.selfEphemeralPrivate, input.peerEphemeralPublic)
  const saltBytes = new TextEncoder().encode(input.salt)
  const infoBytes = new TextEncoder().encode(input.info)
  const material = hkdf(sha256, shared, saltBytes, infoBytes, 64)
  return {
    aToBKey: material.slice(0, 32),
    bToAKey: material.slice(32, 64)
  }
}

const HEX = '0123456789abcdef'
export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0xf]
  return out
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
