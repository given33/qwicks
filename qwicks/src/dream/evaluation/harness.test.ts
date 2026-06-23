import { describe, expect, it } from 'vitest'
import { evaluateCase, computeMetrics, type EvalCase, type EvalReport } from './harness.js'

const baseCase: EvalCase = {
  id: 'c1',
  userId: 'alice',
  category: 'carry_forward',
  turns: [
    { role: 'user', content: 'I prefer concise answers' }
  ],
  query: 'what are my preferences',
  goldKeywords: ['concise'],
  negativeKeywords: [],
  expectNoInjection: false
}

describe('evaluateCase (single-case scoring)', () => {
  it('scores a hit when the reply contains a gold keyword', async () => {
    const report = await evaluateCase(baseCase, async () => ({
      reply: 'You prefer concise answers without fluff.',
      routedHits: [],
      contextBlock: 'concise answers',
      newMemories: [],
      injectionDecision: null,
      gateReport: null
    }))
    expect(report.tp).toBe(1)
    expect(report.fp).toBe(0)
  })

  it('scores a false positive when a negative keyword is injected', async () => {
    const report = await evaluateCase(
      { ...baseCase, negativeKeywords: ['vegetarian'] },
      async () => ({
        reply: 'You are a vegetarian who likes concise answers.',
        routedHits: [],
        contextBlock: 'vegetarian',
        newMemories: [],
        injectionDecision: null,
        gateReport: null
      })
    )
    expect(report.fp).toBe(1)
  })

  it('scores a false negative when no gold keyword appears', async () => {
    const report = await evaluateCase(baseCase, async () => ({
      reply: 'I have no information about your preferences.',
      routedHits: [],
      contextBlock: '',
      newMemories: [],
      injectionDecision: null,
      gateReport: null
    }))
    expect(report.fn).toBe(1)
  })

  it('flags stale injection when the query is generic and personal memory is injected', async () => {
    const report = await evaluateCase(
      { ...baseCase, expectNoInjection: true, query: 'how to use Python' },
      async () => ({
        reply: 'Based on your project, you use Python for the backend.',
        routedHits: [{ item: { id: 'm1', content: 'project uses python' } as never, score: 0.5 }],
        contextBlock: 'project uses python',
        newMemories: [],
        injectionDecision: null,
        gateReport: null
      })
    )
    expect(report.staleInjection).toBe(1)
  })
})

describe('computeMetrics (aggregate gate scoring)', () => {
  it('computes precision/recall/f1 from a set of case reports', () => {
    const reports = [
      { caseId: 'c1', tp: 1, fp: 0, fn: 0, staleInjection: 0 },
      { caseId: 'c2', tp: 1, fp: 0, fn: 0, staleInjection: 0 },
      { caseId: 'c3', tp: 0, fp: 1, fn: 1, staleInjection: 1 },
      { caseId: 'c4', tp: 1, fp: 0, fn: 0, staleInjection: 0 }
    ] as EvalReport['cases']
    const m = computeMetrics(reports)
    expect(m.totalCases).toBe(4)
    expect(m.tp).toBe(3)
    expect(m.fp).toBe(1)
    expect(m.fn).toBe(1)
    expect(m.precision).toBeCloseTo(0.75, 2)
    expect(m.recall).toBeCloseTo(0.75, 2)
    expect(m.f1).toBeCloseTo(0.75, 2)
    expect(m.staleInjectionRate).toBeCloseTo(0.25, 2)
  })

  it('returns a Tier-gate verdict (PASS/FAIL) against thresholds', () => {
    const good = computeMetrics([
      { caseId: 'c1', tp: 1, fp: 0, fn: 0, staleInjection: 0 }
    ])
    const verdict = good.tierVerdict({ minF1: 0.85, minRecall: 0.85, maxStaleRate: 0.01 })
    expect(verdict.passed).toBe(true)

    const bad = computeMetrics([
      { caseId: 'c1', tp: 0, fp: 1, fn: 1, staleInjection: 1 }
    ])
    const verdict2 = bad.tierVerdict({ minF1: 0.85, minRecall: 0.85, maxStaleRate: 0.01 })
    expect(verdict2.passed).toBe(false)
  })
})
