import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { buildMemoryLedger, type LedgerEntry } from './ledger.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'
import type { ObservableDecision } from '../retrieval/observable-gate.js'

function mk(id: string, content: string, metadata: Record<string, unknown> = {}): MemoryItem {
  return new MemoryItem(id, 'alice', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance(), null, null, [], metadata)
}
function hit(id: string, score: number, content = 'x'): RetrievalHit {
  return { item: mk(id, content), score, vectorScore: score, recencyScore: 0.5, importanceScore: 0.5, bm25Score: 0, exactScore: 0, source: 'vector' }
}
function dec(id: string, finalDecision: ObservableDecision['finalDecision'], scoreAfter: number, reason = ''): ObservableDecision {
  return {
    memoryId: id,
    scoreBefore: scoreAfter,
    scoreAfter,
    demote: 0,
    boost: 0,
    finalDecision,
    reason,
    source: reason || 'judicious',
    features: {},
    gatesPassed: [],
    gatesFailed: reason ? ['judicious'] : []
  }
}

describe('buildMemoryLedger (Memory Sources, per-answer)', () => {
  it('partitions candidates into used / downranked / suppressed / skipped', () => {
    const hits = [hit('u1', 0.8, 'used memory'), hit('d1', 0.4, 'downranked memory')]
    const decisions = [
      dec('u1', 'allow', 0.8),
      dec('d1', 'demote', 0.4, 'judicious:generic'),
      dec('s1', 'suppress', 0.02, 'user_correction:matched')
      // k1 is in allUserItems but NOT retrieved and NOT decided → lifecycle skipped
    ]
    const ledger = buildMemoryLedger({
      userId: 'alice',
      queryText: 'q',
      hits,
      decisions,
      allUserItems: [mk('u1', 'used memory'), mk('k1', 'skipped memory')]
    })
    expect(ledger.used.map((e) => e.memoryId)).toContain('u1')
    expect(ledger.downranked.map((e) => e.memoryId)).toContain('d1')
    expect(ledger.suppressed.map((e) => e.memoryId)).toContain('s1')
    expect(ledger.skipped.map((e) => e.memoryId)).toContain('k1')
  })

  it('used entries are sorted by score desc and carry reason=vector_match/source_text', () => {
    const hits = [hit('a', 0.5, 'alpha'), hit('b', 0.9, 'beta')]
    const decisions = [dec('a', 'allow', 0.5), dec('b', 'allow', 0.9)]
    const ledger = buildMemoryLedger({ userId: 'alice', queryText: 'q', hits, decisions, allUserItems: [] })
    expect(ledger.used[0]!.memoryId).toBe('b')
    expect(ledger.used[0]!.reason).toBeTruthy()
    expect(ledger.used[0]!.sourceText).toContain('beta')
  })

  it('downranked entries carry the gate reason (e.g. judicious:generic)', () => {
    const ledger = buildMemoryLedger({
      userId: 'alice',
      queryText: 'q',
      hits: [hit('d1', 0.4, 'downranked')],
      decisions: [dec('d1', 'demote', 0.4, 'judicious:generic')],
      allUserItems: []
    })
    expect(ledger.downranked[0]!.reason).toContain('judicious')
  })

  it('marks connector/derived sources with source_type and hides when shared', () => {
    const connHit = hit('c1', 0.7, 'gmail derived')
    connHit.item.metadata.source_type = 'connector'
    const ledger = buildMemoryLedger({
      userId: 'alice',
      queryText: 'q',
      hits: [connHit],
      decisions: [dec('c1', 'allow', 0.7)],
      allUserItems: []
    })
    expect(ledger.used[0]!.sourceType).toBe('connector')
    expect(ledger.used[0]!.hiddenWhenShared).toBe(true)
  })

  it('serializes to a plain dict', () => {
    const ledger = buildMemoryLedger({
      userId: 'alice',
      queryText: 'q',
      hits: [hit('u1', 0.8, 'used')],
      decisions: [dec('u1', 'allow', 0.8)],
      allUserItems: []
    })
    const d = ledger.toDict()
    expect(d.user_id).toBe('alice')
    expect(Array.isArray(d.used)).toBe(true)
  })
})
