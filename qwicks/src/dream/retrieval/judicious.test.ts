import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { assessJudiciousAndFreshness, detectGenericQuestion, applyJudiciousDemote } from './judicious.js'

function mk(content: string, importance = 0.5): MemoryItem {
  return new MemoryItem('m1', 'alice', MemoryType.FACT, content, MemoryScope.USER, [], importance, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}

describe('judicious — generic question detection', () => {
  it('detects a personal-project query as NOT generic', () => {
    expect(detectGenericQuestion('how do I configure my project?').isGeneric).toBe(false)
    expect(detectGenericQuestion('我的项目怎么部署').isGeneric).toBe(false)
  })
  it('detects a generic tech question as generic', () => {
    expect(detectGenericQuestion('how to use Python decorators').isGeneric).toBe(true)
    expect(detectGenericQuestion('什么是 docker').isGeneric).toBe(true)
  })
  it('treats ambiguous / no-signal query as not generic', () => {
    expect(detectGenericQuestion('tell me a story').isGeneric).toBe(false)
    expect(detectGenericQuestion('').isGeneric).toBe(false)
  })
})

describe('judicious — applyJudiciousDemote', () => {
  it('demotes personal-history memories on a generic question', () => {
    const dec = detectGenericQuestion('how to use Python')
    const personal = mk('在我之前的项目里我用了 Python')
    expect(applyJudiciousDemote(personal, dec)).toBeLessThan(0)
  })
  it('does NOT demote when the question is personal (not generic)', () => {
    const dec = detectGenericQuestion('我的项目用什么语言')
    expect(applyJudiciousDemote(mk('some content'), dec)).toBe(0)
  })
})

describe('judicious — assessJudiciousAndFreshness (supersede chain)', () => {
  it('demotes superseded old values and boosts the new value', () => {
    const oldItem = new MemoryItem('old', 'alice', MemoryType.FACT, 'use library X', MemoryScope.USER, [], 0.5, 0.7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', null, new MemoryProvenance(), null, null, [], { structured_attrs: { current_http_lib: 'X' } })
    const newItem = new MemoryItem('new', 'alice', MemoryType.FACT, 'now use library Y', MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance(), null, null, [], { structured_attrs: { current_http_lib: 'Y' } })
    const all = [oldItem, newItem]

    const oldAdj = assessJudiciousAndFreshness({ item: oldItem, query: 'what http lib do I use', userId: 'alice', allUserItems: all })
    const newAdj = assessJudiciousAndFreshness({ item: newItem, query: 'what http lib do I use', userId: 'alice', allUserItems: all })
    expect(oldAdj.isSuperseded).toBe(true)
    expect(oldAdj.freshnessAdjust).toBeLessThan(0)
    expect(newAdj.freshnessAdjust).toBeGreaterThan(0)
  })

  it('returns neutral when there is no supersede chain', () => {
    const item = mk('a standalone fact')
    const adj = assessJudiciousAndFreshness({ item, query: 'tell me', userId: 'alice', allUserItems: [item] })
    expect(adj.freshnessAdjust).toBe(0)
    expect(adj.isSuperseded).toBe(false)
  })
})
