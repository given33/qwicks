import { describe, expect, it } from 'vitest'
import {
  ConflictVerdict,
  DerivationRecord,
  MemoryItem,
  MemoryItemDraft,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType,
  newMemoryId,
  parseConflictVerdict,
  parseMemoryLifecycleStatus,
  parseMemoryScope,
  parseMemoryType,
  parseTemporalState,
  parseSensitivityLevel,
  parseSourceType,
  parseSuppressionScope,
  SensitivityLevel,
  SourceRecord,
  SourceType,
  SuppressionRule,
  SuppressionScope,
  TemporalState
} from './types.js'

describe('memory enums', () => {
  it('exposes the full MemoryType set aligned with the Python model', () => {
    expect(Object.values(MemoryType).sort()).toEqual(
      ['constraint', 'episode', 'fact', 'feedback', 'goal', 'preference', 'project', 'skill']
    )
  })

  it('exposes the full lifecycle status set (9 states)', () => {
    expect(Object.values(MemoryLifecycleStatus).sort()).toEqual([
      'active',
      'archived',
      'confirmed',
      'connector_revoked',
      'deleted',
      'expired',
      'hypothesis',
      'superseded',
      'suppressed'
    ])
  })

  it('parses and rejects enum values', () => {
    expect(parseMemoryType('goal')).toBe(MemoryType.GOAL)
    expect(() => parseMemoryType('nope')).toThrow()
    expect(parseMemoryScope('user')).toBe(MemoryScope.USER)
    expect(parseConflictVerdict('supersedes')).toBe(ConflictVerdict.SUPERSEDES)
    expect(parseMemoryLifecycleStatus('active')).toBe(MemoryLifecycleStatus.ACTIVE)
  })
})

describe('newMemoryId', () => {
  it('produces a mem_ prefixed 16-char id (mem_ + 12 hex)', () => {
    const id = newMemoryId()
    expect(id).toMatch(/^mem_[0-9a-f]{12}$/)
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newMemoryId()))
    expect(ids.size).toBe(1000)
  })
})

