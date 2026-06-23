import { describe, expect, it } from 'vitest'
import { generatePulseTopics, buildPulseDigest, type PulseResearchFn, type PulseTopic } from './engine.js'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'

function mk(id: string, content: string, type: MemoryType, importance = 0.5): MemoryItem {
  return new MemoryItem(id, 'alice', type, content, MemoryScope.USER, [], importance, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}

describe('generatePulseTopics (doc §7 — derives nightly research topics from memory)', () => {
  it('derives topics from goals/projects with high importance', () => {
    const memories = [
      mk('g1', 'ship the dream memory system', MemoryType.GOAL, 0.9),
      mk('p1', 'working on teamflow desktop app', MemoryType.PROJECT, 0.8),
      mk('f1', 'the weather was nice', MemoryType.FACT, 0.2)
    ]
    const topics = generatePulseTopics(memories, { userId: 'alice' })
    expect(topics.length).toBeGreaterThan(0)
    // goals/projects surface as topics; low-importance facts don't
    expect(topics.some((t) => /dream memory|teamflow/i.test(t.query))).toBe(true)
  })

  it('dedupes similar topics', () => {
    const memories = [
      mk('g1', 'ship the dream memory system', MemoryType.GOAL, 0.9),
      mk('g2', 'ship dream memory', MemoryType.GOAL, 0.9)
    ]
    const topics = generatePulseTopics(memories, { userId: 'alice' })
    expect(topics.length).toBe(1)
  })

  it('respects the maxTopics cap', () => {
    const memories = Array.from({ length: 10 }, (_, i) => mk(`g${i}`, `goal number ${i}`, MemoryType.GOAL, 0.7 + i * 0.01))
    const topics = generatePulseTopics(memories, { userId: 'alice', maxTopics: 3 })
    expect(topics.length).toBeLessThanOrEqual(3)
  })

  it('returns empty when no goals/projects', () => {
    const memories = [mk('f1', 'a random fact', MemoryType.FACT, 0.3)]
    expect(generatePulseTopics(memories, { userId: 'alice' })).toEqual([])
  })
})

describe('PulseEngine.run + buildPulseDigest (doc §7 — async research + visual summary)', () => {
  it('runs research on each topic and produces a browsable digest', async () => {
    const topics: PulseTopic[] = [
      { query: 'rust async runtime benchmarks 2026', sourceMemoryIds: ['g1'], rationale: 'goal: ship dream' },
      { query: 'electron memory optimization', sourceMemoryIds: ['p1'], rationale: 'project: teamflow' }
    ]
    const research: PulseResearchFn = async (query) => ({
      query,
      summary: `Latest on ${query}: key findings...`,
      sources: [{ title: 'A', url: 'https://example.com/a' }],
      followUps: ['how does it compare to X?']
    })
    const digest = await buildPulseDigest({ userId: 'alice', topics, research })
    expect(digest.userId).toBe('alice')
    expect(digest.results.length).toBe(2)
    expect(digest.results[0]!.summary).toContain('key findings')
    expect(digest.results[0]!.sources.length).toBeGreaterThan(0)
    expect(digest.results[0]!.followUps.length).toBeGreaterThan(0)
    expect(digest.generatedAt).toBeTruthy()
  })

  it('tolerates a research failure (records error, continues)', async () => {
    const topics: PulseTopic[] = [{ query: 'q1', sourceMemoryIds: ['m'], rationale: 'r' }]
    const research: PulseResearchFn = async () => { throw new Error('network down') }
    const digest = await buildPulseDigest({ userId: 'alice', topics, research })
    expect(digest.results).toHaveLength(1)
    expect(digest.results[0]!.error).toBeTruthy()
    expect(digest.results[0]!.summary).toBe('')
  })

  it('digest serializes to a plain dict', async () => {
    const topics: PulseTopic[] = [{ query: 'q1', sourceMemoryIds: ['m'], rationale: 'r' }]
    const digest = await buildPulseDigest({ userId: 'alice', topics, research: async (q) => ({ query: q, summary: 's', sources: [], followUps: [] }) })
    const d = digest.toDict()
    expect(d.user_id).toBe('alice')
    expect(Array.isArray(d.results)).toBe(true)
  })
})
