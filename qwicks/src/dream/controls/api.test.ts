import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryType } from '../types.js'
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
