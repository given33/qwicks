import type { TraceSpanEvent, TraceSpanKind, TraceSpanStatus } from '../contracts/events.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'

export type TraceSpan = {
  threadId: string
  turnId?: string
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: TraceSpanKind
  status: TraceSpanStatus
  startedAt: string
  endedAt?: string
  attrs?: Record<string, unknown>
}

export type TraceRecorderOptions = {
  events: RuntimeEventRecorder
  ids: IdGenerator
  nowIso: () => string
}

export class TraceRecorder {
  private readonly options: TraceRecorderOptions
  private readonly rootSpanByTurnId = new Map<string, TraceSpan>()

  constructor(options: TraceRecorderOptions) {
    this.options = options
  }

  getTurnSpan(turnId: string | undefined): TraceSpan | undefined {
    return turnId ? this.rootSpanByTurnId.get(turnId) : undefined
  }

  async startSpan(input: {
    threadId: string
    turnId?: string
    traceId?: string
    parentSpanId?: string
    name: string
    kind: TraceSpanKind
    attrs?: Record<string, unknown>
  }): Promise<TraceSpan> {
    const inherited = input.turnId ? this.rootSpanByTurnId.get(input.turnId) : undefined
    const now = this.options.nowIso()
    const span: TraceSpan = {
      threadId: input.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      traceId: input.traceId ?? inherited?.traceId ?? this.options.ids.next('trace'),
      spanId: this.options.ids.next('span'),
      ...(input.parentSpanId ?? inherited?.spanId ? { parentSpanId: input.parentSpanId ?? inherited?.spanId } : {}),
      name: input.name,
      kind: input.kind,
      status: 'running',
      startedAt: now,
      ...(input.attrs ? { attrs: input.attrs } : {})
    }
    if (input.kind === 'turn' && input.turnId) this.rootSpanByTurnId.set(input.turnId, span)
    await this.record(span, 'trace_span_started')
    return span
  }

  async updateSpan(span: TraceSpan | undefined, patch: {
    status?: TraceSpanStatus
    attrs?: Record<string, unknown>
  }): Promise<void> {
    if (!span) return
    const next: TraceSpan = {
      ...span,
      status: patch.status ?? span.status,
      attrs: mergeAttrs(span.attrs, patch.attrs)
    }
    Object.assign(span, next)
    await this.record(next, 'trace_span_updated')
  }

  async endSpan(span: TraceSpan | undefined, patch: {
    status?: Exclude<TraceSpanStatus, 'running'>
    attrs?: Record<string, unknown>
  } = {}): Promise<void> {
    if (!span) return
    const endedAt = this.options.nowIso()
    const next: TraceSpan = {
      ...span,
      status: patch.status ?? 'ok',
      endedAt,
      attrs: mergeAttrs(span.attrs, patch.attrs)
    }
    Object.assign(span, next)
    await this.record(next, 'trace_span_ended')
    if (span.kind === 'turn' && span.turnId) this.rootSpanByTurnId.delete(span.turnId)
  }

  async withSpan<T>(
    input: {
      threadId: string
      turnId?: string
      parentSpanId?: string
      name: string
      kind: TraceSpanKind
      attrs?: Record<string, unknown>
    },
    run: (span: TraceSpan) => Promise<T>
  ): Promise<T> {
    const span = await this.startSpan(input)
    try {
      const result = await run(span)
      await this.endSpan(span, { status: 'ok' })
      return result
    } catch (error) {
      await this.endSpan(span, {
        status: isAbortError(error) ? 'aborted' : 'error',
        attrs: { error: error instanceof Error ? error.message : String(error) }
      })
      throw error
    }
  }

  private async record(span: TraceSpan, kind: TraceSpanEvent['kind']): Promise<void> {
    await this.options.events.record({
      kind,
      threadId: span.threadId,
      ...(span.turnId ? { turnId: span.turnId } : {}),
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      spanKind: span.kind,
      spanStatus: span.status,
      startedAt: span.startedAt,
      ...(span.endedAt ? { endedAt: span.endedAt } : {}),
      ...(span.attrs ? { attrs: span.attrs } : {})
    })
  }
}

function mergeAttrs(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!current && !patch) return undefined
  return { ...(current ?? {}), ...(patch ?? {}) }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) return /abort/i.test(error.message)
  return /abort/i.test(String(error))
}
