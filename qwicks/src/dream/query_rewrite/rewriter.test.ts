import { describe, expect, it } from 'vitest'
import { rewriteQuery, type RewriteContext } from './rewriter.js'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'

function mk(content: string, type: MemoryType, importance = 0.5): MemoryItem {
  return new MemoryItem('m', 'alice', type, content, MemoryScope.USER, [], importance, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}

describe('rewriteQuery (memory rewrites search query, doc §3.5)', () => {
  it('returns the original query when no relevant memories apply', () => {
    const ctx: RewriteContext = { userId: 'alice', query: 'what is the weather today', memories: [] }
    const r = rewriteQuery(ctx)
    expect(r.rewritten).toBe('what is the weather today')
    expect(r.appliedMemories).toEqual([])
  })

  it('adds location from memory when the query asks for nearby/local recommendations', () => {
    const memories = [mk('I live in San Francisco', MemoryType.FACT, 0.8)]
    const ctx: RewriteContext = { userId: 'alice', query: 'what are some good restaurants near me', memories }
    const r = rewriteQuery(ctx)
    expect(r.rewritten.toLowerCase()).toContain('san francisco')
    expect(r.appliedMemories.length).toBeGreaterThan(0)
  })

  it('adds dietary preference when the query asks for food recommendations', () => {
    const memories = [mk('I am a vegetarian', MemoryType.PREFERENCE, 0.9)]
    const ctx: RewriteContext = { userId: 'alice', query: 'recommend dinner recipes', memories }
    const r = rewriteQuery(ctx)
    expect(r.rewritten.toLowerCase()).toContain('vegetarian')
  })

  it('combines location + diet + a project constraint', () => {
    const memories = [
      mk('I live in San Francisco', MemoryType.FACT, 0.8),
      mk('I am vegan', MemoryType.PREFERENCE, 0.9),
      mk('I prefer quiet places', MemoryType.PREFERENCE, 0.6)
    ]
    const ctx: RewriteContext = { userId: 'alice', query: 'find me a nice place to eat nearby', memories }
    const r = rewriteQuery(ctx)
    const low = r.rewritten.toLowerCase()
    expect(low).toContain('san francisco')
    expect(low).toContain('vegan')
  })

  it('does NOT rewrite a generic factual question (no food/location intent)', () => {
    const memories = [mk('I live in Tokyo', MemoryType.FACT, 0.8)]
    const ctx: RewriteContext = { userId: 'alice', query: 'how does a transformer model work', memories }
    const r = rewriteQuery(ctx)
    expect(r.rewritten).toBe('how does a transformer model work')
    expect(r.appliedMemories).toEqual([])
  })

  it('explains which memories were applied (source lineage)', () => {
    const memories = [mk('I am vegan', MemoryType.PREFERENCE, 0.9)]
    const r = rewriteQuery({ userId: 'alice', query: 'dinner recipes', memories })
    expect(r.appliedMemories[0]?.memoryId).toBeTruthy()
    expect(r.appliedMemories[0]?.slot).toBeTruthy() // 'diet' / 'location' / etc.
    expect(r.appliedMemories[0]?.extractedValue).toBeTruthy()
  })

  it('respects the original query prefix (keeps user intent)', () => {
    const memories = [mk('I live in Berlin', MemoryType.FACT, 0.8)]
    const r = rewriteQuery({ userId: 'alice', query: 'best coffee shops nearby', memories })
    expect(r.rewritten).toContain('best coffee shops')
    expect(r.rewritten.toLowerCase()).toContain('berlin')
  })
})
