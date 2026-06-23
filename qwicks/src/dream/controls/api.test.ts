import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryType,
  SourceType,
  SuppressionScope,
  TemporalState
} from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { MemoryControls } from './api.js'

describe('MemoryControls (list/get/edit/delete/opt-out/export/purge/suppress)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-ctrl-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('listMemories filters by type/scope and supports search', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'postgres replication guide' })
    controls.upsertDirect({ id: 'b', userId: 'alice', type: MemoryType.PREFERENCE, content: '偏好简洁回答' })
    const all = controls.listMemories('alice')
    expect(all).toHaveLength(2)
    const prefs = controls.listMemories('alice', { types: [MemoryType.PREFERENCE] })
    expect(prefs.map((m) => m.id)).toEqual(['b'])
    const search = controls.listMemories('alice', { search: 'postgres' })
    expect(search.map((m) => m.id)).toEqual(['a'])
  })

  it('getMemory returns the item or null', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'x' })
    expect(controls.getMemory('a')?.content).toBe('x')
    expect(controls.getMemory('missing')).toBeNull()
  })

  it('editMemory updates content/importance/tags and records edited_at', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'v1', importance: 0.5 })
    const edited = controls.editMemory('a', { content: 'v2', importance: 0.9, tags: ['new'] })!
    expect(edited.content).toBe('v2')
    expect(edited.importance).toBe(0.9)
    expect(edited.tags).toEqual(['new'])
    expect(edited.metadata.edited_at).toBeTruthy()
  })

  it('editMemory clamps importance to [0,1]', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'x', importance: 0.5 })
    expect(controls.editMemory('a', { importance: 1.5 })!.importance).toBe(1)
    expect(controls.editMemory('a', { importance: -0.2 })!.importance).toBe(0)
  })

  it('deleteMemory soft-deletes by default and hard-deletes with hard:true', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'x' })
    expect(controls.deleteMemory('a')).toBe(true)
    // soft delete: item still present but status DELETED
    expect(controls.getMemory('a')?.status).toBe('deleted')
    expect(controls.deleteMemory('a', { hard: true })).toBe(true)
    expect(controls.getMemory('a')).toBeNull()
  })

  it('suppress ("Don\'t mention this again") transitions to SUPPRESSED, not deleted', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'a topic' })
    controls.suppressMemory('a')
    const item = controls.getMemory('a')!
    expect(item.status).toBe('suppressed')
    expect(item.metadata.do_not_inject).toBe(true)
    // still retrievable if includeSuppressed, but excluded by default
    expect(controls.listMemories('alice')).toHaveLength(0)
    expect(repo.list('alice', { includeSuppressed: true })).toHaveLength(1)
  })

  it('opt-out marks the user opted-out; opt-in clears it', () => {
    expect(controls.isOptedOut('alice')).toBe(false)
    controls.optOut('alice')
    expect(controls.isOptedOut('alice')).toBe(true)
    controls.optIn('alice')
    expect(controls.isOptedOut('alice')).toBe(false)
  })

  it('export returns the full user data (memories + chats + twin)', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'x' })
    repo.saveChat('alice', 'user', 'hello')
    const exported = controls.export('alice')
    expect(exported.userId).toBe('alice')
    expect(exported.memories.length).toBeGreaterThan(0)
    expect(exported.chats.length).toBeGreaterThan(0)
  })

  it('purge hard-deletes all user memories', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'x' })
    controls.upsertDirect({ id: 'b', userId: 'alice', type: MemoryType.FACT, content: 'y' })
    const n = controls.purge('alice')
    expect(n).toBe(2)
    expect(controls.listMemories('alice', { includeDeleted: true })).toHaveLength(0)
  })
})

describe('MemoryControls — version history (edit snapshots + restore by date)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-ver-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db'), nowIso: () => '2026-06-01T00:00:00Z' })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('records a version snapshot on each edit and lists history', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'v1', importance: 0.5 })
    controls.editMemory('a', { content: 'v2' })
    controls.editMemory('a', { content: 'v3' })
    const history = controls.versionHistory('a')
    expect(history.length).toBeGreaterThanOrEqual(2)
    // snapshots store the BEFORE-edit state, newest-first: [v2, v1]
    expect(history[0]!.content).toBe('v2')
    expect(history[1]!.content).toBe('v1')
  })

  it('restoreVersion rolls back content to a prior snapshot', () => {
    controls.upsertDirect({ id: 'a', userId: 'alice', type: MemoryType.FACT, content: 'v1', importance: 0.5 })
    controls.editMemory('a', { content: 'v2' })
    const history = controls.versionHistory('a')
    const restored = controls.restoreVersion('a', history[history.length - 1]!.versionId)!
    expect(restored.content).toBe('v1')
  })
})

