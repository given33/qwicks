import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { NaturalPromptBuilder, naturalFallbackReply } from './natural-builder.js'
import type { UserDigitalTwin } from '../user_state/builder.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'

function mkHit(id: string, content: string, score: number, metadata: Record<string, unknown> = {}): RetrievalHit {
  return {
    item: new MemoryItem(id, 'alice', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance(), null, null, [], metadata),
    score,
    vectorScore: score,
    recencyScore: 0.5,
    importanceScore: 0.5,
    bm25Score: 0,
    exactScore: 0,
    source: 'vector'
  }
}

const twin: UserDigitalTwin = {
  userId: 'alice',
  generatedAt: '2026-06-23T00:00:00Z',
  title: 'Dream 数字孪生',
  profile: '',
  buckets: [],
  sections: [],
  openGoals: ['ship dream'],
  activeProjects: ['teamflow'],
  skills: ['rust'],
  preferences: ['concise replies'],
  constraints: ['no telemetry'],
  recentFacts: ['lives in Tokyo'],
  metadata: {}
}

describe('NaturalPromptBuilder', () => {
  it('produces a natural-language system block that does NOT expose ids/scores/JSON', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({
      userId: 'alice',
      query: 'remind me about my goals',
      twin,
      hits: [mkHit('m1', 'prefers concise replies', 0.8)],
      maxChars: 4000
    })
    expect(result.system).toContain('长期记忆')
    expect(result.system).not.toContain('id=')
    expect(result.system).not.toContain('score=')
  })

  it('context block uses "我注意到你之前提过" style, no (id=, score=)', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({
      userId: 'alice',
      query: 'x',
      twin,
      hits: [mkHit('m1', 'I built a rust web server', 0.9)],
      maxChars: 4000
    })
    expect(result.contextBlock).toContain('我注意到你之前提过')
    expect(result.contextBlock).not.toContain('id=')
    expect(result.contextBlock).not.toContain('score=')
    expect(result.contextBlock).toContain('rust web server')
  })

  it('twin profile/goals surface naturally (no raw JSON)', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({ userId: 'alice', query: 'x', twin, hits: [], maxChars: 4000 })
    expect(result.contextBlock).toContain('ship dream') // open goal surfaced
    expect(result.contextBlock).not.toContain('{')
  })

  it('appends canonical trait labels (structured_attrs → english keywords) to context', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({
      userId: 'alice',
      query: 'x',
      twin,
      hits: [mkHit('m1', '小而精的设计', 0.8, { structured_attrs: { preference: 'minimalist' } })],
      maxChars: 4000
    })
    expect(result.contextBlock.toLowerCase()).toContain('kiss')
    expect(result.contextBlock.toLowerCase()).toContain('minimalist')
  })

  it('records used memory ids + scores in eval_metadata (separate from user-visible channel)', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({
      userId: 'alice',
      query: 'x',
      twin,
      hits: [mkHit('m1', 'a', 0.8), mkHit('m2', 'b', 0.5)],
      maxChars: 4000
    })
    expect(result.usedMemoryIds).toEqual(['m1', 'm2'])
    expect(result.evalMetadata).toBeTruthy()
    // user-visible context must NOT contain the ids/scores
    expect(result.contextBlock).not.toContain('m1')
  })

  it('respects maxChars (truncates full_prompt, flags truncated)', () => {
    const b = new NaturalPromptBuilder()
    const result = b.build({
      userId: 'alice',
      query: 'x',
      twin,
      hits: [mkHit('m1', 'x'.repeat(2000), 0.8)],
      maxChars: 300
    })
    expect(result.fullPrompt.length).toBeLessThanOrEqual(303) // truncated + "..."
    expect(result.truncated).toBe(true)
  })
})

describe('naturalFallbackReply', () => {
  it('returns a friendly fallback when there are no hits', () => {
    const reply = naturalFallbackReply({ twin: null, hasHits: false, hits: [], query: 'hello' })
    expect(reply.length).toBeGreaterThan(0)
    expect(reply).not.toContain('twin')
    expect(reply).not.toContain('context_block')
  })

  it('references the user naturally when there are hits', () => {
    const reply = naturalFallbackReply({ twin, hasHits: true, hits: [mkHit('m1', 'prefers dark mode', 0.8)], query: 'remind me' })
    expect(reply.length).toBeGreaterThan(0)
  })
})
