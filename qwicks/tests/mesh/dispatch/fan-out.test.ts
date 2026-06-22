import { describe, it, expect, vi } from 'vitest'
import { createFanOutDispatcher } from '@qwicks/mesh/dispatch/fan-out.js'
import type { TaskRunParams, ChildRunResult } from '@qwicks/mesh/contracts.js'

function result(over: Partial<ChildRunResult> = {}): ChildRunResult {
  return {
    summary: 'ok',
    status: 'completed',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    ...over
  }
}

function slow(ms: number, value: ChildRunResult, capture?: (p: TaskRunParams) => void) {
  return (params: TaskRunParams): Promise<ChildRunResult> =>
    new Promise((resolve) => {
      capture?.(params)
      setTimeout(() => resolve(value), ms)
    })
}

describe('createFanOutDispatcher (RFC 008 §4.2)', () => {
  it('race mode returns the first completed result', async () => {
    const runRemote = vi.fn(slow(20, result({ summary: 'fast' })))
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    const out = await dispatch({
      taskId: 't1',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }],
      mode: 'race',
      signal: new AbortController().signal
    })

    expect(out.mode).toBe('race')
    expect(out.results).toHaveLength(1)
    expect(out.results[0].summary).toBe('fast')
  })

  it('race mode cancels the slower worker after a winner is found', async () => {
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    const runRemote = vi.fn(slow(50, result(), (p) => { /* capture */ }))
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      cancelRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    await dispatch({
      taskId: 't2',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }],
      mode: 'race',
      signal: new AbortController().signal
    })

    // Each fan-out task gets its own id; the loser is cancelled by taskId.
    expect(cancelRemote).toHaveBeenCalled()
    const cancelledIds = cancelRemote.mock.calls.map((c) => c[0] as string)
    expect(cancelledIds.some((id) => id.startsWith('t2-fanout-'))).toBe(true)
  })

  it('all mode aggregates every result', async () => {
    const runRemote = vi.fn(async (params: TaskRunParams) => {
      // Return a per-worker summary to verify aggregation
      const idx = Number(params.taskId.split('-').pop())
      return result({ summary: `worker-${idx}` })
    })
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    const out = await dispatch({
      taskId: 't3',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }, { deviceId: 'w3' }],
      mode: 'all',
      signal: new AbortController().signal
    })

    expect(out.mode).toBe('all')
    expect(out.results).toHaveLength(3)
    expect(out.complete).toBe(true)
  })

  it('race mode falls back to collecting all when first result errors', async () => {
    const runRemote = vi.fn(async (params: TaskRunParams) => {
      const idx = Number(params.taskId.split('-').pop())
      if (idx === 0) throw new Error('worker-0 failed')
      return result({ summary: `worker-${idx}` })
    })
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    const out = await dispatch({
      taskId: 't4',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }],
      mode: 'race',
      signal: new AbortController().signal
    })

    expect(out.mode).toBe('all') // fell back
    expect(out.results.length).toBeGreaterThan(0)
  })

  it('assigns a unique per-worker idempotency key', async () => {
    const captured: TaskRunParams[] = []
    const runRemote = vi.fn(async (params: TaskRunParams) => {
      captured.push(params)
      return result()
    })
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    await dispatch({
      taskId: 't5',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }],
      mode: 'all',
      signal: new AbortController().signal
    })

    const keys = captured.map((p) => p.idempotencyKey)
    expect(new Set(keys).size).toBe(2)
  })

  it('marks the result as incomplete in all mode if a worker is missing', async () => {
    const runRemote = vi.fn(async (params: TaskRunParams) => {
      const idx = Number(params.taskId.split('-').pop())
      if (idx === 1) throw new Error('failed')
      return result()
    })
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    const out = await dispatch({
      taskId: 't6',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1' }, { deviceId: 'w2' }, { deviceId: 'w3' }],
      mode: 'all',
      signal: new AbortController().signal
    })

    expect(out.complete).toBe(false)
    expect(out.results.length).toBeLessThan(3)
  })

  it('propagates the per-worker model when supplied', async () => {
    const captured: TaskRunParams[] = []
    const runRemote = vi.fn(async (params: TaskRunParams) => {
      captured.push(params)
      return result()
    })
    const dispatch = createFanOutDispatcher({
      selfDeviceId: 'd-a',
      runRemote,
      lease: { leaseTimeout: 300, heartbeatInterval: 75 }
    })

    await dispatch({
      taskId: 't7',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers: [{ deviceId: 'w1', model: 'qwen2.5-7b' }, { deviceId: 'w2', model: 'deepseek-r1' }],
      mode: 'all',
      signal: new AbortController().signal
    })

    expect(captured.map((p) => p.model).sort()).toEqual(['deepseek-r1', 'qwen2.5-7b'])
  })
})
