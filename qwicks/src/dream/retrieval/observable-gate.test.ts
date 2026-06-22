import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryLifecycleStatus, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import {
  FreshnessBoostGate,
  JudiciousDemoteGate,
  ObservableGate,
  UserCorrectionGate,
  type UserCorrection
} from './observable-gate.js'

function mk(id: string, content: string, score: number, metadata: Record<string, unknown> = {}, status = MemoryLifecycleStatus.ACTIVE): { item: MemoryItem; score: number } {
  return {
    item: new MemoryItem(id, 'alice', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance(), null, null, [], metadata, status),
    score
  }
}

describe('JudiciousDemoteGate', () => {
  it('demotes candidates on a generic question', () => {
    const gate = new JudiciousDemoteGate(-0.1)
    const cand = mk('c1', '在我之前的项目里我用了 Python', 0.8)
    const dec = gate.decide({ candidate: cand, query: 'how to use Python', userId: 'alice' })
    expect(dec.demote).toBe(-0.1)
    expect(dec.scoreAfter).toBeCloseTo(0.7, 5)
    expect(dec.gatesFailed).toContain('judicious')
  })
  it('passes through on a personal query', () => {
    const gate = new JudiciousDemoteGate(-0.1)
    const cand = mk('c1', 'some content', 0.8)
    const dec = gate.decide({ candidate: cand, query: '我的项目怎么部署', userId: 'alice' })
    expect(dec.demote).toBe(0)
    expect(dec.gatesPassed).toContain('judicious')
  })
})

describe('FreshnessBoostGate', () => {
  it('demotes an explicit-correction superseded value', () => {
    const gate = new FreshnessBoostGate(-0.2, 0.1)
    const oldVal = mk('old', 'uses library X', 0.6, { explicit_correction: true })
    const allItems = [oldVal.item, mk('new', 'now uses Y', 0.6).item]
    // make 'old' appear superseded in the pool
    allItems[0]!.status = MemoryLifecycleStatus.SUPERSEDED
    const dec = gate.decide({ candidate: oldVal, query: 'x', userId: 'alice', allUserItems: allItems })
    expect(dec.demote).toBeLessThan(0)
  })
  it('boosts a corrected new value', () => {
    const gate = new FreshnessBoostGate(-0.2, 0.1)
    const newVal = mk('new', 'now uses Y', 0.6, { explicit_correction: true, corrected_to: 'Y' })
    const dec = gate.decide({ candidate: newVal, query: 'x', userId: 'alice' })
    expect(dec.boost).toBe(0.1)
  })
  it('is neutral on a plain memory', () => {
    const gate = new FreshnessBoostGate(-0.2, 0.1)
    const plain = mk('p', 'plain fact', 0.6)
    const dec = gate.decide({ candidate: plain, query: 'x', userId: 'alice' })
    expect(dec.demote).toBe(0)
    expect(dec.boost).toBe(0)
  })
})

describe('UserCorrectionGate', () => {
  it('demotes candidates whose kind matches a recorded correction', () => {
    const gate = new UserCorrectionGate(-0.3)
    const corrections: UserCorrection[] = [
      { userId: 'alice', memoryId: 'x', kind: 'irrelevant', feedback: '', recordedAt: '' }
    ]
    const cand = mk('c1', 'content', 0.8, { kind: 'irrelevant' })
    const dec = gate.decide({ candidate: cand, query: 'q', userId: 'alice', userCorrections: corrections })
    expect(dec.demote).toBe(-0.3)
  })
  it('is neutral when there are no corrections', () => {
    const gate = new UserCorrectionGate(-0.3)
    const cand = mk('c1', 'content', 0.8)
    const dec = gate.decide({ candidate: cand, query: 'q', userId: 'alice', userCorrections: [] })
    expect(dec.demote).toBe(0)
  })
})

describe('ObservableGate orchestrator', () => {
  it('runs all gates, aggregates per-candidate decisions into a GateReport', () => {
    const gate = new ObservableGate()
      .add(new JudiciousDemoteGate(-0.1))
      .add(new FreshnessBoostGate(-0.2, 0.1))
      .add(new UserCorrectionGate(-0.3))
    const candidates = [
      mk('c1', '我的项目里我用了 Python', 0.8),
      mk('c2', 'plain fact', 0.4)
    ]
    const report = gate.run({ userId: 'alice', query: 'how to use Python', candidates })
    expect(report.candidateCount).toBe(2)
    expect(report.decisions).toHaveLength(2)
    // c1 should be demoted (generic question + personal content)
    const c1 = report.decisions.find((d) => d.memoryId === 'c1')!
    expect(c1.demote).toBeLessThan(0)
    expect(['demote', 'suppress', 'allow']).toContain(c1.finalDecision)
    // reason_counts / source_counts are populated
    expect(Object.keys(report.reasonCounts).length + Object.keys(report.sourceCounts).length).toBeGreaterThan(0)
  })

  it('classifies a near-zero score_after as suppressed', () => {
    const gate = new ObservableGate().add(new JudiciousDemoteGate(-1.0))
    const cand = mk('c1', '在我项目里用了 Python', 0.05)
    const report = gate.run({ userId: 'alice', query: 'how to use Python', candidates: [cand] })
    expect(report.decisions[0]!.finalDecision).toBe('suppress')
    expect(report.suppressedCount).toBe(1)
  })

  it('recordCorrection feeds subsequent gate runs', () => {
    const gate = new ObservableGate().add(new UserCorrectionGate(-0.3))
    gate.recordCorrection({ userId: 'alice', memoryId: 'm', kind: 'irrelevant', feedback: '', recordedAt: '' })
    expect(gate.getCorrections('alice')).toHaveLength(1)
    const cand = mk('c1', 'content', 0.8, { kind: 'irrelevant' })
    const report = gate.run({ userId: 'alice', query: 'q', candidates: [cand] })
    expect(report.userCorrectionCount).toBe(1)
    expect(report.decisions[0]!.demote).toBe(-0.3)
  })
})
