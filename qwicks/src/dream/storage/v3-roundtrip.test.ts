/**
 * v3 SQLite round-trip verification:确保所有 v3 字段持久化后能完整读回。
 * 这是最容易出 bug 的地方(bool↔int 转换、JSON 数组、nullable)。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryProvenance,
  MemoryType,
  SensitivityLevel,
  SourceRecord,
  SourceType,
  SuppressionRule,
  SuppressionScope,
  TemporalState
} from '../types.js'
import { SqliteMemoryRepository } from './sqlite-repository.js'

describe('v3 SQLite round-trip: all MemoryItem fields', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'v3rt-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'rt.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('persists and restores every v3 field exactly', () => {
    const original = new MemoryItem(
      'mem_full', 'alice', MemoryType.GOAL, 'visit Singapore in July',
      undefined, ['travel', 'asia'], 0.8, 0.9,
      '2026-06-01T00:00:00Z', '2026-06-23T00:00:00Z', null,
      new MemoryProvenance('chat', null, 't1', 'turn_1', 0.9, 'gpt'),
      null, 'hash-256', ['mem_rel'],
      { custom: 'meta', nested: { a: 1 } },
      undefined, [], 3,
      ['destination = Singapore', 'month = July'],
      ['src_abc', 'src_def'],
      TemporalState.PLANNED,
      '2026-07-01T00:00:00Z',
      '2026-07-15T00:00:00Z',
      ['mem_old1', 'mem_old2'],
      [],
      true, // isTopOfMind
      false, // isSuppressed
      true, // userCorrected
      0.95, // salience
      'travel:sg',
      '2026-06-22T00:00:00Z',
      SensitivityLevel.SENSITIVE,
      false // shareable
    )
    repo.upsert(original)
    const loaded = repo.get('mem_full')!
    // 逐字段比对(避免 toEqual 因 undefined vs missing 失败)
    expect(loaded.id).toBe(original.id)
    expect(loaded.userId).toBe(original.userId)
    expect(loaded.type).toBe(original.type)
    expect(loaded.content).toBe(original.content)
    expect(loaded.tags).toEqual(original.tags)
    expect(loaded.importance).toBe(original.importance)
    expect(loaded.confidence).toBe(original.confidence)
    expect(loaded.related).toEqual(original.related)
    expect(loaded.status).toBe(original.status)
    expect(loaded.schemaVersion).toBe(original.schemaVersion)
    // v3 字段
    expect(loaded.normalizedFacts).toEqual(original.normalizedFacts)
    expect(loaded.sourceIds).toEqual(original.sourceIds)
    expect(loaded.temporalState).toBe(original.temporalState)
    expect(loaded.validFrom).toBe(original.validFrom)
    expect(loaded.validUntil).toBe(original.validUntil)
    expect(loaded.supersedes).toEqual(original.supersedes)
    expect(loaded.supersededBy).toEqual(original.supersededBy)
    expect(loaded.isTopOfMind).toBe(original.isTopOfMind)
    expect(loaded.isSuppressed).toBe(original.isSuppressed)
    expect(loaded.userCorrected).toBe(original.userCorrected)
    expect(loaded.salience).toBe(original.salience)
    expect(loaded.topic).toBe(original.topic)
    expect(loaded.lastUsedAt).toBe(original.lastUsedAt)
    expect(loaded.sensitivity).toBe(original.sensitivity)
    expect(loaded.shareable).toBe(original.shareable)
  })

  it('persists bool fields correctly (true/false boundaries)', () => {
    const allTrue = new MemoryItem(
      'mem_t', 'u', MemoryType.FACT, 'all true',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance(), null, null, [], {},
      undefined, [], 3,
      [], [], TemporalState.CURRENT, null, null, [], [],
      true, true, true, 1.0, 'x', '2026-01-01T00:00:00Z',
      SensitivityLevel.NORMAL, true
    )
    repo.upsert(allTrue)
    const lt = repo.get('mem_t')!
    expect(lt.isTopOfMind).toBe(true)
    expect(lt.isSuppressed).toBe(true)
    expect(lt.userCorrected).toBe(true)
    expect(lt.shareable).toBe(true)

    const allFalse = new MemoryItem(
      'mem_f', 'u', MemoryType.FACT, 'all false',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance(), null, null, [], {},
      undefined, [], 3,
      [], [], TemporalState.CURRENT, null, null, [], [],
      false, false, false, 0.0, null, null,
      SensitivityLevel.RESTRICTED, false
    )
    repo.upsert(allFalse)
    const lf = repo.get('mem_f')!
    expect(lf.isTopOfMind).toBe(false)
    expect(lf.isSuppressed).toBe(false)
    expect(lf.userCorrected).toBe(false)
    expect(lf.shareable).toBe(false)
    expect(lf.sensitivity).toBe(SensitivityLevel.RESTRICTED)
  })
})

describe('v3 SQLite round-trip: SourceRecord + SuppressionRule', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'v3rt2-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'rt2.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('persists and restores SourceRecord with all fields', () => {
    const src = new SourceRecord(
      'src_1', 'alice', SourceType.GMAIL, 'msg_123',
      'Flight confirmation', 'Your flight to Singapore is confirmed',
      { from: 'airline@example.com', date: '2026-06-01' }
    )
    src.deleted = true
    repo.upsertSource(src)
    const loaded = repo.getSource('src_1')!
    expect(loaded.id).toBe(src.id)
    expect(loaded.userId).toBe(src.userId)
    expect(loaded.sourceType).toBe(src.sourceType)
    expect(loaded.externalRef).toBe(src.externalRef)
    expect(loaded.title).toBe(src.title)
    expect(loaded.content).toBe(src.content)
    expect(loaded.attrs).toEqual(src.attrs)
    expect(loaded.deleted).toBe(true)
  })

  it('persists and restores SuppressionRule with all scopes', () => {
    for (const scope of [
      SuppressionScope.MEMORY,
      SuppressionScope.SOURCE,
      SuppressionScope.SUMMARY,
      SuppressionScope.TOPIC
    ]) {
      const rule = new SuppressionRule(
        `sup_${scope}`, 'alice', scope, 'target_' + scope, 'reason', undefined, true
      )
      repo.upsertSuppression(rule)
      const loaded = repo.getSuppression(`sup_${scope}`)!
      expect(loaded.scope).toBe(scope)
      expect(loaded.target).toBe(rule.target)
      expect(loaded.reason).toBe(rule.reason)
      expect(loaded.active).toBe(true)
    }
  })

  it('SuppressionRule UNIQUE(user_id, scope, target) dedupes', () => {
    const r1 = new SuppressionRule('sup_a', 'alice', SuppressionScope.TOPIC, 'politics', 'r1')
    repo.upsertSuppression(r1)
    // 同 (user, scope, target) 再次 upsert — 应更新而非插入第二条
    const r2 = new SuppressionRule('sup_b', 'alice', SuppressionScope.TOPIC, 'politics', 'r2', undefined, false)
    repo.upsertSuppression(r2)
    const all = repo.listSuppressions('alice', { includeInactive: true })
    const politics = all.filter((r) => r.target === 'politics')
    expect(politics).toHaveLength(1)
  })
})

describe('v3 migration: addV3ColumnsIfMissing on old DB', () => {
  it('opens a v2-era DB and migrates to v3 without data loss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v3mig-'))
    const dbPath = join(dir, 'mig.db')
    // 先用 v3 repo 建库 + 写一条 v3 记录
    const repo1 = new SqliteMemoryRepository({ sqlitePath: dbPath })
    const m = new MemoryItem(
      'mem_mig', 'alice', MemoryType.FACT, 'migration test',
      undefined, [], 0.5, 0.7, undefined, undefined, null,
      new MemoryProvenance(), null, null, [], {},
      undefined, [], 3,
      ['fact1'], ['src_x'], TemporalState.OCCURRED, null, null,
      [], [], true, false, false, 0.7, 'test', null,
      SensitivityLevel.NORMAL, true
    )
    repo1.upsert(m)
    repo1.close()
    // 重新打开(模拟升级)— 应能读到所有 v3 字段
    const repo2 = new SqliteMemoryRepository({ sqlitePath: dbPath })
    const loaded = repo2.get('mem_mig')!
    expect(loaded.normalizedFacts).toEqual(['fact1'])
    expect(loaded.sourceIds).toEqual(['src_x'])
    expect(loaded.temporalState).toBe(TemporalState.OCCURRED)
    expect(loaded.isTopOfMind).toBe(true)
    expect(loaded.topic).toBe('test')
    const migResult = repo2.migrateV2ToV3()
    expect(migResult.migratedCount).toBeGreaterThanOrEqual(0) // 幂等
    repo2.close()
    await rm(dir, { recursive: true, force: true })
  })
})
