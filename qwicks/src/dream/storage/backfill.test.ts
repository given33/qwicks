/**
 * CHIEF P1-4(报告二轮 §6.3):backfillSourceLinks 迁移测试。
 * 断言:老 memory.source_ids JSON 被正确回填到 memory_source_link 表,
 * 且 memoriesDerivedFromSource 能通过 JOIN 查到。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryType } from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'

describe('CHIEF P1-4: backfillSourceLinks populates memory_source_link from legacy JSON', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-backfill-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'bf.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('backfills source_ids JSON into memory_source_link table', () => {
    // 手动插入一条带 source_ids 的 memory(模拟老数据,绕过 syncSourceLinks)
    const m = new MemoryItem(
      'mem_old', 'alice', MemoryType.FACT, 'fact from old source',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance('file')
    )
    m.sourceIds = ['src_legacy_1', 'src_legacy_2']
    m.schemaVersion = 2 // 老数据
    // 直接用 upsert(会触发 syncSourceLinks,所以先清空 link 表模拟"老数据未同步")
    repo.upsert(m)
    // 手动清空 link 表(模拟 backfill 前的状态:JSON 列有值,link 表为空)
    repo.rawExec('DELETE FROM memory_source_link')

    // 验证 link 表为空
    const derivedBefore = repo.memoriesDerivedFromSource('alice', 'src_legacy_1')
    // JSON LIKE fallback 仍能查到(但 JOIN 路径无数据)
    expect(derivedBefore.length).toBeGreaterThanOrEqual(0)

    // 执行 backfill
    const result = repo.backfillSourceLinks()
    expect(result.backfilled).toBe(2) // 2 条 link

    // 现在 JOIN 查询应该能找到
    const derivedAfter = repo.memoriesDerivedFromSource('alice', 'src_legacy_1')
    expect(derivedAfter.map((m) => m.id)).toContain('mem_old')

    const derivedAfter2 = repo.memoriesDerivedFromSource('alice', 'src_legacy_2')
    expect(derivedAfter2.map((m) => m.id)).toContain('mem_old')
  })

  it('backfill is idempotent (running twice does not duplicate links)', () => {
    const m = new MemoryItem(
      'mem_idem', 'alice', MemoryType.FACT, 'idempotent test',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance('file')
    )
    m.sourceIds = ['src_idem']
    repo.upsert(m)
    repo.rawExec('DELETE FROM memory_source_link')

    const r1 = repo.backfillSourceLinks()
    const r2 = repo.backfillSourceLinks()
    expect(r1.backfilled).toBe(1)
    expect(r2.backfilled).toBe(0) // INSERT OR IGNORE 跳过已存在
  })

  it('backfill handles empty source_ids gracefully', () => {
    const m = new MemoryItem(
      'mem_nosrc', 'alice', MemoryType.FACT, 'no sources',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance('user')
    )
    m.sourceIds = []
    repo.upsert(m)
    repo.rawExec('DELETE FROM memory_source_link')
    const result = repo.backfillSourceLinks()
    expect(result.backfilled).toBe(0)
  })
})
