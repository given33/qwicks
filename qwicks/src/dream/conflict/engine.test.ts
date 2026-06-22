import { describe, expect, it } from 'vitest'
import { ConflictVerdict, MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { compare, decide, reconcile, type ConflictAssessment } from './engine.js'

function mk(
  id: string,
  content: string,
  type: MemoryType,
  embedding: number[] | null = null,
  importance = 0.5
): MemoryItem {
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
    new MemoryProvenance(),
    embedding,
    'test'
  )
}

describe('ConflictEngine', () => {
  it('CONTRADICTS on negation + same type + token overlap', () => {
    const existing = mk('e1', 'I prefer Python', MemoryType.PREFERENCE, [1, 0])
    const fresh = mk('n1', 'I do not prefer Python anymore', MemoryType.PREFERENCE, [0.99, 0.01])
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('contradicts')
    expect(a.relatedId).toBe('e1')
  })

  it('DUPLICATE on same type + high jaccard + high cosine', () => {
    const existing = mk('e1', 'I prefer dark mode for coding', MemoryType.PREFERENCE, [1, 0])
    const fresh = mk('n1', 'I prefer dark mode for coding sessions', MemoryType.PREFERENCE, [0.99, 0.05])
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('duplicate')
  })

  it('SUPERSEDES on same type + high cosine + replace intent / higher importance', () => {
    const existing = mk('e1', 'my main language is python', MemoryType.FACT, [1, 0], 0.4)
    const fresh = mk('n1', 'my main language switched to rust', MemoryType.FACT, [0.9, 0.4], 0.6)
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('supersedes')
  })

  it('COMPATIBLE on high cosine + different type', () => {
    const existing = mk('e1', 'I love the rust language', MemoryType.PREFERENCE, [1, 0])
    const fresh = mk('n1', 'rust language is great', MemoryType.FACT, [0.95, 0.1])
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('compatible')
  })

  it('NONE on unrelated content', () => {
    const existing = mk('e1', 'the sky is blue', MemoryType.FACT, [1, 0])
    const fresh = mk('n1', 'postgres replication guide', MemoryType.FACT, [0, 1])
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('none')
  })

  it('NONE when existing is deleted', () => {
    const existing = mk('e1', 'I prefer Python', MemoryType.PREFERENCE, [1, 0])
    existing.metadata.__deleted__ = true
    const fresh = mk('n1', 'I prefer Python', MemoryType.PREFERENCE, [1, 0])
    expect(compare(fresh, existing).verdict).toBe('none')
  })

  it('reconcile evaluates against a candidate set', () => {
    const fresh = mk('n1', 'I prefer dark mode for coding', MemoryType.PREFERENCE, [1, 0])
    const cands = [
      mk('e1', 'I prefer dark mode for coding', MemoryType.PREFERENCE, [0.99, 0.05]),
      mk('e2', 'postgres replication guide', MemoryType.FACT, [0, 1])
    ]
    const results = reconcile(fresh, cands)
    expect(results).toHaveLength(2)
    expect(results[0]!.verdict).toBe('duplicate')
    expect(results[1]!.verdict).toBe('none')
  })

  it('decide maps verdict to an action', () => {
    const mk2 = (v: ConflictAssessment['verdict']): ConflictAssessment => ({
      verdict: v as ConflictAssessment['verdict'], newId: 'n', relatedId: 'e', reason: '', confidence: 0.5
    })
    expect(decide(mk2(ConflictVerdict.NONE))).toBe('keep_both')
    expect(decide(mk2(ConflictVerdict.COMPATIBLE))).toBe('keep_both')
    expect(decide(mk2(ConflictVerdict.DUPLICATE))).toBe('merge_into_existing')
    expect(decide(mk2(ConflictVerdict.CONTRADICTS))).toBe('ask_user_or_invalidate_old')
    expect(decide(mk2(ConflictVerdict.SUPERSEDES))).toBe('supersede_old')
  })
})