describe('MemoryControls v3: SourceRecord CRUD + lineage', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-src-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('upsertSource is idempotent by (userId, sourceType, externalRef)', () => {
    const a = controls.upsertSource({
      userId: 'alice',
      sourceType: SourceType.CHAT,
      externalRef: 'thread_t1/turn_3',
      title: 'where to eat',
      content: 'I am vegan'
    })
    const b = controls.upsertSource({
      userId: 'alice',
      sourceType: SourceType.CHAT,
      externalRef: 'thread_t1/turn_3',
      title: 'updated title',
      content: 'I am vegan'
    })
    expect(b.id).toBe(a.id) // 复用同一 id
    expect(b.title).toBe('updated title')
    expect(controls.listSources('alice')).toHaveLength(1)
  })

  it('lists sources filtered by type and excludes soft-deleted by default', () => {
    controls.upsertSource({ userId: 'alice', sourceType: SourceType.CHAT, externalRef: 'c1' })
    controls.upsertSource({ userId: 'alice', sourceType: SourceType.FILE, externalRef: 'f1' })
    controls.upsertSource({ userId: 'alice', sourceType: SourceType.GMAIL, externalRef: 'g1' })
    const gmail = controls.listSources('alice', { sourceType: SourceType.GMAIL })
    expect(gmail).toHaveLength(1)
    expect(gmail[0]!.sourceType).toBe(SourceType.GMAIL)
    controls.deleteSource(gmail[0]!.id)
    expect(controls.listSources('alice', { sourceType: SourceType.GMAIL })).toHaveLength(0)
    expect(controls.listSources('alice', { sourceType: SourceType.GMAIL, includeDeleted: true })).toHaveLength(1)
  })

  it('memoriesDerivedFromSource traces lineage via source_ids', () => {
    const src = controls.upsertSource({
      userId: 'alice',
      sourceType: SourceType.CHAT,
      externalRef: 't1/turn_1',
      content: 'I live in SF'
    })
    const m = new MemoryItem(
      'mem_lineage1',
      'alice',
      MemoryType.FACT,
      'user lives in SF',
      undefined,
      [],
      0.5,
      0.7,
      undefined,
      undefined,
      null,
      new MemoryProvenance('chat'),
      null,
      null,
      [],
      {},
      MemoryLifecycleStatus.ACTIVE,
      [],
      3,
      [],
      [src.id] // sourceIds
    )
    repo.upsert(m)
    const derived = controls.memoriesDerivedFromSource('alice', src.id)
    expect(derived.map((x) => x.id)).toContain('mem_lineage1')
  })
})

describe('MemoryControls v3: cascade delete (deletion lineage)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-cascade-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('deleteSourceAndDerived removes source + all derived inferred memories', () => {
    const src = controls.upsertSource({
      userId: 'alice',
      sourceType: SourceType.FILE,
      externalRef: 'doc_notes.md'
    })
    // 3 inferred memories from this source
    for (let i = 0; i < 3; i++) {
      repo.upsert(
        new MemoryItem(
          `mem_cascade_${i}`,
          'alice',
          MemoryType.FACT,
          `fact ${i} from notes`,
          undefined,
          [],
          0.5,
          0.7,
          undefined,
          undefined,
          null,
          new MemoryProvenance('file'),
          null,
          null,
          [],
          {},
          MemoryLifecycleStatus.ACTIVE,
          [],
          3,
          [],
          [src.id]
        )
      )
    }
    // 1 unrelated memory (different source)
    repo.upsert(
      new MemoryItem(
        'mem_unrelated',
        'alice',
        MemoryType.FACT,
        'unrelated fact',
        undefined,
        [],
        0.5,
        0.7,
        undefined,
        undefined,
        null,
        new MemoryProvenance('user'),
        null,
        null,
        [],
        {},
        MemoryLifecycleStatus.ACTIVE,
        [],
        3,
        [],
        ['src_other']
      )
    )
    const result = controls.deleteSourceAndDerived(src.id, { hard: true })
    expect(result.sourceDeleted).toBe(true)
    expect(result.derivedDeleted).toBe(3)
    // unrelated memory survives
    expect(repo.get('mem_unrelated')).not.toBeNull()
    // derived memories gone
    for (let i = 0; i < 3; i++) {
      expect(repo.get(`mem_cascade_${i}`)).toBeNull()
    }
  })

  it('deleteSourceAndDerived returns empty result for missing source', () => {
    const result = controls.deleteSourceAndDerived('src_nonexistent')
    expect(result.sourceDeleted).toBe(false)
    expect(result.derivedDeleted).toBe(0)
  })
})

