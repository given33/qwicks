import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { TwinBuilder, twinToDict } from './builder.js'
import type { RetrievalHit } from './builder.js'

function mk(id: string, type: MemoryType, content: string, importance = 0.5): MemoryItem {
  return new MemoryItem(
    id,
    'alice',
    type,
    content,
    MemoryScope.USER,
    [],
    importance,
    0.7,
    '2026-06-01T00:00:00Z',
    '2026-06-01T00:00:00Z',
    null,
    new MemoryProvenance()
  )
}

describe('TwinBuilder', () => {
  it('builds a twin from memories grouped by type, top-per-bucket by importance', () => {
    const memories = [
      mk('s1', MemoryType.SKILL, 'rust expert', 0.9),
      mk('s2', MemoryType.SKILL, 'knows kubernetes', 0.5),
      mk('p1', MemoryType.PREFERENCE, 'vegetarian', 0.8),
      mk('g1', MemoryType.GOAL, 'ship dream system', 0.7)
    ]
    const twin = new TwinBuilder().build({ userId: 'alice', memories })
    expect(twin.userId).toBe('alice')
    expect(twin.skills).toContain('rust expert')
    expect(twin.skills).toContain('knows kubernetes')
    expect(twin.preferences).toContain('vegetarian')
    expect(twin.openGoals).toContain('ship dream system')
    // buckets grouped by type
    const skillBucket = twin.buckets.find((b) => b.type === MemoryType.SKILL)
    expect(skillBucket).toBeTruthy()
    // top_per_bucket: skill sorted by importance desc → s1 first
    expect(skillBucket!.items[0]).toBe('s1')
  })

  it('respects top_per_bucket (caps items per bucket)', () => {
    const memories = Array.from({ length: 10 }, (_, i) => mk(`s${i}`, MemoryType.SKILL, `skill ${i}`, 0.5))
    const twin = new TwinBuilder({ topPerBucket: 3 }).build({ userId: 'alice', memories })
    const skillBucket = twin.buckets.find((b) => b.type === MemoryType.SKILL)!
    expect(skillBucket.items).toHaveLength(3)
  })

  it('merges retrieval hits into the item set', () => {
    const memories = [mk('s1', MemoryType.SKILL, 'rust')]
    const hits: RetrievalHit[] = [
      {
        item: mk('s2', MemoryType.SKILL, 'extra from hit', 0.6),
        score: 0.9
      }
    ]
    const twin = new TwinBuilder().build({ userId: 'alice', memories, hits })
    expect(twin.skills).toContain('rust')
    expect(twin.skills).toContain('extra from hit')
  })

  it('skips deleted/superseded items', () => {
    const memories = [
      mk('a', MemoryType.FACT, 'alive', 0.5),
      mk('d', MemoryType.FACT, 'dead', 0.5)
    ]
    memories[1]!.metadata.__deleted__ = true
    const twin = new TwinBuilder().build({ userId: 'alice', memories })
    expect(twin.recentFacts).toContain('alive')
    expect(twin.recentFacts).not.toContain('dead')
  })

  it('composes a profile string summarizing skills/goals/projects/prefs', () => {
    const memories = [
      mk('s', MemoryType.SKILL, 'rust'),
      mk('g', MemoryType.GOAL, 'ship it'),
      mk('p', MemoryType.PROJECT, 'dream'),
      mk('pr', MemoryType.PREFERENCE, 'concise')
    ]
    const twin = new TwinBuilder().build({ userId: 'alice', memories })
    expect(twin.profile).toContain('rust')
    expect(twin.profile).toContain('ship it')
    expect(twin.profile).toContain('dream')
    expect(twin.profile).toContain('concise')
  })

  it('twinToDict round-trips', () => {
    const twin = new TwinBuilder().build({ userId: 'alice', memories: [mk('s', MemoryType.SKILL, 'rust')] })
    const dict = twinToDict(twin)
    expect(dict.user_id).toBe('alice')
    expect(dict.skills).toEqual(['rust'])
  })
})
