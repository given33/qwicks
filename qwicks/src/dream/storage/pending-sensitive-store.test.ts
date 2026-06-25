/**
 * Batch B (spec §2.5): PendingSensitiveStore — physical isolation for
 * high-sensitivity drafts awaiting confirmation.
 *
 * NOTE: runs under qwicks/ vitest (Node 22). Logic verified via tsc here.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryItem, MemoryType, MemoryScope, MemoryItemDraft } from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'
import { PendingSensitiveStore } from './pending-sensitive-store.js'

function makeDraft(content: string): MemoryItemDraft {
  return new MemoryItemDraft(MemoryType.FACT, content)
}

describe('PendingSensitiveStore', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let store: PendingSensitiveStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-pending-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'p.db') })
    store = new PendingSensitiveStore(repo)
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('enqueues a pending draft and lists it', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    const pending = store.list('default')
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(id)
    expect(pending[0].category).toBe('health')
  })

  it('does not duplicate a fingerprint already pending (UNIQUE dedup)', () => {
    store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    expect(() =>
      store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    ).not.toThrow()
    expect(store.list('default')).toHaveLength(1)
  })

  it('does not enqueue a fingerprint that already exists as a confirmed memory (bidirectional dedup)', () => {
    const item = new MemoryItem('mem_1', 'default', MemoryType.FACT, 'I take insulin', MemoryScope.USER)
    repo.upsert(item)
    const fp = item.fingerprint()
    expect(() =>
      store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: fp })
    ).not.toThrow()
    expect(store.list('default')).toHaveLength(0)
  })

  it('dismiss writes a sticky tombstone; re-enqueue of same fingerprint is a no-op', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    store.dismiss('default', id, 'fp1')
    expect(store.list('default')).toHaveLength(0)
    store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    expect(store.list('default')).toHaveLength(0)
  })

  it('confirm path: get returns the draft, delete removes it', () => {
    const id = store.enqueue({ userId: 'default', draft: makeDraft('I take insulin'), category: 'health', fingerprint: 'fp1' })
    expect(store.get(id)).not.toBeNull()
    store.delete(id)
    expect(store.get(id)).toBeNull()
  })

  it('isDismissed reports tombstone state', () => {
    store.recordDismissTombstone('default', 'fp_xyz')
    expect(store.isDismissed('default', 'fp_xyz')).toBe(true)
    expect(store.isDismissed('default', 'fp_other')).toBe(false)
  })

  it('purgeStale removes rows older than maxAgeDays', () => {
    store.enqueue({ userId: 'default', draft: makeDraft('old'), category: 'health', fingerprint: 'fp_old' })
    repo.rawExec(
      `UPDATE pending_sensitive_draft SET created_at = ? WHERE fingerprint = 'fp_old'`,
      [new Date(Date.now() - 40 * 86400_000).toISOString()]
    )
    const purged = store.purgeStale(30)
    expect(purged).toBe(1)
    expect(store.list('default')).toHaveLength(0)
  })
})
