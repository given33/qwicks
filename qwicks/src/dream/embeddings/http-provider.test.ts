import { describe, expect, it } from 'vitest'
import { HttpEmbedder } from './http-provider.js'

function makeFetch(dim: number, ok = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init?) => {
    calls.push({ url: String(input), init })
    const body = ok
      ? JSON.stringify({
          model: 'bge-m3',
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: dim }, (_, i) => i / dim) }],
          usage: { prompt_tokens: 4, total_tokens: 4 }
        })
      : JSON.stringify({ error: { message: 'boom' } })
    return new Response(body, {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetchImpl, calls }
}

describe('HttpEmbedder (OpenAI-compatible /embeddings)', () => {
  it('reports name + dim from config', () => {
    const e = new HttpEmbedder({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      model: 'bge-m3',
      dim: 8,
      fetchImpl: makeFetch(8).fetchImpl
    })
    expect(e.name()).toBe('http:bge-m3')
    expect(e.dim()).toBe(8)
    expect(e.isDegraded()).toBe(false)
    expect(e.strict()).toBe(true)
  })

  it('embed calls POST {baseUrl}/embeddings with bearer auth and returns the vector', async () => {
    const { fetchImpl, calls } = makeFetch(4)
    const e = new HttpEmbedder({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      model: 'bge-m3',
      dim: 4,
      fetchImpl
    })
    const vec = await e.embedAsync('hello')
    expect(vec).toHaveLength(4)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.example.com/v1/embeddings')
    const sent = JSON.parse(String(calls[0]!.init!.body))
    expect(sent.model).toBe('bge-m3')
    expect(sent.input).toEqual(['hello'])
    expect(calls[0]!.init!.headers).toMatchObject({
      authorization: 'Bearer sk-x',
      'content-type': 'application/json'
    })
  })

  it('probe returns ok=true when the endpoint responds 200', async () => {
    const { fetchImpl } = makeFetch(4)
    const e = new HttpEmbedder({
      baseUrl: 'http://localhost:11434/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl
    })
    const ok = await e.probe()
    expect(ok).toBe(true)
  })

  it('probe returns ok=false on a 500 and records the error in health', async () => {
    const { fetchImpl } = makeFetch(4, false)
    const e = new HttpEmbedder({
      baseUrl: 'http://localhost:11434/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl
    })
    expect(await e.probe()).toBe(false)
    const h = e.healthCheck()
    expect(h.status).toBe('error')
    expect(h.probeOk).toBe(false)
    expect(h.error).toBeTruthy()
  })

  it('embedAsync throws on a non-200 response with the server message', async () => {
    const { fetchImpl } = makeFetch(4, false)
    const e = new HttpEmbedder({
      baseUrl: 'http://localhost:11434/v1',
      model: 'bge-m3',
      dim: 4,
      fetchImpl
    })
    await expect(e.embedAsync('x')).rejects.toThrow(/boom/)
  })

  it('embedBatch sends a single batched request and returns N vectors', async () => {
    let captured: string[] | string | null = null
    const fetchImpl: typeof fetch = async (_input, init?) => {
      captured = JSON.parse(String(init!.body)).input
      const n = Array.isArray(captured) ? captured.length : 1
      return new Response(
        JSON.stringify({
          model: 'bge-m3',
          object: 'list',
          data: Array.from({ length: n }, (_, i) => ({
            object: 'embedding',
            index: i,
            embedding: [0.1, 0.2, 0.3]
          })),
          usage: { prompt_tokens: n, total_tokens: n }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    const e = new HttpEmbedder({
      baseUrl: 'http://localhost:11434/v1',
      model: 'bge-m3',
      dim: 3,
      fetchImpl
    })
    const out = await e.embedBatchAsync(['a', 'b', 'c'])
    expect(out).toHaveLength(3)
    expect(captured).toEqual(['a', 'b', 'c'])
  })
})
