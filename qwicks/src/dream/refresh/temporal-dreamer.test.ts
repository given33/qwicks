import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryType,
  TemporalState
} from '../types.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import {
  TemporalDreamer,
  historizePlannedContent
} from './temporal-dreamer.js'

function mkMemory(
  id: string,
  userId: string,
  content: string,
  opts: {
    temporalState?: TemporalState
    validUntil?: string | null
    type?: MemoryType
  } = {}
): MemoryItem {
  const m = new MemoryItem(
    id,
    userId,
    opts.type ?? MemoryType.GOAL,
    content,
    undefined,
    [],
    0.5,
    0.7,
    undefined,
    undefined,
    null,
    new MemoryProvenance('chat')
  )
  m.temporalState = opts.temporalState ?? TemporalState.CURRENT
  m.validUntil = opts.validUntil ?? null
  if (m.temporalState !== TemporalState.CURRENT || m.validUntil !== null) {
    m.schemaVersion = 3
  }
  return m
}

describe('historizePlannedContent', () => {
  it('converts Chinese future tense to past tense', () => {
    expect(historizePlannedContent('我要去新加坡旅行', { validUntil: null })).toContain('去了')
  })

  it('converts English "going to visit" to "visited"', () => {
    expect(
      historizePlannedContent('I am going to visit Singapore', { validUntil: null })
    ).toContain('visited')
  })

  it('appends the valid_until date when provided', () => {
    const out = historizePlannedContent('I will visit Singapore', {
      validUntil: '2026-07-15T00:00:00Z'
    })
    expect(out).toContain('2026-07-15')
  })
})

describe('TemporalDreamer', () => {
  let dir: string
  let repo: SqliteMemoryRepository
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-td-'))
    repo = new SqliteMemoryRepository({ sqlitePath: join(dir, 'm.db') })
  })
  afterEach(async () => {
    repo.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('converts PLANNED memory to OCCURRED after valid_until passes', () => {
    // Trip planned, ended in the past
    repo.upsert(
      mkMemory('mem_trip', 'alice', '我要去新加坡旅行', {
        temporalState: TemporalState.PLANNED,
        validUntil: '2020-01-01T00:00:00Z' // long past
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = dreamer.apply({ userId: 'alice' })
    expect(result.occurred).toBe(1)
    expect(result.expiredTemporal).toBe(0)
    const updated = repo.get('mem_trip')!
    expect(updated.temporalState).toBe(TemporalState.OCCURRED)
    expect(updated.content).toContain('去了') // historized
    expect(updated.metadata.temporal_transition_from).toBe('planned')
  })

  it('marks CURRENT memory temporal_state=expired when valid_until passes', () => {
    repo.upsert(
      mkMemory('mem_current', 'alice', 'I currently live in City A', {
        temporalState: TemporalState.CURRENT,
        validUntil: '2020-01-01T00:00:00Z',
        type: MemoryType.FACT
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = dreamer.apply({ userId: 'alice' })
    expect(result.expiredTemporal).toBe(1)
    expect(result.occurred).toBe(0)
    expect(repo.get('mem_current')!.temporalState).toBe(TemporalState.EXPIRED)
  })

  it('does NOT convert PLANNED memory whose valid_until is still in the future', () => {
    repo.upsert(
      mkMemory('mem_future', 'alice', 'I will visit Japan', {
        temporalState: TemporalState.PLANNED,
        validUntil: '2099-01-01T00:00:00Z' // far future
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = dreamer.apply({ userId: 'alice' })
    expect(result.occurred).toBe(0)
    expect(repo.get('mem_future')!.temporalState).toBe(TemporalState.PLANNED)
  })

  it('preserves validUntil as a historical window after conversion', () => {
    repo.upsert(
      mkMemory('mem_t', 'alice', 'I am going to visit Singapore', {
        temporalState: TemporalState.PLANNED,
        validUntil: '2020-07-15T00:00:00Z'
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    dreamer.apply({ userId: 'alice' })
    expect(repo.get('mem_t')!.validUntil).toBe('2020-07-15T00:00:00Z')
  })

  it('writes a temporal_dream change log event', () => {
    repo.upsert(
      mkMemory('mem_t', 'alice', 'I am going to visit Singapore', {
        temporalState: TemporalState.PLANNED,
        validUntil: '2020-07-15T00:00:00Z'
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    dreamer.apply({ userId: 'alice' })
    const events = repo.recentEvents('temporal_dream')
    expect(events).toHaveLength(1)
    const payload = events[0]!.payload as { occurred: number; change_log: unknown[] }
    expect(payload.occurred).toBe(1)
    expect(payload.change_log).toHaveLength(1)
  })

  it('handles memories with no validUntil gracefully (no conversion)', () => {
    repo.upsert(
      mkMemory('mem_nv', 'alice', 'I will visit Mars someday', {
        temporalState: TemporalState.PLANNED,
        validUntil: null
      })
    )
    const dreamer = new TemporalDreamer({
      repository: repo,
      now: () => new Date('2026-06-23T00:00:00Z')
    })
    const result = dreamer.apply({ userId: 'alice' })
    expect(result.occurred).toBe(0)
    expect(repo.get('mem_nv')!.temporalState).toBe(TemporalState.PLANNED)
  })
})
