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

  it('v3 P2-4: SUPERSEDES on location-slot mismatch (moved from A to B)', () => {
    // "I live in San Francisco" → "I now live in Tokyo" (same live-in, different place)
    const existing = mk('e1', 'I live in San Francisco', MemoryType.FACT, [1, 0.8])
    const fresh = mk('n1', 'I now live in Tokyo', MemoryType.FACT, [0.8, 1])
    const a = compare(fresh, existing)
    expect(a.verdict).toBe('supersedes')
    expect(a.reason).toContain('location_slot_supersede')
  })

  it('v3 P2-4: COMPATIBLE (not supersede) when same location mentioned', () => {
    const existing = mk('e1', 'I live in San Francisco', MemoryType.FACT, [1, 0.8])
    const fresh = mk('n1', 'I work in San Francisco', MemoryType.FACT, [0.8, 1])
    const a = compare(fresh, existing)
    // Same location → not a location-slot supersede (overlap detected)
    expect(a.reason).not.toContain('location_slot_supersede')
  })

  // 二轮报告 §4.7 建议的 5 个 location supersede 测试用例
  it('§4.7 case 1: I live in SF -> I now live in NY = SUPERSEDES', () => {
    const existing = mk('e1', 'I live in San Francisco', MemoryType.FACT, [1, 0.8])
    const fresh = mk('n1', 'I now live in New York', MemoryType.FACT, [0.8, 1])
    expect(compare(fresh, existing).verdict).toBe('supersedes')
  })

  it('§4.7 case 2: visiting NY this week -> live in SF = NOT supersede (visit ≠ live)', () => {
    const existing = mk('e1', 'I am visiting New York this week', MemoryType.FACT, [0.5, 1])
    const fresh = mk('n1', 'I live in San Francisco', MemoryType.FACT, [1, 0.5])
    // visiting ≠ live-in slot,不同语义槽,不触发 location supersede
    const a = compare(fresh, existing)
    expect(a.reason).not.toContain('location_slot_supersede')
  })

  it('§4.7 case 3: 我住在北京 -> 我现在住在上海 = SUPERSEDES', () => {
    const existing = mk('e1', '我住在北京', MemoryType.FACT, [1, 0.5])
    const fresh = mk('n1', '我现在住在上海', MemoryType.FACT, [0.5, 1])
    expect(compare(fresh, existing).verdict).toBe('supersedes')
  })

  it('§4.7 case 4: 现在在上海出差 -> 住在北京 = NOT supersede (出差 ≠ 居住)', () => {
    const existing = mk('e1', '我现在在上海出差', MemoryType.FACT, [0.5, 1])
    const fresh = mk('n1', '我住在北京', MemoryType.FACT, [1, 0.5])
    // "出差" 不匹配 live-in 槽位(住在/在+城市),不触发 location supersede
    const a = compare(fresh, existing)
    expect(a.reason).not.toContain('location_slot_supersede')
  })

  it('§4.7 case 5: work in vs live in same city = NOT supersede (different slot)', () => {
    const existing = mk('e1', 'I work in Tokyo', MemoryType.FACT, [0.8, 1])
    const fresh = mk('n1', 'I live in Tokyo', MemoryType.FACT, [1, 0.8])
    // Same city (Tokyo) → overlap → not supersede
    const a = compare(fresh, existing)
    expect(a.reason).not.toContain('location_slot_supersede')
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