describe('MemoryItem.fingerprint', () => {
  it('is stable for the same user/type/content/tags and order-insensitive for tags', () => {
    const base = MemoryItem.fromDict({
      id: 'mem_x',
      user_id: 'alice',
      type: 'goal',
      content: 'ship dream',
      tags: ['a', 'b']
    })
    const swapped = MemoryItem.fromDict({
      id: 'mem_y',
      user_id: 'alice',
      type: 'goal',
      content: 'ship dream',
      tags: ['b', 'a']
    })
    // id differs, fingerprint must still match (fingerprint ignores id)
    expect(base.id).not.toBe(swapped.id)
    expect(base.fingerprint()).toBe(swapped.fingerprint())
    expect(base.fingerprint()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('differs when content differs', () => {
    const a = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'x' })
    const b = MemoryItem.fromDict({ id: '2', user_id: 'u', type: 'fact', content: 'y' })
    expect(a.fingerprint()).not.toBe(b.fingerprint())
  })
})

describe('MemoryItem.fromDict migration (v1 -> v2)', () => {
  it('defaults an unknown record to active status + schemaVersion 1', () => {
    const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
    expect(item.status).toBe(MemoryLifecycleStatus.ACTIVE)
    expect(item.schemaVersion).toBe(1)
    expect(item.scope).toBe(MemoryScope.USER)
    expect(item.importance).toBe(0.5)
    expect(item.confidence).toBe(0.7)
  })

  it('infers DELETED from legacy metadata __deleted__', () => {
    const item = MemoryItem.fromDict({
      id: '1',
      user_id: 'u',
      type: 'fact',
      content: 'c',
      metadata: { __deleted__: true }
    })
    expect(item.status).toBe(MemoryLifecycleStatus.DELETED)
  })

  it('infers SUPPRESSED from legacy do_not_inject metadata', () => {
    const item = MemoryItem.fromDict({
      id: '1',
      user_id: 'u',
      type: 'fact',
      content: 'c',
      metadata: { do_not_inject: true }
    })
    expect(item.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
  })

  it('infers SUPPRESSED from legacy __do_not_inject__ tag', () => {
    const item = MemoryItem.fromDict({
      id: '1',
      user_id: 'u',
      type: 'fact',
      content: 'c',
      tags: ['__do_not_inject__']
    })
    expect(item.status).toBe(MemoryLifecycleStatus.SUPPRESSED)
  })

  it('respects an explicit status field over legacy metadata', () => {
    const item = MemoryItem.fromDict({
      id: '1',
      user_id: 'u',
      type: 'fact',
      content: 'c',
      status: 'expired',
      metadata: { __deleted__: true }
    })
    expect(item.status).toBe(MemoryLifecycleStatus.EXPIRED)
  })

  it('round-trips through toDict/fromDict preserving the rich fields', () => {
    const original = MemoryItem.fromDict({
      id: 'mem_1',
      user_id: 'alice',
      type: 'preference',
      content: 'vegetarian',
      scope: 'user',
      tags: ['diet'],
      importance: 0.8,
      confidence: 0.9,
      provenance: { source: 'user', confidence: 0.9 },
      status: 'active',
      embedding: [0.1, 0.2, 0.3],
      embedding_model: 'bge-m3'
    })
    const round = MemoryItem.fromDict(original.toDict())
    expect(round).toEqual(original)
  })
})

describe('MemoryItem.transitionStatus', () => {
  it('is a no-op when transitioning to the same status', () => {
    const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
    const before = item.statusHistory.length
    item.transitionStatus(MemoryLifecycleStatus.ACTIVE)
    expect(item.statusHistory.length).toBe(before)
  })

  it('records history and writes legacy metadata for DELETED', () => {
    const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
    item.transitionStatus(MemoryLifecycleStatus.DELETED, { actor: 'user', reason: 'rm' })
    expect(item.status).toBe(MemoryLifecycleStatus.DELETED)
    expect(item.metadata.__deleted__).toBe(true)
    expect(item.statusHistory).toHaveLength(1)
    expect(item.statusHistory[0]).toMatchObject({
      status: 'deleted',
      actor: 'user',
      reason: 'rm'
    })
  })

  it('writes legacy do_not_inject metadata + tag for SUPPRESSED', () => {
    const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
    item.transitionStatus(MemoryLifecycleStatus.SUPPRESSED)
    expect(item.metadata.do_not_inject).toBe(true)
    expect(item.tags).toContain('__do_not_inject__')
    // SUPPRESSED now also sets isSuppressed (v3 field) → schemaVersion bumps to ≥3.
    expect(item.schemaVersion).toBeGreaterThanOrEqual(2)
    expect(item.isSuppressed).toBe(true)
  })

  it('writes legacy markers for EXPIRED/SUPERSEDED/ARCHIVED/CONNECTOR_REVOKED', () => {
    for (const [status, marker] of [
      [MemoryLifecycleStatus.EXPIRED, '__expired__'],
      [MemoryLifecycleStatus.SUPERSEDED, '__superseded__'],
      [MemoryLifecycleStatus.ARCHIVED, '__archived__'],
      [MemoryLifecycleStatus.CONNECTOR_REVOKED, '__connector_revoked__']
    ] as const) {
      const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
      item.transitionStatus(status)
      expect(item.metadata[marker]).toBe(true)
    }
  })

  it('bumps schemaVersion on any transition', () => {
    const item = MemoryItem.fromDict({ id: '1', user_id: 'u', type: 'fact', content: 'c' })
    expect(item.schemaVersion).toBe(1)
    item.transitionStatus(MemoryLifecycleStatus.ARCHIVED)
    // Any transition bumps schemaVersion to ≥ 2; transitions that set v3 fields go to ≥ 3.
    expect(item.schemaVersion).toBeGreaterThanOrEqual(2)
  })
})

describe('MemoryProvenance', () => {
  it('defaults source to user and confidence to 0.7', () => {
    const p = MemoryProvenance.fromDict({})
    expect(p.source).toBe('user')
    expect(p.confidence).toBe(0.7)
  })

  it('ignores unknown keys', () => {
    const p = MemoryProvenance.fromDict({ source: 'model', bogus: 1 } as { source: string; bogus: number })
    expect(p.source).toBe('model')
    expect((p as unknown as Record<string, unknown>).bogus).toBeUndefined()
  })
})

describe('MemoryItemDraft', () => {
  it('round-trips and defaults scope/type-derived fields', () => {
    const draft = MemoryItemDraft.fromDict({ type: 'goal', content: 'ship it' })
    expect(draft.scope).toBe(MemoryScope.USER)
    expect(draft.importance).toBe(0.5)
    const round = MemoryItemDraft.fromDict(draft.toDict())
    expect(round).toEqual(draft)
  })
})

describe('DerivationRecord', () => {
  it('defaults confidence and method', () => {
    const d = DerivationRecord.fromDict({})
    expect(d.confidence).toBe(0.7)
    expect(d.method).toBe('')
    expect(d.derivedFromSourceIds).toEqual([])
  })
})

describe('TemporalState enum', () => {
  it('exposes planned/current/occurred/expired/superseded', () => {
    expect(Object.values(TemporalState).sort()).toEqual([
      'current',
      'expired',
      'occurred',
      'planned',
      'superseded'
    ])
    expect(parseTemporalState('planned')).toBe(TemporalState.PLANNED)
    expect(() => parseTemporalState('nope')).toThrow()
  })
})

describe('MemoryItem v3 fields', () => {
  it('defaults all v3 fields when absent', () => {
    const item = MemoryItem.fromDict({
      id: 'm1',
      user_id: 'u',
      type: 'fact',
      content: 'c'
    })
    expect(item.normalizedFacts).toEqual([])
    expect(item.sourceIds).toEqual([])
    expect(item.temporalState).toBe(TemporalState.CURRENT)
    expect(item.validFrom).toBeNull()
    expect(item.validUntil).toBeNull()
    expect(item.supersedes).toEqual([])
    expect(item.supersededBy).toEqual([])
    expect(item.isTopOfMind).toBe(false)
    expect(item.isSuppressed).toBe(false)
    expect(item.userCorrected).toBe(false)
    expect(item.salience).toBe(0.5)
    expect(item.topic).toBeNull()
    expect(item.lastUsedAt).toBeNull()
    expect(item.sensitivity).toBe(SensitivityLevel.NORMAL)
    expect(item.shareable).toBe(true)
  })

  it('round-trips all v3 fields through toDict/fromDict', () => {
    const original = MemoryItem.fromDict({
      id: 'm2',
      user_id: 'alice',
      type: 'goal',
      content: 'visit Singapore in July',
      normalized_facts: ['travel destination = Singapore', 'planned month = July'],
      source_ids: ['src_abc', 'src_def'],
      temporal_state: 'planned',
      valid_from: '2026-07-01T00:00:00Z',
      valid_until: '2026-07-15T00:00:00Z',
      supersedes: ['mem_old1'],
      superseded_by: [],
      is_top_of_mind: true,
      is_suppressed: false,
      user_corrected: false,
      salience: 0.9,
      topic: 'travel:sg',
      last_used_at: null,
      sensitivity: 'sensitive',
      shareable: true
    })
    const round = MemoryItem.fromDict(original.toDict())
    expect(round).toEqual(original)
    expect(round.temporalState).toBe(TemporalState.PLANNED)
    expect(round.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(round.normalizedFacts).toHaveLength(2)
    expect(round.sourceIds).toEqual(['src_abc', 'src_def'])
    expect(round.isTopOfMind).toBe(true)
    expect(round.salience).toBe(0.9)
    expect(round.topic).toBe('travel:sg')
    expect(round.validFrom).toBe('2026-07-01T00:00:00Z')
    expect(round.validUntil).toBe('2026-07-15T00:00:00Z')
  })

  it('transitionToOccurred rewrites content and sets temporalState', () => {
    const item = MemoryItem.fromDict({
      id: 'm3',
      user_id: 'u',
      type: 'goal',
      content: 'I will visit Singapore',
      temporal_state: 'planned',
      valid_until: '2026-07-15T00:00:00Z'
    })
    item.transitionToOccurred('I visited Singapore in July 2026', { reason: 'trip_completed' })
    expect(item.content).toBe('I visited Singapore in July 2026')
    expect(item.temporalState).toBe(TemporalState.OCCURRED)
    expect(item.metadata.temporal_transition_from).toBe('planned')
    expect(item.schemaVersion).toBeGreaterThanOrEqual(3)
    expect(item.validUntil).toBe('2026-07-15T00:00:00Z')
  })

  it('markSupersededBy records chain and sets temporalState=superseded', () => {
    const item = MemoryItem.fromDict({
      id: 'm4',
      user_id: 'u',
      type: 'fact',
      content: 'I live in City A'
    })
    item.markSupersededBy('mem_new', { reason: 'user moved' })
    expect(item.supersededBy).toContain('mem_new')
    expect(item.temporalState).toBe(TemporalState.SUPERSEDED)
    expect(item.schemaVersion).toBeGreaterThanOrEqual(3)
  })

  it('markUserCorrected, promote/demote, markUsed', () => {
    const item = MemoryItem.fromDict({
      id: 'm5',
      user_id: 'u',
      type: 'preference',
      content: 'likes dark mode'
    })
    item.markUserCorrected()
    expect(item.userCorrected).toBe(true)
    item.promoteToTopOfMind()
    expect(item.isTopOfMind).toBe(true)
    item.demoteToBackground()
    expect(item.isTopOfMind).toBe(false)
    item.markUsed('2026-07-01T00:00:00Z')
    expect(item.lastUsedAt).toBe('2026-07-01T00:00:00Z')
  })

  it('rejects invalid temporal_state / sensitivity with safe fallback', () => {
    const item = MemoryItem.fromDict({
      id: 'm6',
      user_id: 'u',
      type: 'fact',
      content: 'c',
      temporal_state: 'BOGUS',
      sensitivity: 'NOPE'
    })
    expect(item.temporalState).toBe(TemporalState.CURRENT)
    expect(item.sensitivity).toBe(SensitivityLevel.NORMAL)
  })
})

describe('SourceRecord', () => {
  it('round-trips and assigns id when missing', () => {
    const s = SourceRecord.fromDict({
      user_id: 'alice',
      source_type: 'chat',
      external_ref: 'thread_t1/turn_5',
      title: 'where should I eat',
      content: 'I am vegan and live in SF'
    })
    expect(s.id).toMatch(/^src_[0-9a-f]{12}$/)
    expect(s.sourceType).toBe(SourceType.CHAT)
    const round = SourceRecord.fromDict(s.toDict())
    expect(round).toEqual(s)
  })

  it('supports all 6 source types', () => {
    for (const t of [
      SourceType.CHAT,
      SourceType.FILE,
      SourceType.GMAIL,
      SourceType.CUSTOM_INSTRUCTION,
      SourceType.SAVED_MEMORY,
      SourceType.DRIVE
    ]) {
      const s = SourceRecord.fromDict({ user_id: 'u', source_type: t })
      expect(s.sourceType).toBe(t)
    }
  })

  it('rejects invalid source_type', () => {
    expect(() => SourceRecord.fromDict({ user_id: 'u', source_type: 'instagram' })).toThrow()
  })
})

describe('SuppressionRule', () => {
  it('round-trips with memory/source/summary/topic scopes', () => {
    const scopes = [
      SuppressionScope.MEMORY,
      SuppressionScope.SOURCE,
      SuppressionScope.SUMMARY,
      SuppressionScope.TOPIC
    ]
    for (const scope of scopes) {
      const r = SuppressionRule.fromDict({
        user_id: 'alice',
        scope,
        target: scope === SuppressionScope.TOPIC ? 'politics' : 'mem_x1',
        reason: 'user asked not to mention'
      })
      expect(r.scope).toBe(scope)
      expect(r.active).toBe(true)
      const round = SuppressionRule.fromDict(r.toDict())
      expect(round).toEqual(r)
    }
  })

  it('active defaults to true and can be deactivated', () => {
    const r = SuppressionRule.fromDict({
      id: 'sup_1',
      user_id: 'u',
      scope: SuppressionScope.TOPIC,
      target: 'religion'
    })
    expect(r.active).toBe(true)
    r.active = false
    expect(SuppressionRule.fromDict(r.toDict()).active).toBe(false)
  })
})
