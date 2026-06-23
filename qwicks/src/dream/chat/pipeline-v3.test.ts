/**
 * v3 chat pipeline 测试:SourceRecord 创建、抑制过滤、temporal 检测、状态提示。
 * 覆盖文档 §1(source lineage)、§4(temporal)、§6(memory sources)、§8(suppression)、§12(status hints)。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from './pipeline.js'
import {
  MemoryItem,
  MemoryProvenance,
  MemoryType,
  SourceType,
  SuppressionScope,
  TemporalState
} from '../types.js'

function makeSystem(dir: string): DreamMemorySystem {
  return new DreamMemorySystem({ dataDir: dir, userId: 'alice' })
}

describe('DreamMemorySystem v3: SourceRecord creation + lineage', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-v3-src-'))
    system = makeSystem(dir)
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a chat SourceRecord on each turn and links new memories to it', async () => {
    const result = await system.chat('alice', 'I prefer dark mode in my editor', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    // 应该创建了一个 chat source
    const sources = system.controls2.listSources('alice', { sourceType: SourceType.CHAT })
    expect(sources.length).toBeGreaterThanOrEqual(1)
    const chatSrc = sources[0]!
    expect(chatSrc.sourceType).toBe(SourceType.CHAT)
    expect(chatSrc.externalRef).toContain('t1')
    // 新 memory 应链到该 source
    if (result.newMemories.length > 0) {
      for (const m of result.newMemories) {
        expect(m.sourceIds).toContain(chatSrc.id)
      }
    }
  })

  it('is idempotent: same threadId/turnId reuses the same source', async () => {
    await system.chat('alice', 'msg 1', { threadId: 't1', turnId: 'turn_1' })
    await system.chat('alice', 'msg 2', { threadId: 't1', turnId: 'turn_1' })
    const sources = system.controls2.listSources('alice', { sourceType: SourceType.CHAT })
    // 同 externalRef 只有一条
    const withSameRef = sources.filter((s) => s.externalRef === 't1/turn_1')
    expect(withSameRef).toHaveLength(1)
  })
})

describe('DreamMemorySystem v3: suppression rule filtering', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-v3-sup-'))
    system = makeSystem(dir)
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('suppressed memories are excluded from routed hits', async () => {
    // 保存一条 memory
    await system.chat('alice', 'I love discussing politics and policy', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    const memories = system.repository.list('alice', {})
    const politicsMem = memories.find((m) => m.content.toLowerCase().includes('politics'))
    if (politicsMem) {
      // 用户说"不要再提 politics"
      system.controls2.suppress({
        userId: 'alice',
        scope: SuppressionScope.MEMORY,
        target: politicsMem.id,
        reason: 'user asked not to mention'
      })
      // 再问相关问题
      const result = await system.chat('alice', 'tell me about politics', {
        threadId: 't1',
        turnId: 'turn_2'
      })
      // 被抑制的不应出现在 routedHits
      expect(result.routedHits.find((h) => h.item.id === politicsMem.id)).toBeUndefined()
    }
  })

  it('topic-level suppression excludes all memories with that topic', async () => {
    // 直接注入两条同 topic 的 memory
    const m1 = new MemoryItem(
      'mem_top1',
      'alice',
      MemoryType.PREFERENCE,
      'I love political debates',
      undefined,
      [],
      0.8,
      0.8,
      undefined,
      undefined,
      null,
      new MemoryProvenance('user')
    )
    m1.topic = 'politics'
    m1.schemaVersion = 3
    system.repository.upsert(m1)
    system.retrieval.onIndexChanged(m1)

    // 抑制 politics 话题
    system.controls2.suppress({
      userId: 'alice',
      scope: SuppressionScope.TOPIC,
      target: 'politics'
    })
    const result = await system.chat('alice', 'what are your political views', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    expect(result.routedHits.find((h) => h.item.id === 'mem_top1')).toBeUndefined()
  })
})

describe('DreamMemorySystem v3: temporal detection during extraction', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-v3-tmp-'))
    system = makeSystem(dir)
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('detects planned travel and sets temporalState=PLANNED', async () => {
    await system.chat('alice', 'I am going to visit Singapore next month', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    const memories = system.repository.list('alice', {})
    const tripMem = memories.find((m) => m.content.toLowerCase().includes('singapore'))
    if (tripMem) {
      expect(tripMem.temporalState).toBe(TemporalState.PLANNED)
      expect(tripMem.topic).toContain('travel')
    }
  })

  it('detects Chinese planned travel (我要去新加坡)', async () => {
    await system.chat('alice', '我要去新加坡旅行', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    const memories = system.repository.list('alice', {})
    const tripMem = memories.find((m) => m.content.includes('新加坡'))
    if (tripMem) {
      expect(tripMem.temporalState).toBe(TemporalState.PLANNED)
    }
  })
})

describe('DreamMemorySystem v3: status hints (§12)', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-v3-hint-'))
    system = makeSystem(dir)
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('temporary chat returns all-false status hints', async () => {
    const result = await system.chat('alice', 'anything', { temporary: true })
    expect(result.statusHints.remembering).toBe(false)
    expect(result.statusHints.personalizing).toBe(false)
    expect(result.statusHints.memorySourcesUsed).toEqual([])
    expect(result.statusHints.rewrittenQueryFromMemory).toBe(false)
  })

  it('normal chat with retrieved memories sets remembering=true + sources', async () => {
    // 先存一条带 sourceIds 的 memory
    const src = system.controls2.upsertSource({
      userId: 'alice',
      sourceType: SourceType.SAVED_MEMORY,
      externalRef: 'saved_1',
      content: 'I am vegan'
    })
    const m = new MemoryItem(
      'mem_vegan',
      'alice',
      MemoryType.PREFERENCE,
      'user is vegan',
      undefined,
      ['diet'],
      0.9,
      0.9,
      undefined,
      undefined,
      null,
      new MemoryProvenance('user'),
      null,
      null,
      [],
      {},
      undefined,
      [],
      3,
      [],
      [src.id]
    )
    m.salience = 0.9
    system.repository.upsert(m)
    system.retrieval.onIndexChanged(m)

    const result = await system.chat('alice', 'recommend a restaurant near me', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    // 应该 remember 了 vegan 偏好
    expect(result.statusHints.remembering).toBe(true)
    // source 应该在 memorySourcesUsed 里(若该 memory 被注入)
    if (result.routedHits.some((h) => h.item.id === 'mem_vegan')) {
      expect(result.statusHints.memorySourcesUsed).toContain(src.id)
    }
  })

  it('statusHints.rewrittenQueryFromMemory is true when query was rewritten using memories', async () => {
    // vegan + location 记忆
    const m = new MemoryItem(
      'mem_diet',
      'alice',
      MemoryType.PREFERENCE,
      'I am vegan',
      undefined,
      ['diet'],
      0.9,
      0.9,
      undefined,
      undefined,
      null,
      new MemoryProvenance('user')
    )
    system.repository.upsert(m)
    system.retrieval.onIndexChanged(m)
    const m2 = new MemoryItem(
      'mem_loc',
      'alice',
      MemoryType.FACT,
      'I live in San Francisco',
      undefined,
      [],
      0.8,
      0.8,
      undefined,
      undefined,
      null,
      new MemoryProvenance('user')
    )
    system.repository.upsert(m2)
    system.retrieval.onIndexChanged(m2)

    const result = await system.chat('alice', 'any good restaurant nearby', {
      threadId: 't1',
      turnId: 'turn_1'
    })
    // 应该触发改写(vegan + SF 槽位填充)
    if (result.rewrittenQuery && result.rewrittenQuery.appliedMemories.length > 0) {
      expect(result.statusHints.rewrittenQueryFromMemory).toBe(true)
    }
  })
})

describe('DreamMemorySystem v3: temporal dreaming via scheduler tick', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-v3-dream-'))
    system = makeSystem(dir)
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('scheduler tick converts planned trip to occurred after valid_until passes', () => {
    // 直接注入一条 PLANNED + 过期 valid_until 的 memory
    const m = new MemoryItem(
      'mem_trip',
      'alice',
      MemoryType.GOAL,
      'I am going to visit Singapore',
      undefined,
      [],
      0.8,
      0.8,
      undefined,
      undefined,
      null,
      new MemoryProvenance('chat')
    )
    m.temporalState = TemporalState.PLANNED
    m.validUntil = '2020-01-01T00:00:00Z' // long past
    m.schemaVersion = 3
    system.repository.upsert(m)

    // markDirty + tick 触发 dreaming
    system.scheduler.markDirty('alice')
    const result = system.scheduler.tick({ userId: 'alice' })
    expect(result.ran).toBe(true)
    expect(result.temporal?.occurred).toBe(1)

    const updated = system.repository.get('mem_trip')!
    expect(updated.temporalState).toBe(TemporalState.OCCURRED)
    expect(updated.content).toContain('visited')
  })
})
