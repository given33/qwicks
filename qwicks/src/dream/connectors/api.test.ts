import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryItem, MemoryLifecycleStatus, MemoryScope, MemoryType } from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { ConnectorControls } from './api.js'

describe('ConnectorControls (Batch E)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: ConnectorControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-conn-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'c.db') })
    controls = new ConnectorControls(repo)
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  function gmailItem(id: string): MemoryItem {
    const m = new MemoryItem(id, 'default', MemoryType.FACT, `flight info ${id}`, MemoryScope.USER)
    m.provenance.source = 'gmail' as never
    return m
  }

  it('revokeConnector preview returns affected count without mutating', () => {
    repo.upsert(gmailItem('m1'))
    repo.upsert(gmailItem('m2'))
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: true })
    expect(r.preview).toBe(true)
    expect(r.affectedCount).toBe(2)
    expect(repo.get('m1')?.status).toBe(MemoryLifecycleStatus.ACTIVE)
  })

  it('revokeConnector execute tombstones affected memories (CONNECTOR_REVOKED)', () => {
    repo.upsert(gmailItem('m1'))
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: false })
    expect(r.preview).toBe(false)
    expect(r.affectedCount).toBe(1)
    const after = repo.get('m1')
    expect(after?.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
    expect(after?.metadata.connector_revoked_provider).toBe('gmail')
  })

  it('revokeConnector ignores memories from other providers', () => {
    const drive = new MemoryItem('m1', 'default', MemoryType.FACT, 'doc', MemoryScope.USER)
    drive.provenance.source = 'drive' as never
    repo.upsert(drive)
    repo.upsert(gmailItem('m2'))
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: true })
    expect(r.affectedCount).toBe(1)
  })

  it('revokeConnector ignores already-suppressed memories', () => {
    const m = gmailItem('m1')
    repo.upsert(m)
    m.transitionStatus(MemoryLifecycleStatus.SUPPRESSED, { actor: 'test', reason: 'pre-suppressed' })
    repo.upsert(m)
    const r = controls.revokeConnector('default', 'gmail', 'alice@gmail.com', { preview: true })
    expect(r.affectedCount).toBe(0)
  })
})
