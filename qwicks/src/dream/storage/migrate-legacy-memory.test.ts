/**
 * Batch A (spec §1): migrateLegacyMemory — read FileMemoryStore JSON -> Dream SQLite.
 * Idempotent (fingerprint dedup), non-destructive (old JSON untouched), skip-bad-rows.
 *
 * NOTE: this test runs under qwicks/ vitest which requires Node 22 (see .nvmrc).
 * Logic is verified via tsc here; runtime verification happens in the Node-22 CI/dev env.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRecord } from '../../contracts/memory.js'
import { MemoryScope, MemoryLifecycleStatus } from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'
import { migrateLegacyMemory } from './migrate-legacy-memory.js'

function makeRecord(overrides: Partial<Record<string, unknown>> = {}): MemoryRecord {
  return MemoryRecord.parse({
    id: 'mem_1',
    content: 'user prefers concise answers',
    scope: 'workspace',
    tags: ['concise'],
    confidence: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })
}

async function seedFileStore(dir: string, records: MemoryRecord[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  for (const r of records) {
    await writeFile(join(dir, `${r.id}.json`), JSON.stringify(r), 'utf8')
  }
}

describe('migrateLegacyMemory', () => {
  let fileDir: string
  let sqlitePath: string
  let repo: SqliteMemoryRepository

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'dream-migrate-'))
    fileDir = join(root, 'memory')
    sqlitePath = join(root, 'dream.db')
    repo = new SqliteMemoryRepository({ sqlitePath })
  })
  afterEach(async () => {
    repo.close()
    await rm(join(sqlitePath, '..'), { recursive: true, force: true })
  })

  it('migrates N records into SQLite with matching content', async () => {
    const records = [
      makeRecord({ id: 'mem_1', content: 'prefers concise answers', scope: 'user' }),
      makeRecord({ id: 'mem_2', content: 'works on project X', scope: 'workspace', tags: ['project'] }),
      makeRecord({ id: 'mem_3', content: 'deadline Friday', scope: 'project', workspace: '/repo', project: '/repo' })
    ]
    await seedFileStore(fileDir, records)

    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report.migratedCount).toBe(3)
    expect(report.failedCount).toBe(0)
    const items = repo.list('default')
    expect(items).toHaveLength(3)
    expect(items.some((i) => i.content === 'prefers concise answers')).toBe(true)
  })

  it('is idempotent — running twice does not duplicate', async () => {
    await seedFileStore(fileDir, [makeRecord({ id: 'mem_1' }), makeRecord({ id: 'mem_2' })])

    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const report2 = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report2.migratedCount).toBe(0)
    expect(report2.skippedCount).toBe(2)
    expect(repo.list('default')).toHaveLength(2)
  })

  it('skips corrupted JSON rows and reports failedCount', async () => {
    await mkdir(fileDir, { recursive: true })
    await writeFile(join(fileDir, 'mem_good.json'), JSON.stringify(makeRecord({ id: 'mem_good' })), 'utf8')
    await writeFile(join(fileDir, 'mem_bad.json'), '{not valid json', 'utf8')

    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })

    expect(report.migratedCount).toBe(1)
    expect(report.failedCount).toBe(1)
    expect(repo.list('default')).toHaveLength(1)
  })

  it('handles empty directory — migratedCount 0, no throw', async () => {
    await mkdir(fileDir, { recursive: true })
    const report = await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    expect(report.migratedCount).toBe(0)
    expect(report.failedCount).toBe(0)
  })

  it('maps qwicks scope -> dream scope (user->user, workspace->global, project->project)', async () => {
    await seedFileStore(fileDir, [
      makeRecord({ id: 'u1', scope: 'user', content: 'name is Alice' }),
      makeRecord({ id: 'w1', scope: 'workspace', content: 'uses dark theme' }),
      makeRecord({ id: 'p1', scope: 'project', content: 'builds app', workspace: '/repo', project: '/repo' })
    ])
    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const byId = new Map(repo.list('default').map((i) => [i.id, i]))
    expect(byId.get('u1')?.scope).toBe(MemoryScope.USER)
    expect(byId.get('w1')?.scope).toBe(MemoryScope.GLOBAL)
    expect(byId.get('p1')?.scope).toBe(MemoryScope.PROJECT)
  })

  it('preserves disabled/deleted state as lifecycle status', async () => {
    await seedFileStore(fileDir, [
      makeRecord({ id: 'd1', disabledAt: '2026-02-01T00:00:00.000Z' }),
      makeRecord({ id: 'x1', deletedAt: '2026-02-01T00:00:00.000Z' })
    ])
    await migrateLegacyMemory({ fileDir, repository: repo, userId: 'default' })
    const affected = repo.list('default', {
      includeSuppressed: true,
      onlyStatus: [MemoryLifecycleStatus.SUPPRESSED, MemoryLifecycleStatus.DELETED]
    })
    const byId = new Map(affected.map((i) => [i.id, i]))
    expect(byId.get('d1')?.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
    expect(byId.get('x1')?.status).toBe(MemoryLifecycleStatus.DELETED)
  })
})
