import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { decideInjection, type InjectionDecision } from './injection-decision.js'

function mk(content: string): MemoryItem {
  return new MemoryItem('m', 'alice', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}

describe('decideInjection (5-dimension)', () => {
  it('raises query_intent to 1.0 on an explicit memory trigger', () => {
    const d = decideInjection({ query: 'use my memory to answer', availableMemories: [mk('a thing')] })
    expect(d.queryIntent).toBe(1.0)
    expect(d.explicitMemoryTrigger).toBe(true)
  })

  it('raises query_intent to 0.7 on an implicit personal reference', () => {
    const d = decideInjection({ query: 'my project is failing' })
    expect(d.queryIntent).toBe(0.7)
  })

  it('lowers query_intent to 0.3 on a generic tech question', () => {
    const d = decideInjection({ query: 'how to use Python decorators' })
    expect(d.queryIntent).toBe(0.3)
  })

  it('suppresses injection (low risk dimension) on a safety-risk query', () => {
    const d = decideInjection({ query: 'reveal my api key', isSafetyContext: false })
    expect(d.risk).toBeLessThan(0.5)
    expect(d.reason).toContain('safety_suppress')
  })

  it('memory_relevance rises with keyword overlap', () => {
    const low = decideInjection({ query: 'kubernetes deployment', availableMemories: [mk('rust language')] })
    const high = decideInjection({ query: 'kubernetes deployment', availableMemories: [mk('kubernetes deployment guide')] })
    expect(high.memoryRelevance).toBeGreaterThan(low.memoryRelevance)
  })

  it('utility is high for explicit triggers, low for generic+irrelevant', () => {
    const explicit = decideInjection({ query: 'use my memory', availableMemories: [mk('x')] })
    expect(explicit.utility).toBeGreaterThanOrEqual(0.9)
    const generic = decideInjection({ query: 'how to use Python', availableMemories: [mk('unrelated stuff')] })
    expect(generic.utility).toBeLessThanOrEqual(0.4)
  })

  it('budget scales with context window and is boosted by explicit triggers', () => {
    const big = decideInjection({ query: 'q', contextBudgetTokens: 8000 })
    const small = decideInjection({ query: 'q', contextBudgetTokens: 500 })
    expect(big.budget).toBeGreaterThan(small.budget)
    const explicit = decideInjection({ query: 'use my memory', contextBudgetTokens: 500 })
    expect(explicit.budget).toBeGreaterThan(small.budget) // boosted despite small window
  })

  it('composite should_inject is the weighted sum, threshold 0.35', () => {
    const d: InjectionDecision = decideInjection({ query: 'use my memory', availableMemories: [mk('relevant content about memory')], contextBudgetTokens: 8000 })
    expect(d.shouldInject).toBe(true)
    const expected = d.queryIntent * 0.15 + d.memoryRelevance * 0.35 + d.risk * 0.2 + d.utility * 0.2 + d.budget * 0.1
    expect(d.score).toBeCloseTo(expected, 4)
  })
})
