/**
 * 纯 TS hashed bag-of-words embedder。1:1 对齐 Python `dream/embeddings/base.py`
 * 的 `HashEmbedder`:作为离线 / 测试 / 无依赖回退方案。
 *
 * 算法:
 *  - 混合 tokenizer:英文/数字连续块按完整词(小写,长度≥2);中文按单字 + 滑窗 bigram。
 *  - 向量化:sha1(token) 取前 4 字节映射到 dim 维,sign 由第 5 字节奇偶决定,累加后 L2 归一化。
 *  - content-hash cache:同一段文本复用结果;满了直接清空(简易 LRU,对齐 Python)。
 */
import { createHash } from 'node:crypto'
import type { Embedder, EmbeddingHealth } from './base.js'

export interface HashEmbedderOptions {
  dim?: number
  cacheMax?: number
}

export class HashEmbedder implements Embedder {
  private readonly dimValue: number
  private readonly cache: Map<string, number[]> = new Map()
  private cacheHits = 0
  private cacheMisses = 0
  private readonly cacheMax: number

  constructor(opts: HashEmbedderOptions = {}) {
    this.dimValue = Math.max(64, opts.dim ?? 384)
    this.cacheMax = opts.cacheMax ?? 4096
  }

  name(): string {
    return 'dream.hash-bow.v1'
  }

  dim(): number {
    return this.dimValue
  }

  isDegraded(): boolean {
    // HashEmbedder 永远不是真模型,当作 degraded 报告(对齐 Python)。
    return true
  }

  strict(): boolean {
    return false
  }

  allowCpuFallback(): boolean {
    return true
  }

  cacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.cacheHits, misses: this.cacheMisses, size: this.cache.size }
  }

  telemetry(): Record<string, number> {
    return { ...this.cacheStats() }
  }

  embed(text: string): number[] {
    const cached = this.cache.get(text)
    if (cached !== undefined) {
      this.cacheHits += 1
      return cached
    }
    const vec = this.vector(this.tokenize(text))
    // 简易 LRU:满了直接清空,避免无限增长(对齐 Python)。
    if (this.cache.size >= this.cacheMax) this.cache.clear()
    this.cache.set(text, vec)
    this.cacheMisses += 1
    return vec
  }

  embedBatch(texts: string[]): number[][] {
    // 走 embed() 单条路径,命中 content-hash cache(对齐 Python embed_batch)。
    return texts.map((t) => this.embed(t))
  }

  healthCheck(_opts?: { probe?: boolean }): EmbeddingHealth {
    return {
      backend: 'hash-bow',
      device: 'cpu',
      dim: this.dimValue,
      degraded: true,
      error: 'HashEmbedder is a deterministic BoW fallback, not a real model',
      loadAttempted: false,
      probeOk: false,
      status: 'degraded',
      strict: true,
      allowCpuFallback: true
    }
  }

  // ----------------------------------------------------------------
  // 私有:tokenizer + 向量化(对齐 Python _tokenize / _vector)
  // ----------------------------------------------------------------

  private tokenize(text: string): string[] {
    const out: string[] = []
    // 1) 英文/数字连续块 → 完整词(小写,长度≥2)
    for (const m of text.match(/[A-Za-z0-9]+/g) ?? []) {
      const tok = m.toLowerCase()
      if (tok.length >= 2) out.push(tok)
    }
    // 2) 中文字符(CJK Unified Ideographs) → 单字 + 滑窗 bigram
    for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
      const chars = Array.from(run)
      if (chars.length === 0) continue
      for (const c of chars) out.push(c)
      for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i]! + chars[i + 1]!)
    }
    return out
  }

  private vector(tokens: string[]): number[] {
    const vec = new Array<number>(this.dimValue).fill(0)
    for (const tok of tokens) {
      const h = createHash('sha1').update(tok, 'utf8').digest()
      const idx = h.readUInt32BE(0) % this.dimValue
      const sign = (h[4]! & 1) === 0 ? 1 : -1
      vec[idx] += sign
    }
    let norm = 0
    for (const v of vec) norm += v * v
    norm = Math.sqrt(norm)
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm
    return vec
  }
}
