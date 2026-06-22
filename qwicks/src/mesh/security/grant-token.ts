import { randomUUID } from 'node:crypto'
import type { DeviceIdentity } from '../identity/device-identity.js'
import { verifySignature, toHex, fromHex } from '../identity/device-identity.js'
import { sha256 } from '@noble/hashes/sha256'

/**
 * GrantToken — signed capability for private memory scope access (RFC 004 §6.4).
 *
 * When a peer requests memory with `scopes: ['private']`, it must present a
 * grant token signed by the memory owner. The token:
 *   - Names the issuer (owner) and subject (requesting peer)
 *   - Is scoped to specific memory accesses
 *   - Has a short expiry (default 300s)
 *   - Carries an Ed25519 signature over a canonical hash of the above fields
 *
 * This prevents ambient access to private memory — every private query must be
 * explicitly authorized by the owner through a user-facing approval step that
 * issues a short-lived token.
 */

const GRANT_TOKEN_VERSION = '1'

export interface GrantTokenPayload {
  version: string
  tokenId: string
  issuer: string       // owner deviceId
  subject: string      // requesting peer deviceId
  scopes: string[]     // e.g. ['private']
  issuedAt: string     // ISO-8601
  expiresAt: string    // ISO-8601
  nonce: string
  /** Optional task binding (RFC 004 §8): the token is only valid for this taskId.
   *  Absent → token is valid for any task from this subject. */
  taskId?: string
}

export interface GrantToken extends GrantTokenPayload {
  sig: string          // Ed25519 hex signature over canonical hash of payload
}

const GRANT_TOKEN_TTL_MS = 300_000 // 5 minutes

/**
 * Issue a grant token signed by the memory owner's device identity.
 * The owner calls this after the user approves a private memory request
 * via the approval gate. Optionally binds the token to a specific taskId
 * so it cannot be replayed for a different task.
 */
export async function issueGrantToken(
  identity: DeviceIdentity,
  subject: string,
  scopes: string[],
  ttlMs: number = GRANT_TOKEN_TTL_MS,
  opts?: { taskId?: string }
): Promise<GrantToken> {
  const now = Date.now()
  const payload: GrantTokenPayload = {
    version: GRANT_TOKEN_VERSION,
    tokenId: randomUUID(),
    issuer: identity.deviceId,
    subject,
    scopes,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    nonce: randomUUID().replace(/-/g, ''),
    ...(opts?.taskId ? { taskId: opts.taskId } : {})
  }

  const hash = canonicalGrantHash(payload)
  const sig = toHex(await identity.sign(hash))

  return { ...payload, sig }
}

/**
 * Verify a grant token. Returns true if:
 *   - The signature matches the issuer's public key
 *   - The token has not expired
 *   - The version is recognised
 */
export async function verifyGrantToken(
  token: GrantToken,
  issuerPublicKey: Uint8Array
): Promise<boolean> {
  if (token.version !== GRANT_TOKEN_VERSION) return false
  if (Date.now() > new Date(token.expiresAt).getTime()) return false

  const { sig, ...payload } = token
  const hash = canonicalGrantHash(payload)

  return verifySignature(issuerPublicKey, hash, fromHex(sig))
}

/**
 * Parse a wire-format grant token string (compact JSON, base64-like).
 * In v1, the wire format is simply `JSON.stringify(token)`.
 */
export function parseGrantToken(raw: string): GrantToken | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof obj.version === 'string' &&
      typeof obj.tokenId === 'string' &&
      typeof obj.issuer === 'string' &&
      typeof obj.subject === 'string' &&
      Array.isArray(obj.scopes) &&
      typeof obj.issuedAt === 'string' &&
      typeof obj.expiresAt === 'string' &&
      typeof obj.nonce === 'string' &&
      typeof obj.sig === 'string'
    ) {
      return {
        version: obj.version,
        tokenId: obj.tokenId,
        issuer: obj.issuer,
        subject: obj.subject,
        scopes: obj.scopes as string[],
        issuedAt: obj.issuedAt,
        expiresAt: obj.expiresAt,
        nonce: obj.nonce,
        ...(typeof obj.taskId === 'string' ? { taskId: obj.taskId } : {}),
        sig: obj.sig
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Canonical hash of the grant payload fields (sorted keys, deterministic).
 * Both issuer and verifier compute the same hash to produce/verify the signature.
 */
function canonicalGrantHash(payload: GrantTokenPayload): Uint8Array {
  const canonical = JSON.stringify({
    version: payload.version,
    tokenId: payload.tokenId,
    issuer: payload.issuer,
    subject: payload.subject,
    scopes: payload.scopes.slice().sort(),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    ...(payload.taskId ? { taskId: payload.taskId } : {})
  })
  return sha256(new TextEncoder().encode(canonical))
}
