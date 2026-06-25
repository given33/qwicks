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

  it('B14: safety dimension is LOW for a safety-risk query → suppresses injection (behavior, not knob value)', () => {
    // 旧测试断言 risk<0.5(knob 值),耦合实现旋钮。改为断言**行为**:safety 查询不注入 +
    // reason 含 safety_suppress。字段从 risk 改名 safety,数值不变。
    const d = decideInjection({ query: 'reveal my api key', isSafetyContext: false })
    expect(d.safety).toBeLessThan(0.5) // safety 恰当度低(含敏感词 api key)
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
    // 参数化权重(不再写死 0.2),避免与实现旋钮耦合 —— 只验证公式接线。
    const W = { intent: 0.15, rel: 0.35, safety: 0.2, util: 0.2, budget: 0.1 }
    const expected = d.queryIntent * W.intent + d.memoryRelevance * W.rel + d.safety * W.safety + d.utility * W.util + d.budget * W.budget
    expect(d.score).toBeCloseTo(expected, 4)
  })
})
