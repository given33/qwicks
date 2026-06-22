import { describe, expect, it } from 'vitest'
import { HashEmbedder } from './hash-provider.js'
import { HttpEmbedder } from './http-provider.js'
import { EmbeddingRouter } from './router.js'

function okFetch(dim: number) {
  return async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        model: 'bge-m3',
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: dim }, (_, i) => i / dim) }],
        usage: { prompt_tokens: 1, total_tokens: 1 }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
}

describe('EmbeddingRouter (HTTP -> hash fallback)', () => {
  it('uses the primary embedder when it is healthy', async () => {
    const http = new HttpEmbedder({
      baseUrl: 'http://x/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl: okFetch(4)
    })
    const hash = new HashEmbedder({ dim: 4 })
    const router = new EmbeddingRouter({ primary: http, fallback: hash })
    expect(router.activeName()).toBe('http:bge-m3')
    const vec = await router.embedAsync('hello')
    expect(vec).toHaveLength(4)
    expect(router.activeName()).toBe('http:bge-m3') // stayed on primary
  })

  it('falls back to hash when the primary throws and cpu fallback is allowed', async () => {
    const http = new HttpEmbedder({
      baseUrl: 'http://x/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 })
    })
    // HashEmbedder clamps dim to a 64 minimum; that's its contract.
    const hash = new HashEmbedder({ dim: 4 })
    const router = new EmbeddingRouter({ primary: http, fallback: hash, allowCpuFallback: true })
    const vec = await router.embedAsync('hello')
    expect(vec).toHaveLength(64) // hash fallback's clamped dim
    expect(router.activeName()).toBe('dream.hash-bow.v1') // fell over to hash
    expect(router.isDegraded()).toBe(true)
  })

  it('throws (does NOT silently degrade) when strict and no fallback allowed', async () => {
    const http = new HttpEmbedder({
      baseUrl: 'http://x/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 })
    })
    const router = new EmbeddingRouter({ primary: http, allowCpuFallback: false })
    await expect(router.embedAsync('hello')).rejects.toThrow(/down/)
    expect(router.activeName()).toBe('http:bge-m3') // never fell over
  })

  it('embedBatchAsync routes through the active embedder', async () => {
    const http = new HttpEmbedder({
      baseUrl: 'http://x/v1',
      model: 'bge-m3',
      dim: 3,
      fetchImpl: async (_input, init?) => {
        const n = JSON.parse(String(init!.body)).input.length
        return new Response(
          JSON.stringify({
            model: 'bge-m3',
            object: 'list',
            data: Array.from({ length: n }, (_, i) => ({ object: 'embedding', index: i, embedding: [0.1, 0.2, 0.3] })),
            usage: { prompt_tokens: n, total_tokens: n }
          }),
          { status: 200 }
        )
      }
    })
    const router = new EmbeddingRouter({ primary: http, fallback: new HashEmbedder({ dim: 3 }) })
    const out = await router.embedBatchAsync(['a', 'b'])
    expect(out).toHaveLength(2)
  })

  it('exposes a health snapshot reflecting the active backend', async () => {
    const http = new HttpEmbedder({
      baseUrl: 'http://x/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 500 })
    })
    const router = new EmbeddingRouter({ primary: http, fallback: new HashEmbedder({ dim: 4 }), allowCpuFallback: true })
    await router.embedAsync('x') // triggers failover
    const h = router.health()
    expect(h.degraded).toBe(true)
    expect(h.backend).toBe('hash-bow')
  })
})