describe('MemoryControls v3: SuppressionRule (Don\'t mention this again)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-sup-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('suppress creates an active rule; unsuppress deactivates; delete removes', () => {
    controls.suppress({
      userId: 'alice',
      scope: SuppressionScope.TOPIC,
      target: 'politics',
      reason: 'user asked not to mention'
    })
    expect(controls.isSuppressed('alice', SuppressionScope.TOPIC, 'politics')).toBe(true)
    expect(controls.listSuppressions('alice')).toHaveLength(1)
    // unsuppress keeps the record but deactivates
    controls.unsuppress('alice', SuppressionScope.TOPIC, 'politics')
    expect(controls.isSuppressed('alice', SuppressionScope.TOPIC, 'politics')).toBe(false)
    expect(controls.listSuppressions('alice')).toHaveLength(0) // active only
    expect(controls.listSuppressions('alice', { includeInactive: true })).toHaveLength(1)
  })

  it('suppress is idempotent (same scope+target reuses rule)', () => {
    controls.suppress({ userId: 'alice', scope: SuppressionScope.MEMORY, target: 'mem_x1' })
    controls.suppress({ userId: 'alice', scope: SuppressionScope.MEMORY, target: 'mem_x1' })
    expect(controls.listSuppressions('alice')).toHaveLength(1)
  })

  it('suppress MEMORY scope syncs isSuppressed flag on the memory', () => {
    controls.upsertDirect({ id: 'mem_s1', userId: 'alice', type: MemoryType.FACT, content: 'sensitive topic' })
    expect(repo.get('mem_s1')!.isSuppressed).toBe(false)
    controls.suppress({ userId: 'alice', scope: SuppressionScope.MEMORY, target: 'mem_s1' })
    expect(repo.get('mem_s1')!.isSuppressed).toBe(true)
    controls.unsuppress('alice', SuppressionScope.MEMORY, 'mem_s1')
    expect(repo.get('mem_s1')!.isSuppressed).toBe(false)
  })

  it('deleteSuppression physically removes the rule (≠ unsuppress)', () => {
    controls.suppress({ userId: 'alice', scope: SuppressionScope.SUMMARY, target: 'summary片段1' })
    const rule = controls.listSuppressions('alice')[0]!
    expect(controls.deleteSuppression(rule.id)).toBe(true)
    expect(controls.listSuppressions('alice', { includeInactive: true })).toHaveLength(0)
  })
})

describe('MemoryControls v3: temporal transitions', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-tmp-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('markOccurred converts planned trip to historical fact', () => {
    controls.upsertDirect({ id: 'mem_trip', userId: 'alice', type: MemoryType.GOAL, content: 'I will visit Singapore' })
    const item = repo.get('mem_trip')!
    item.temporalState = TemporalState.PLANNED
    item.validUntil = '2026-07-15T00:00:00Z'
    repo.upsert(item)

    const occurred = controls.markOccurred('mem_trip', 'I visited Singapore in July 2026', {
      reason: 'trip_completed'
    })!
    expect(occurred.temporalState).toBe(TemporalState.OCCURRED)
    expect(occurred.content).toBe('I visited Singapore in July 2026')
    expect(occurred.validUntil).toBe('2026-07-15T00:00:00Z') // preserved as history
    // persisted
    expect(repo.get('mem_trip')!.temporalState).toBe(TemporalState.OCCURRED)
  })

  it('markOccurred returns null for missing memory', () => {
    expect(controls.markOccurred('mem_missing', 'x')).toBeNull()
  })
})

describe('MemoryControls v3: disableReferenceChatHistory', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let controls: MemoryControls
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-dis-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
    controls = new MemoryControls({ repository: repo })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('removes chat-inferred memories but keeps saved + chat_log', () => {
    // chat-inferred
    repo.upsert(
      new MemoryItem(
        'mem_inf1',
        'alice',
        MemoryType.FACT,
        'inferred from chat',
        undefined,
        [],
        0.5,
        0.7,
        undefined,
        undefined,
        null,
        new MemoryProvenance('chat'),
        null,
        null,
        [],
        {},
        MemoryLifecycleStatus.ACTIVE,
        [],
        3
      )
    )
    // user-saved
    repo.upsert(
      new MemoryItem(
        'mem_saved1',
        'alice',
        MemoryType.PREFERENCE,
        'user saved preference',
        undefined,
        [],
        0.5,
        0.7,
        undefined,
        undefined,
        null,
        new MemoryProvenance('user'),
        null,
        null,
        [],
        {},
        MemoryLifecycleStatus.ACTIVE,
        [],
        3
      )
    )
    // chat log
    repo.saveChat('alice', 'user', 'hello world')

    const result = controls.disableReferenceChatHistory('alice')
    expect(result.removedInferred).toBe(1)
    expect(result.removedIds).toContain('mem_inf1')
    // saved memory survives
    expect(repo.get('mem_saved1')).not.toBeNull()
    // chat log survives (document: only delete inferred memories, not raw chat)
    expect(repo.loadRecentChats('alice', 10)).toHaveLength(1)
  })
})
