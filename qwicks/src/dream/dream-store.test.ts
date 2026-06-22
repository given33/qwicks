import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemoryStore } from './dream-store.js'
import { SqliteMemoryRepository } from './storage/sqlite-repository.js'

describe('DreamMemoryStore (qwicks MemoryStore adapter)', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  let store: DreamMemoryStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-adapter-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'memory.db') })
    store = new DreamMemoryStore({
      repository: repo,
      config: { enabled: true },
      sqlitePath: join(dir, 'memory.db')
    })
  })
  afterEach(async () => {
    try {
      repo.close()
    } catch {
      // store.close() in the close-leak test already closed the handle.
    }
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a memory and round-trips it as a qwicks MemoryRecord', async () => {
    const record = await store.create({
      content: 'I prefer concise answers',
      scope: 'user',
      tags: ['style'],
      confidence: 0.9
    })
    expect(record.id).toMatch(/^mem_/)
    expect(record.content).toBe('I prefer concise answers')
    expect(record.scope).toBe('user')
    expect(record.tags).toEqual(['style'])
    expect(record.confidence).toBe(0.9)
    expect(record.createdAt).not.toBe('')
  })

  it('persists to the repository (visible via list)', async () => {
    const created = await store.create({ content: 'remember this', scope: 'workspace' })
    const all = await store.list()
    expect(all.map((r) => r.id)).toContain(created.id)
  })

  it('updates content/tags/confidence', async () => {
    const created = await store.create({ content: 'alpha beta', tags: ['a'] })
    const updated = await store.update(created.id, {
      content: 'gamma delta',
      tags: ['b'],
      confidence: 0.4
    })
    expect(updated.content).toBe('gamma delta')
    expect(updated.tags).toEqual(['b'])
    expect(updated.confidence).toBe(0.4)
  })

  it('disabled:true transitions to SUPPRESSED so the memory is NOT retrieved (regression: must match FileMemoryStore)', async () => {
    const created = await store.create({ content: 'postgres replication lag', scope: 'workspace' })
    // before disable it is retrievable
    const before = await store.retrieve({ query: 'postgres replication', limit: 5 })
    expect(before.some((r) => r.id === created.id)).toBe(true)

    const disabled = await store.update(created.id, { disabled: true })
    expect(disabled.disabledAt).toBeTruthy()
    // rich status must reflect suppression (the real contract)
    expect(store.getRich(created.id)!.status).toBe('suppressed')
    // disabled records must be excluded from retrieve by default
    const after = await store.retrieve({ query: 'postgres replication', limit: 5 })
    expect(after.some((r) => r.id === created.id)).toBe(false)
  })

  it('disabled:false re-enables a suppressed memory back to ACTIVE', async () => {
    const created = await store.create({ content: 'redis cache config', scope: 'workspace' })
    await store.update(created.id, { disabled: true })
    expect(store.getRich(created.id)!.status).toBe('suppressed')

    const reEnabled = await store.update(created.id, { disabled: false })
    expect(reEnabled.disabledAt).toBeUndefined()
    expect(store.getRich(created.id)!.status).toBe('active')
    const hits = await store.retrieve({ query: 'redis cache', limit: 5 })
    expect(hits.some((r) => r.id === created.id)).toBe(true)
  })

  it('soft-deletes (tombstone) and excludes from list by default', async () => {
    const created = await store.create({ content: 'temp' })
    await store.delete(created.id)
    const visible = await store.list()
    expect(visible.map((r) => r.id)).not.toContain(created.id)
    const withDeleted = await store.list({ includeDeleted: true })
    expect(withDeleted.map((r) => r.id)).toContain(created.id)
  })

  it('retrieve returns user-scope memories (identity facts) regardless of keyword overlap', async () => {
    await store.create({ content: 'My name is Alice', scope: 'user' })
    // query shares no keywords with the content
    const hits = await store.retrieve({ query: 'who am I', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((r) => r.content === 'My name is Alice')).toBe(true)
  })

  it('retrieve is keyword-scored for workspace/project scope', async () => {
    await store.create({ content: 'the postgres replication setup', scope: 'workspace' })
    await store.create({ content: 'a recipe for pancakes', scope: 'workspace' })
    const hits = await store.retrieve({ query: 'postgres replication', limit: 5 })
    expect(hits[0].content).toContain('postgres')
  })

  it('retrieve returns empty when disabled', async () => {
    await store.create({ content: 'x', scope: 'workspace' })
    const disabledStore = new DreamMemoryStore({ repository: repo, config: { enabled: false } })
    const hits = await disabledStore.retrieve({ query: 'x', limit: 5 })
    expect(hits).toEqual([])
  })

  it('diagnostics reports counts and rootDir', async () => {
    await store.create({ content: 'a', scope: 'workspace' })
    await store.create({ content: 'b', scope: 'workspace' })
    const diag = await store.diagnostics()
    expect(diag.enabled).toBe(true)
    expect(diag.activeCount).toBe(2)
    expect(diag.tombstoneCount).toBe(0)
    expect(diag.rootDir).toContain('memory.db')
  })

  it('setLastInjected is reflected in diagnostics', async () => {
    const created = await store.create({ content: 'x', scope: 'workspace' })
    store.setLastInjected([created.id])
    const diag = await store.diagnostics()
    expect(diag.lastInjectedIds).toEqual([created.id])
  })

  it('surfaces the Dream rich fields (type/importance/status) alongside flat fields', async () => {
    const created = await store.create({
      content: 'I am a vegetarian',
      scope: 'user',
      tags: ['diet'],
      confidence: 0.9
    })
    const rich = store.getRich(created.id)
    expect(rich).not.toBeNull()
    expect(rich!.type).toBe('preference') // "prefer/preference" heuristic default
    expect(rich!.status).toBe('active')
  })

  it('close() releases the SQLite handle so the db file can be deleted (regression: Windows file-lock leak)', async () => {
    await store.create({ content: 'persisted then closed', scope: 'workspace' })
    store.close()
    // After close, the SQLite file handle must be released. On Windows an open
    // better-sqlite3 handle holds an exclusive lock; rm would throw EBUSY.
    // This must not throw.
    await expect(rm(join(dir, 'memory.db'), { force: true })).resolves.toBeUndefined()
  })
})
