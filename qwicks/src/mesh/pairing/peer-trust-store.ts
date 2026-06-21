import Database from 'better-sqlite3'
import { PeerRecord, type PeerRecord as PeerRecordType } from '../contracts.js'

/**
 * Persistent trust set of paired peers (RFC 001 §6).
 *
 * Standalone `mesh-trust.db`, isolated from the rest of QWicks. Stores the
 * peer's Ed25519 public key (for envelope verification), fingerprint, trust
 * level, and granted permissions. Private keys are never stored here — only
 * the peer's *public* key. Revocation sets `revokedAt`; active lookups skip
 * revoked peers.
 */

interface Row {
  peerDeviceId: string
  peerDeviceName: string
  peerPublicKey: string
  peerFingerprint: string
  pairedAt: string
  lastSeenAt: string
  trustLevel: string
  permissions: string
  revokedAt: string | null
}

export class PeerTrustStore {
  private readonly db: Database.Database
  private readonly upsertStmt: Database.Statement
  private readonly getStmt: Database.Statement
  private readonly listActiveStmt: Database.Statement
  private readonly listAllStmt: Database.Statement
  private readonly revokeStmt: Database.Statement
  private readonly touchStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS peers (
        peerDeviceId    TEXT PRIMARY KEY,
        peerDeviceName  TEXT NOT NULL,
        peerPublicKey   TEXT NOT NULL,
        peerFingerprint TEXT NOT NULL,
        pairedAt        TEXT NOT NULL,
        lastSeenAt      TEXT NOT NULL,
        trustLevel      TEXT NOT NULL,
        permissions     TEXT NOT NULL,
        revokedAt       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_peers_active ON peers(revokedAt);
    `)
    this.upsertStmt = this.db.prepare(
      `INSERT INTO peers (peerDeviceId, peerDeviceName, peerPublicKey, peerFingerprint, pairedAt, lastSeenAt, trustLevel, permissions, revokedAt)
       VALUES (@peerDeviceId, @peerDeviceName, @peerPublicKey, @peerFingerprint, @pairedAt, @lastSeenAt, @trustLevel, @permissions, NULL)
       ON CONFLICT(peerDeviceId) DO UPDATE SET
         peerDeviceName = excluded.peerDeviceName,
         peerPublicKey = excluded.peerPublicKey,
         peerFingerprint = excluded.peerFingerprint,
         trustLevel = excluded.trustLevel,
         permissions = excluded.permissions,
         revokedAt = NULL`
    )
    this.getStmt = this.db.prepare('SELECT * FROM peers WHERE peerDeviceId = ? AND revokedAt IS NULL')
    this.listActiveStmt = this.db.prepare('SELECT * FROM peers WHERE revokedAt IS NULL ORDER BY pairedAt ASC')
    this.listAllStmt = this.db.prepare('SELECT * FROM peers ORDER BY pairedAt ASC')
    this.revokeStmt = this.db.prepare("UPDATE peers SET revokedAt = ? WHERE peerDeviceId = ? AND revokedAt IS NULL")
    this.touchStmt = this.db.prepare('UPDATE peers SET lastSeenAt = ? WHERE peerDeviceId = ? AND revokedAt IS NULL')
  }

  async upsert(peer: PeerRecordType): Promise<void> {
    const validated = PeerRecord.parse(peer)
    this.upsertStmt.run({
      peerDeviceId: validated.peerDeviceId,
      peerDeviceName: validated.peerDeviceName,
      peerPublicKey: validated.peerPublicKey,
      peerFingerprint: validated.peerFingerprint,
      pairedAt: validated.pairedAt,
      lastSeenAt: validated.lastSeenAt,
      trustLevel: validated.trustLevel,
      permissions: JSON.stringify(validated.permissions)
    })
  }

  async get(peerDeviceId: string): Promise<PeerRecordType | undefined> {
    const row = this.getStmt.get(peerDeviceId) as Row | undefined
    return row ? toRecord(row) : undefined
  }

  async listActive(): Promise<PeerRecordType[]> {
    return (this.listActiveStmt.all() as Row[]).map(toRecord)
  }

  async listAll(): Promise<PeerRecordType[]> {
    return (this.listAllStmt.all() as Row[]).map(toRecord)
  }

  async revoke(peerDeviceId: string, revokedAt = new Date().toISOString()): Promise<void> {
    this.revokeStmt.run(revokedAt, peerDeviceId)
  }

  async touchLastSeen(peerDeviceId: string, lastSeenAt: string): Promise<void> {
    this.touchStmt.run(lastSeenAt, peerDeviceId)
  }

  close(): void {
    this.db.close()
  }
}

function toRecord(r: Row): PeerRecordType {
  return {
    peerDeviceId: r.peerDeviceId,
    peerDeviceName: r.peerDeviceName,
    peerPublicKey: r.peerPublicKey,
    peerFingerprint: r.peerFingerprint,
    pairedAt: r.pairedAt,
    lastSeenAt: r.lastSeenAt,
    trustLevel: r.trustLevel as PeerRecordType['trustLevel'],
    permissions: safeParse(r.permissions),
    ...(r.revokedAt ? { revokedAt: r.revokedAt } : {})
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}
