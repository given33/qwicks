/**
 * HTTP embedder —— 通过 OpenAI 兼容的 `/embeddings` 端点拿语义向量。
 *
 * 对齐架构决策:不本地加载 BGE-M3(torch 太重),而是调用用户配置的 embedding 服务
 * (可指向本地 Ollama 的 bge-m3 / qwen3-embedding,或任何 OpenAI 兼容 endpoint)。
 * 服务不可用时由 EmbeddingRouter 退化到 HashEmbedder(如允许 cpu fallback)。
 *
 * 实现的是异步 embed(HTTP 天然异步);同步 embed() 不可用(抛错),路由层会按需走 async。
 */
import type { Embedder, EmbeddingHealth } from './base.js'

export interface HttpEmbedderOptions {
  baseUrl: string
  apiKey?: string
  model: string
  dim: number
  /** 注入 fetch(测试用);默认全局 fetch。 */
  fetchImpl?: typeof fetch
  /** 探活/请求超时(ms)。 */
  timeoutMs?: number
  /** 额外 header(如 OpenAI org)。 */
  headers?: Record<string, string>
}

export class HttpEmbedder implements Embedder {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private probeAttempted = false
  private probeOk = false
  private probeError = ''

  constructor(private readonly opts: HttpEmbedderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  name(): string {
    return `http:${this.opts.model}`
  }

  dim(): number {
    return this.opts.dim
  }

  isDegraded(): boolean {
    return false
  }

  strict(): boolean {
    return true
  }

  allowCpuFallback(): boolean {
    return false
  }

  /** 同步 embed 对 HTTP 后端不可用 —— 用 embedAsync。 */
  embed(_text: string): number[] {
    throw new Error('HttpEmbedder is async-only; use embedAsync()')
  }

  embedBatch(_texts: string[]): number[][] {
    throw new Error('HttpEmbedder is async-only; use embedBatchAsync()')
  }

  healthCheck(): EmbeddingHealth {
    return {
      backend: 'http',
      device: 'remote',
      dim: this.opts.dim,
      degraded: this.probeAttempted && !this.probeOk,
      error: this.probeError || undefined,
      loadAttempted: this.probeAttempted,
      probeOk: this.probeOk,
      status: !this.probeAttempted ? 'ok' : this.probeOk ? 'ok' : 'error',
      strict: true,
      allowCpuFallback: false
    }
  }

  /** 探活:发一条最小 embedding 请求,200 即 ok。 */
  async probe(): Promise<boolean> {
    this.probeAttempted = true
    try {
      await this.request(['probe'], { batch: false })
      this.probeOk = true
      this.probeError = ''
      return true
    } catch (err) {
      this.probeOk = false
      this.probeError = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async embedAsync(text: string): Promise<number[]> {
    const [vec] = await this.request([text], { batch: false })
    return vec
  }

  async embedBatchAsync(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    return this.request(texts, { batch: true })
  }

  // ----------------------------------------------------------------

  private async request(
    input: string[],
    _opts: { batch: boolean }
  ): Promise<number[][]> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/embeddings`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
          ...(this.opts.headers ?? {})
        },
        body: JSON.stringify({ model: this.opts.model, input })
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let message = `embeddings HTTP ${res.status}`
      try {
        const j = JSON.parse(text)
        if (j?.error?.message) message = String(j.error.message)
      } catch {
        /* keep default */
      }
      throw new Error(message)
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[] }>
    }
    return json.data.map((d) => d.embedding)
  }
}
