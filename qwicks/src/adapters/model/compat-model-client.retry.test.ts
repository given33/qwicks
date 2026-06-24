import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Transient upstream gateway failures (502/503/504 from a load balancer) are
// momentary backend hiccups, not request errors. The client retries them a few
// times before failing the turn — see streamInner's transient-retry loop.

function request(signal?: AbortSignal): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'glm-5.1',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: signal ?? new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function okJson(): Response {
  return new Response(
    JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

// Mirrors the real ALB 502 the user hit: HTML body, not JSON.
function gatewayError(status: number): Response {
  return new Response(
    `<html><head><title>${status}</title></head><body><center>${status}</center><center>alb</center></body></html>`,
    { status, headers: { 'content-type': 'text/html' } }
  )
}

function client(fetchImpl: typeof fetch): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-test',
    model: 'glm-5.1',
    endpointFormat: 'chat_completions',
    nonStreaming: true,
    fetchImpl
  })
}

describe('CompatModelClient transient gateway retry', () => {
  it('retries a 502 Bad Gateway and then succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? gatewayError(502) : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(2)
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })

  // Connection-level retry now covers ALL errors (not just transient gateways):
  // a persistent 500 is retried MODEL_CONNECT_MAX_RETRIES times, emitting a
  // model_retry chunk before each attempt, before surfacing the classified error.
  it('retries a persistent 500 up to MODEL_CONNECT_MAX_RETRIES times', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return gatewayError(500)
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(5)
    const retries = chunks.filter((c) => c.kind === 'model_retry')
    expect(retries).toHaveLength(4)
    expect(retries[0]).toMatchObject({ kind: 'model_retry', attempt: 1, maxAttempts: 5 })
    expect(chunks.some((c) => c.kind === 'error')).toBe(true)
  }, 60_000)

  it('stops retrying when the request is aborted during backoff', async () => {
    const controller = new AbortController()
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      // Abort while the (failed) response is in hand, so the backoff sees it.
      controller.abort()
      return gatewayError(503)
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request(controller.signal)))

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(true)
  })
})

describe('CompatModelClient connection retry (all errors)', () => {
  // 5 attempts: the first 4 failures each emit a model_retry announcing the
  // upcoming retry; the 5th (final) attempt fails and surfaces the error
  // without another retry. So full-failure = 4 retry events.
  // Full-failure retries take ~31s of backoff (1+2+4+8+16); allow headroom.
  it('retries network errors 5 times before yielding a final error', async () => {
    const fetchImpl = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    const retries = chunks.filter((c) => c.kind === 'model_retry')
    const errors = chunks.filter((c) => c.kind === 'error')
    expect(retries).toHaveLength(4)
    expect(retries[0]).toMatchObject({ kind: 'model_retry', attempt: 1, maxAttempts: 5 })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ kind: 'error' })
  }, 60_000)

  it('retries an HTTP 404 5 times before yielding the classified error', async () => {
    const fetchImpl = (async () =>
      new Response('Not Found', { status: 404 })) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    const retries = chunks.filter((c) => c.kind === 'model_retry')
    expect(retries).toHaveLength(4)
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'http_404' })
  }, 60_000)

  it('recovers when a later retry succeeds and streams the response', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls < 3) return gatewayError(500)
      return okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    const retries = chunks.filter((c) => c.kind === 'model_retry')
    expect(retries).toHaveLength(2) // first two failures each emit a retry
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })
})
