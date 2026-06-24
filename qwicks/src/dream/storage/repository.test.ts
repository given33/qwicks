import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType,
  newMemoryId
} from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return new MemoryItem(
    overrides.id ?? newMemoryId(),
    overrides.userId ?? 'alice',
    overrides.type ?? MemoryType.FACT,
    overrides.content ?? 'something factual',
    overrides.scope ?? MemoryScope.USER,
    overrides.tags ?? [],
    overrides.importance ?? 0.5,
    overrides.confidence ?? 0.7,
    overrides.createdAt ?? '2026-06-23T00:00:00Z',
    overrides.updatedAt ?? '2026-06-23T00:00:00Z',
    overrides.expiresAt ?? null,
    overrides.provenance ?? new MemoryProvenance(),
    overrides.embedding ?? null,
    overrides.embeddingModel ?? null,
    overrides.related ?? [],
    overrides.metadata ?? {},
    overrides.status ?? MemoryLifecycleStatus.ACTIVE,
    overrides.statusHistory ?? [],
    overrides.schemaVersion ?? 2
  )
}

describe('SqliteMemoryRepository', () => {
  let dir: string
  let repo: SqliteMemoryRepository

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-store-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'memory.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports its backend name', () => {
    expect(repo.backendName()).toBe('sqlite')
  })

  it('upserts and retrieves a memory round-trip preserving all rich fields', () => {
    const item = makeItem({
      type: MemoryType.PREFERENCE,
      content: 'vegetarian',
      tags: ['diet'],
      importance: 0.8,
      confidence: 0.9,
      provenance: new MemoryProvenance('user', null, 't1', 'tn1', 0.9),
      metadata: { theme: 'food' },
      related: ['mem_other']
    })
    repo.upsert(item)
    const got = repo.get(item.id)
    expect(got).not.toBeNull()
    expect(got!.type).toBe(MemoryType.PREFERENCE)
    expect(got!.content).toBe('vegetarian')
    expect(got!.tags).toEqual(['diet'])
    expect(got!.importance).toBe(0.8)
    expect(got!.confidence).toBe(0.9)
    expect(got!.provenance.threadId).toBe('t1')
    expect(got!.metadata.theme).toBe('food')
    expect(got!.related).toEqual(['mem_other'])
    expect(got!.status).toBe(MemoryLifecycleStatus.ACTIVE)
  })

  it('assigns an id and updatedAt on upsert when missing', () => {
    const item = makeItem({ id: '' })
    const saved = repo.upsert(item)
    expect(saved.id).toMatch(/^mem_[0-9a-f]{12}$/)
    expect(saved.updatedAt).not.toBe('')
  })

  it('upsert is an update on conflict (same id)', () => {
    const item = makeItem({ content: 'v1' })
    repo.upsert(item)
    item.content = 'v2'
    repo.upsert(item)
    const got = repo.get(item.id)
    expect(got!.content).toBe('v2')
  })

  it('upsertBatch writes multiple items in one transaction, same order returned', () => {
    const items = [makeItem({ content: 'a' }), makeItem({ content: 'b' }), makeItem({ content: 'c' })]
    const out = repo.upsertBatch(items)
    expect(out.map((i) => i.content)).toEqual(['a', 'b', 'c'])
    expect(repo.list('alice')).toHaveLength(3)
  })

  it('get returns null for unknown id', () => {
    expect(repo.get('nope')).toBeNull()
  })

  describe('list filtering', () => {
    beforeEach(() => {
      repo.upsert(makeItem({ id: 'm1', userId: 'alice', type: MemoryType.FACT, content: 'a1' }))
      repo.upsert(
        makeItem({
          id: 'm2',
          userId: 'alice',
          type: MemoryType.GOAL,
          content: 'g1',
          status: MemoryLifecycleStatus.SUPPRESSED
        })
      )
      repo.upsert(
        makeItem({
          id: 'm3',
          userId: 'alice',
          type: MemoryType.FACT,
          content: 'e1',
          expiresAt: '2020-01-01T00:00:00Z',
          status: MemoryLifecycleStatus.EXPIRED
        })
      )
      repo.upsert(
        makeItem({
          id: 'm4',
          userId: 'bob',
          type: MemoryType.FACT,
          content: 'b1'
        })
      )
      repo.upsert(
        makeItem({
          id: 'm5',
          userId: 'alice',
          type: MemoryType.FACT,
          content: 'd1',
          status: MemoryLifecycleStatus.DELETED
        })
      )
    })

    it('default list returns only active (no deleted/suppressed/expired) for the user', () => {
      const ids = repo.list('alice').map((i) => i.id)
      expect(ids).toContain('m1')
      expect(ids).not.toContain('m2') // suppressed
      expect(ids).not.toContain('m3') // expired
      expect(ids).not.toContain('m5') // deleted
    })

    it('filters by type (still applies default status exclude)', () => {
      // m2 is a GOAL but SUPPRESSED -> default exclude drops it; m1/m3/m5 are FACTs.
      const ids = repo.list('alice', { types: [MemoryType.GOAL] }).map((i) => i.id)
      expect(ids).toEqual([])
      // FACTs for alice: m1 (active), m3 (expired-excluded), m5 (deleted-excluded) -> only m1
      const facts = repo.list('alice', { types: [MemoryType.FACT] }).map((i) => i.id)
      expect(facts).toEqual(['m1'])
    })

    it('includeSuppressed includes suppressed items', () => {
      const ids = repo.list('alice', { includeSuppressed: true }).map((i) => i.id)
      expect(ids).toContain('m2')
      expect(ids).not.toContain('m3') // still expired-excluded
      expect(ids).not.toContain('m5') // still deleted-excluded
    })

    it('onlyStatus returns exactly those statuses', () => {
      const ids = repo.list('alice', { onlyStatus: [MemoryLifecycleStatus.DELETED] }).map((i) => i.id)
      expect(ids).toEqual(['m5'])
    })

    it('isolates users', () => {
      const ids = repo.list('bob').map((i) => i.id)
      expect(ids).toEqual(['m4'])
    })
  })

  describe('delete', () => {
    it('soft delete transitions to DELETED and keeps the row', () => {
      const item = makeItem({ id: 'm1' })
      repo.upsert(item)
      expect(repo.delete('m1')).toBe(true)
      const got = repo.get('m1')
      expect(got!.status).toBe(MemoryLifecycleStatus.DELETED)
      // default list excludes deleted
      expect(repo.list('alice').map((i) => i.id)).not.toContain('m1')
    })

    it('soft delete is idempotent and returns false for unknown id', () => {
      expect(repo.delete('unknown')).toBe(false)
    })

    it('hard delete removes the row entirely', () => {
      const item = makeItem({ id: 'm1' })
      repo.upsert(item)
      expect(repo.delete('m1', { hard: true })).toBe(true)
      expect(repo.get('m1')).toBeNull()
    })
  })

  describe('chat log', () => {
    it('saves and loads recent chats in chronological order', () => {
      repo.saveChat('alice', 'user', 'hello', { threadId: 't1' })
      repo.saveChat('alice', 'assistant', 'hi', { threadId: 't1' })
      const chats = repo.loadRecentChats('alice')
      expect(chats).toHaveLength(2)
      expect(chats[0].role).toBe('user')
      expect(chats[1].role).toBe('assistant')
    })

    it('respects the limit, returning the most recent', () => {
      for (let i = 0; i < 5; i++) repo.saveChat('alice', 'user', `m${i}`)
      const chats = repo.loadRecentChats('alice', 2)
      expect(chats).toHaveLength(2)
      // most recent 2, chronological
      expect(chats.map((c) => c.content)).toEqual(['m3', 'm4'])
    })
  })

  describe('twin persistence', () => {
    it('saves and loads the digital twin json', () => {
      repo.saveTwin('alice', '{"user_id":"alice"}', '2026-06-23T00:00:00Z')
      const loaded = repo.loadTwin('alice')
      expect(loaded).not.toBeNull()
      expect(loaded![0]).toBe('{"user_id":"alice"}')
      expect(loaded![1]).toBe('2026-06-23T00:00:00Z')
    })

    it('overwrites the twin on re-save (upsert)', () => {
      repo.saveTwin('alice', '{"v":1}', '2026-06-23T00:00:00Z')
      repo.saveTwin('alice', '{"v":2}', '2026-06-23T01:00:00Z')
      const loaded = repo.loadTwin('alice')
      expect(loaded![0]).toBe('{"v":2}')
    })

    it('returns null for unknown user', () => {
      expect(repo.loadTwin('nobody')).toBeNull()
    })
  })

  describe('event log', () => {
    it('logs events and retrieves them with parsed payloads', () => {
      repo.logEvent('used_in_prompt', { recordId: 'm1', userId: 'alice', payload: { position: 0 } })
      repo.logEvent('upsert', { recordId: 'm2', userId: 'alice', payload: { k: 'v' } })
      const all = repo.recentEvents(undefined, { limit: 10 })
      expect(all).toHaveLength(2)
      expect(all[0].kind).toBe('upsert') // newest first
      expect(all[0].payload).toEqual({ k: 'v' })
    })

    it('filters by kind', () => {
      repo.logEvent('used_in_prompt', { recordId: 'm1' })
      repo.logEvent('upsert', { recordId: 'm2' })
      const only = repo.recentEvents('used_in_prompt')
      expect(only).toHaveLength(1)
      expect(only[0].kind).toBe('used_in_prompt')
    })
  })

  describe('v1 -> v2 migration', () => {
    it('promotes legacy metadata flags to canonical status on open', () => {
      // Insert a raw v1-style row directly (no status column semantics),
      // simulating an old DB, by writing via a fresh repo then forcing v1.
      const active = makeItem({ id: 'a1', metadata: {} })
      const deleted = makeItem({ id: 'a2', metadata: { __deleted__: true } })
      const suppressed = makeItem({ id: 'a3', metadata: { do_not_inject: true } })
      repo.upsert(active)
      repo.upsert(deleted)
      repo.upsert(suppressed)
      // Force schema_version back to 1 to simulate pre-migration state.
      repo.rawExec(
        `UPDATE memory SET schema_version = 1, status = 'active', status_history = '[]'`
      )
      // Run migration.
      const stats = repo.migrateV1ToV2()
      expect(stats.migratedCount).toBe(3)
      expect(stats.deletedCount).toBe(1)
      expect(stats.suppressedCount).toBe(1)
      const gotDeleted = repo.get('a2')
      const gotSuppressed = repo.get('a3')
      expect(gotDeleted!.status).toBe(MemoryLifecycleStatus.DELETED)
      expect(gotSuppressed!.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
    })
  })

  describe('B4: dreamJobStats without userId (global query must not throw)', () => {
    it('returns zeros for an empty queue without throwing (no dangling AND)', () => {
      expect(() => repo.dreamJobStats()).not.toThrow()
      const stats = repo.dreamJobStats()
      expect(stats.pending).toBe(0)
      expect(stats.completed).toBe(0)
      expect(stats.lastCompletedAt).toBeNull()
    })

    it('counts and reports lastCompletedAt globally (no userId)', () => {
      repo.enqueueDreamJob({ type: 'dream_refresh', userId: 'alice' })
      repo.enqueueDreamJob({ type: 'dream_refresh', userId: 'bob' })
      const jobs = repo.claimDueDreamJobs(5)
      for (const j of jobs) repo.completeDreamJob(j.id)
      const stats = repo.dreamJobStats() // 全局观测,无 userId
      expect(stats.completed).toBe(2)
      expect(stats.pending).toBe(0)
      expect(stats.lastCompletedAt).not.toBeNull()
    })

    it('still works scoped to a userId', () => {
      repo.enqueueDreamJob({ type: 'dream_refresh', userId: 'alice' })
      repo.enqueueDreamJob({ type: 'dream_refresh', userId: 'bob' })
      const jobs = repo.claimDueDreamJobs(5)
      for (const j of jobs) repo.completeDreamJob(j.id)
      const aliceStats = repo.dreamJobStats('alice')
      expect(aliceStats.completed).toBe(1)
    })
  })

  describe('B12: claimDueDreamJobs UPDATE status guard', () => {
    it('does not re-claim a job whose status drifted to running (multi-worker safety)', () => {
      const id = repo.enqueueDreamJob({ type: 'dream_refresh', userId: 'alice' })
      // 模拟另一 worker 已把它置 running(或崩溃恢复前)
      repo.rawExec(`UPDATE dream_job SET status='running', locked_at='2026-06-23T00:00:00Z', attempts=1 WHERE id=?`, [id])
      const claimed = repo.claimDueDreamJobs(5)
      expect(claimed.find((c) => c.id === id)).toBeUndefined() // 不再重取
    })
  })

  describe('B10: source_ids LIKE escaping (no wildcard false-positives)', () => {
    it('hasSourceId filter with ESCAPE: source id containing _ does not match other ids', () => {
      // 两条记忆,source ids 一个含 "_wild"(会被当通配符),一个含 "_wild_card"。
      // 若 LIKE 未转义,"%"_wild"%" 会同时匹配两者。加 ESCAPE 后只精确匹配。
      const exact = makeItem({ id: 'memA', userId: 'alice', content: 'a' })
      exact.sourceIds = ['src_exact_wild']
      const decoy = makeItem({ id: 'memB', userId: 'alice', content: 'b' })
      decoy.sourceIds = ['src_other']
      repo.upsert(exact)
      repo.upsert(decoy)
      const ids = repo.list('alice', { hasSourceId: 'src_exact_wild' }).map((i) => i.id)
      expect(ids).toEqual(['memA'])
      expect(ids).not.toContain('memB')
    })

    it('memoriesDerivedFromSource fallback path escapes wildcards in sourceId', () => {
      // 清空 memory_source_link 强制走 JSON LIKE 回退路径。
      repo.rawExec(`DELETE FROM memory_source_link`)
      const m = makeItem({ id: 'memC', userId: 'alice', content: 'c' })
      m.sourceIds = ['src_50_pct']
      repo.upsert(m)
      const derived = repo.memoriesDerivedFromSource('alice', 'src_50_pct')
      expect(derived.map((d) => d.id)).toEqual(['memC'])
    })
  })
})
