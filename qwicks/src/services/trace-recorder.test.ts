import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import type { SessionStore } from '../ports/session-store.js'
import type { EventBus } from '../ports/event-bus.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TraceRecorder } from './trace-recorder.js'

function makeRuntimeRecorder(): { recorder: RuntimeEventRecorder; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = []
  const sessionStore = {
    appendEvent: async (_threadId: string, event: RuntimeEvent) => {
      events.push(event)
    },
    appendItem: async () => undefined,
    rewriteItems: async () => undefined,
    updateItem: async () => null,
    loadEventsSince: async () => [],
    loadItems: async () => [],
    loadSession: async () => null,
    upsertSession: async () => undefined,
    highestSeq: async () => events.at(-1)?.seq ?? 0,
    resetMemory: async () => undefined
  } satisfies SessionStore
  const eventBus = {
    publish: () => undefined,
    subscribe: () => () => undefined,
    snapshotSince: () => [],
    highestSeq: () => events.at(-1)?.seq ?? 0,
    reset: () => undefined
  } satisfies EventBus
  return {
    events,
    recorder: new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: () => events.length + 1,
      nowIso: () => '2026-06-28T00:00:00.000Z'
    })
  }
}

describe('TraceRecorder', () => {
  it('records lightweight span lifecycle events through the runtime event log', async () => {
    const { recorder, events } = makeRuntimeRecorder()
    const trace = new TraceRecorder({
      events: recorder,
      ids: {
        next: (prefix) => `${prefix}_1`
      },
      nowIso: () => '2026-06-28T00:00:00.000Z'
    })

    const turn = await trace.startSpan({
      threadId: 'thread_1',
      turnId: 'turn_1',
      name: 'turn',
      kind: 'turn',
      attrs: { model: 'gpt-5' }
    })
    const child = await trace.startSpan({
      threadId: 'thread_1',
      turnId: 'turn_1',
      parentSpanId: turn.spanId,
      name: 'model.call',
      kind: 'model',
      attrs: { provider: 'openai' }
    })
    await trace.updateSpan(child, { attrs: { promptTokens: 123 } })
    await trace.endSpan(child, { status: 'ok' })
    await trace.endSpan(turn, { status: 'ok' })

    expect(events.map((event) => event.kind)).toEqual([
      'trace_span_started',
      'trace_span_started',
      'trace_span_updated',
      'trace_span_ended',
      'trace_span_ended'
    ])
    expect(events[0]).toMatchObject({
      traceId: turn.traceId,
      spanId: turn.spanId,
      name: 'turn',
      spanKind: 'turn',
      spanStatus: 'running',
      attrs: { model: 'gpt-5' }
    })
    expect(events[1]).toMatchObject({
      traceId: turn.traceId,
      parentSpanId: turn.spanId,
      spanId: child.spanId,
      name: 'model.call',
      spanKind: 'model'
    })
    expect(events[2]).toMatchObject({
      spanId: child.spanId,
      attrs: { promptTokens: 123 }
    })
    expect(events[3]).toMatchObject({
      spanId: child.spanId,
      spanStatus: 'ok',
      endedAt: '2026-06-28T00:00:00.000Z'
    })
  })
})
