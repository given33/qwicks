import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { HeuristicSynthesizer, LlmSynthesizer } from './synthesizer.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'

function mk(id: string, type: MemoryType, content: string, importance = 0.5): MemoryItem {
  return new MemoryItem(id, 'alice', type, content, MemoryScope.USER, [], importance, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}
function hit(item: MemoryItem, score = 0.8): RetrievalHit {
  return { item, score, baseScore: score, vectorScore: 0.8, recencyScore: 0.5, importanceScore: item.importance, bm25Score: 0, exactScore: 0, source: 'vector' }
}

describe('HeuristicSynthesizer', () => {
  it('aggregates hits into a twin grouped by type', () => {
    const synth = new HeuristicSynthesizer()
    const result = synth.synthesize({
      hits: [hit(mk('s', MemoryType.SKILL, 'rust')), hit(mk('p', MemoryType.PREFERENCE, 'vegetarian'))],
      user: 'I am a vegetarian who codes in rust',
      assistant: null,
      twin: null,
      userId: 'alice'
    })
    expect(result.twin.userId).toBe('alice')
    expect(result.twin.skills).toContain('rust')
    expect(result.twin.preferences).toContain('vegetarian')
    expect(result.selected.map((i) => i.id)).toEqual(['s', 'p'])
  })

  it('respects the top-per-type cap of 5', () => {
    const synth = new HeuristicSynthesizer()
    const hits = Array.from({ length: 10 }, (_, i) => hit(mk(`s${i}`, MemoryType.SKILL, `skill ${i}`)))
    const result = synth.synthesize({ hits, user: 'x', assistant: null, twin: null, userId: 'alice' })
    const skillSection = result.twin.sections.find((s) => s.title.toLowerCase().startsWith('skill'))
    expect(skillSection!.items).toHaveLength(5)
  })

  it('produces an empty twin when there are no hits', () => {
    const synth = new HeuristicSynthesizer()
    const result = synth.synthesize({ hits: [], user: 'x', assistant: null, twin: null, userId: 'alice' })
    expect(result.twin.skills).toEqual([])
    expect(result.twin.profile).toBe('')
  })
})

describe('LlmSynthesizer', () => {
  it('parses the LLM JSON twin response', async () => {
    const chat = async () => ({
      text: JSON.stringify({
        profile: 'a concise user',
        sections: [],
        open_goals: ['ship dream'],
        active_projects: [],
        skills: ['typescript'],
        preferences: ['concise replies'],
        constraints: [],
        recent_facts: []
      })
    })
    const synth = new LlmSynthesizer({ chat })
    const result = await synth.synthesizeAsync({
      hits: [hit(mk('s', MemoryType.SKILL, 'rust'))],
      user: 'I code in typescript',
      assistant: null,
      twin: null,
      userId: 'alice'
    })
    expect(result.twin.profile).toBe('a concise user')
    expect(result.twin.openGoals).toContain('ship dream')
    expect(result.twin.skills).toContain('typescript')
  })

  it('falls back to heuristic twin when LLM throws or returns malformed JSON', async () => {
    const bad = new LlmSynthesizer({ chat: async () => { throw new Error('down') } })
    const r1 = await bad.synthesizeAsync({
      hits: [hit(mk('s', MemoryType.SKILL, 'rust'))],
      user: 'x', assistant: null, twin: null, userId: 'alice'
    })
    expect(r1.twin.skills).toContain('rust')

    const malformed = new LlmSynthesizer({ chat: async () => ({ text: 'not json' }) })
    const r2 = await malformed.synthesizeAsync({
      hits: [hit(mk('s', MemoryType.SKILL, 'rust'))],
      user: 'x', assistant: null, twin: null, userId: 'alice'
    })
    expect(r2.twin.skills).toContain('rust')
  })
})
