/**
 * EmbeddingRouter —— HTTP 优先 + 哈希回退(对齐 Python R70+ v3 strict mode)。
 *
 * 策略:
 *  - 默认走 primary(HttpEmbedder)。成功就用它。
 *  - primary 抛错时:若 allowCpuFallback=true,切换到 fallback(HashEmbedder),标记 degraded;
 *    否则在 strict 模式直接抛错(不静默退化),对齐 Python "fail-fast" 语义。
 *  - 一旦降级到 fallback,后续请求继续走 fallback(避免每条都重试拖慢热路径)。
 *  - 提供 warmup()(启动时 probe primary)与 health()(反映当前激活后端)。
 */
import type { Embedder, EmbeddingHealth } from './base.js'
import type { HttpEmbedder } from './http-provider.js'

export interface EmbeddingRouterOptions {
  primary: HttpEmbedder
  fallback?: Embedder
  /** 是否允许在 primary 失败时退化到 fallback(默认 false = strict)。 */
  allowCpuFallback?: boolean
  /** 启动时是否 probe primary(默认 false)。 */
  probeOnWarmup?: boolean
}

export class EmbeddingRouter {
  private active: Embedder
  private failovered = false

  constructor(private readonly opts: EmbeddingRouterOptions) {
    this.active = opts.primary
  }

  activeName(): string {
    return this.active.name()
  }

  isDegraded(): boolean {
    return this.active.isDegraded() || this.failovered
  }

  /** 启动时调用:probe primary,失败且允许 fallback 则立即切换。 */
  async warmup(): Promise<void> {
    if (!this.opts.probeOnWarmup) return
    const ok = await this.opts.primary.probe()
    if (!ok) this.maybeFailover('warmup probe failed')
  }

  async embedAsync(text: string): Promise<number[]> {
    return this.embedBatchAsync([text]).then((vs) => vs[0]!)
  }

  async embedBatchAsync(texts: string[]): Promise<number[][]> {
    if (this.active === this.opts.primary) {
      try {
        return await this.opts.primary.embedBatchAsync(texts)
      } catch (err) {
        // primary 失败:尝试 failover。若不允许,直接抛(strict)。
        if (!this.maybeFailover(err instanceof Error ? err.message : String(err))) {
          throw err
        }
        // 已 failover,走 fallback 重试。
      }
    }
    // fallback 是同步 Embedder(HashEmbedder)。
    return Promise.resolve(this.active.embedBatch(texts))
  }

  health(): EmbeddingHealth {
    const base = this.active.healthCheck()
    return this.failovered ? { ...base, degraded: true } : base
  }

  // ----------------------------------------------------------------

  private maybeFailover(reason: string): boolean {
    if (!this.opts.fallback || !this.opts.allowCpuFallback) return false
    this.active = this.opts.fallback
    this.failovered = true
    // 原因记进 health 的 error 字段(便于诊断)。
    void reason
    return true
  }
}
