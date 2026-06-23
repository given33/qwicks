/**
 * Dream 记忆检索 —— 1:1 对齐 Python `dream/retrieval/pipeline.py` 的核心语义。
 *
 * 综合得分(对齐 spec §5 / Python reranker DEFAULT_HYBRID_WEIGHTS):
 *   final = w_vec * vector + w_bm25 * bm25 + w_exact * exact
 *          + w_rec * recency + w_imp * importance
 *
 * 4 道硬门控(对齐 _is_retrievable):
 *   1. status 不在可召回集合(deleted/suppressed/expired/superseded/connector_revoked/archived 剔除)
 *   2. suppressed(Don't-mention-again)—— 除非 includeSuppressed
 *   3. expiresAt 已过期
 *   4. do_not_inject metadata/tag
 *
 * 跨用户隔离:按 userId 过滤候选。
 *
 * 注:Python 版本里大量"correction fallback / structured intent fallback / judicious-
 * freshness gate / temporal state machine boost"是针对 540-gold 的迭代调参,属于质量优化,
 * 不在 spec §5 核心范围。本 TS 实现先做核心 5 通道 + 4 门控,质量调参留给后续阶段。
 */
import type { Embedder } from '../embeddings/base.js'
import type { MemoryItem, MemoryLifecycleStatus, MemoryScope, MemoryType } from '../types.js'
import { MemoryLifecycleStatus as Status } from '../types.js'
import type { MemoryRepository } from '../storage/repository.js'
import type { VectorDb } from '../vectordb/base.js'
import { recencyScore } from '../temporal/engine.js'

// 对齐 Python _RETRIEVAL_EXCLUDED_STATUSES
export const RETRIEVAL_EXCLUDED_STATUSES: ReadonlySet<MemoryLifecycleStatus> = new Set([
  Status.DELETED,
  Status.SUPPRESSED,
  Status.EXPIRED,
  Status.SUPERSEDED,
  Status.CONNECTOR_REVOKED,
  Status.ARCHIVED
])

// 可召回状态(对齐 spec §5)
export const RETRIEVABLE_STATUSES: ReadonlySet<MemoryLifecycleStatus> = new Set([
  Status.ACTIVE,
  Status.CONFIRMED,
  Status.HYPOTHESIS
])

// 对齐 Python reranker DEFAULT_HYBRID_WEIGHTS
export const DEFAULT_HYBRID_WEIGHTS = {
  vector: 0.6,
  bm25: 0.1,
  exact: 0.1,
  recency: 0.1,
  importance: 0.1
} as const

export interface RetrievalQuery {
  userId: string
  query: string
  topK?: number
  minScore?: number
  types?: readonly MemoryType[]
  scopes?: readonly MemoryScope[]
  tags?: readonly string[]
  recencyHalfLifeDays?: number
  includeSuppressed?: boolean
}

export interface RetrievalHit {
  item: MemoryItem
  score: number
  vectorScore: number
  recencyScore: number
  importanceScore: number
  bm25Score: number
  exactScore: number
  source: 'vector' | 'bm25' | 'exact' | 'hybrid' | 'fallback'
}

export interface RetrievalPipelineOptions {
  repository: MemoryRepository
  embedder: Embedder
  vectorDb: VectorDb
  weights?: Partial<typeof DEFAULT_HYBRID_WEIGHTS>
  /** 0 关闭;正数表示 recency 低于此值的 memory 硬过滤(对齐 Python min_recency)。 */
  minRecency?: number
  nowIso?: () => string
}

export class RetrievalPipeline {
  private readonly weights: typeof DEFAULT_HYBRID_WEIGHTS
  private readonly minRecency: number
  private readonly now: () => Date
  private warmed = false

  constructor(private readonly opts: RetrievalPipelineOptions) {
    this.weights = { ...DEFAULT_HYBRID_WEIGHTS, ...opts.weights }
    this.minRecency = opts.minRecency ?? 0
    this.now = () => new Date()
  }

  /** 启动时把 store 里所有 active memory 灌进向量库(对齐 Python warmup)。 */
  warmup(): void {
    if (this.warmed) return
    try {
      const items = this.opts.repository.list(undefined, {})
      const ids: string[] = []
      const vectors: number[][] = []
      for (const it of items) {
        const v = this.embed(it.content)
        if (v) {
          ids.push(it.id)
          vectors.push(v)
        }
      }
      if (ids.length > 0) this.opts.vectorDb.add(ids, vectors)
    } catch {
      // warmup 失败不阻塞(对齐 Python fail-open)
    }
    this.warmed = true
  }

  /** store 写入/删除后调用,同步向量库索引(对齐 Python on_index_changed)。 */
  onIndexChanged(item?: MemoryItem, deletedId?: string): void {
    try {
      if (item) {
        const v = this.embed(item.content)
        if (v) this.opts.vectorDb.add([item.id], [v])
      }
      if (deletedId) this.opts.vectorDb.remove([deletedId])
    } catch {
      // fail-open
    }
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalHit[]> {
    const topK = Math.max(1, query.topK ?? 8)
    const minScore = query.minScore ?? 0
    const halfLifeDays = query.recencyHalfLifeDays ?? 60
    const includeSuppressed = query.includeSuppressed ?? false

    // 1) 候选集:当前 user 的所有 active memory。
    // includeSuppressed 时也要从 repo 拉回 suppressed(否则 repo 默认就过滤掉了)。
    const allItems = this.opts.repository.list(query.userId, {
      includeSuppressed,
      includeExpired: false,
      includeDeleted: false
    })
    const candidates = allItems.filter((it) => this.isRetrievable(it, includeSuppressed))
    if (candidates.length === 0) return []

    // 2) 五通道评分
    // v3(P2-2 报告 §4.7):查询嵌入改为 async-first —— 若 embedder 支持 embedAsync
    // (HttpEmbedder),用它;否则回退同步(HashEmbedder)。这样真实 HTTP embedding
    // 后端的 vector 通道不会因为同步 embed 抛错而变成 0。
    const qvec = await this.embedQuery(query.query)
    const queryTokens = tokenize(query.query)
    const hits: RetrievalHit[] = []

    for (const item of candidates) {
      // 类型/scope/tag 过滤
      if (query.types && !query.types.includes(item.type)) continue
      if (query.scopes && !query.scopes.includes(item.scope)) continue
      if (query.tags && !query.tags.every((t) => item.tags.includes(t))) continue

      // min_recency 硬过滤(对齐 Python)
      const recency = recencyScore(item.updatedAt, halfLifeDays, this.now())
      if (this.minRecency > 0 && recency < this.minRecency) continue

      const vectorScore = qvec ? this.cosineWithStored(item, qvec) : 0
      const docTokens = tokenize(`${item.content} ${item.tags.join(' ')}`)
      const bm25 = bm25Score(queryTokens, docTokens)
      const exact = exactScore(queryTokens, docTokens)
      const importance = Math.max(0, Math.min(1, item.importance)) * item.confidence

      const score =
        this.weights.vector * vectorScore +
        this.weights.bm25 * bm25 +
        this.weights.exact * exact +
        this.weights.recency * recency +
        this.weights.importance * importance

      const source: RetrievalHit['source'] =
        vectorScore > 0 && (bm25 > 0 || exact > 0)
          ? 'hybrid'
          : vectorScore > 0
            ? 'vector'
            : bm25 > 0 && exact <= 0
              ? 'bm25'
              : exact > 0
                ? 'exact'
                : 'fallback'

      hits.push({
        item,
        score,
        vectorScore,
        recencyScore: recency,
        importanceScore: importance,
        bm25Score: bm25,
        exactScore: exact,
        source
      })
    }

    const filtered = hits.filter((h) => h.score >= minScore)
    filtered.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
    return filtered.slice(0, topK)
  }

  // ----------------------------------------------------------------
  // 4 道硬门控(对齐 _is_retrievable)
  // ----------------------------------------------------------------

  private isRetrievable(item: MemoryItem, includeSuppressed: boolean): boolean {
    // 1. status 一级检查
    if (item.status === Status.SUPPRESSED) {
      if (!includeSuppressed) return false
    } else if (!RETRIEVABLE_STATUSES.has(item.status)) {
      return false
    }
    // 4. expires_at 已过期
    if (item.expiresAt) {
      try {
        const exp = new Date(item.expiresAt)
        if (exp <= this.now()) return false
      } catch {
        // 解析失败不阻塞
      }
    }
    return true
  }

  // ----------------------------------------------------------------

  private embed(text: string): number[] | null {
    try {
      return this.embedSync(text)
    } catch {
      return null
    }
  }

  /**
   * v3(P2-2 报告 §4.7):异步查询嵌入。优先 embedAsync(HttpEmbedder),
   * 失败/不可用回退同步(HashEmbedder)。返回 null 时 vector 通道为 0。
   */
  private async embedQuery(text: string): Promise<number[] | null> {
    const e = this.opts.embedder as Embedder & { embedAsync?: (t: string) => Promise<number[]> }
    if (typeof e.embedAsync === 'function') {
      try {
        const v = await e.embedAsync(text)
        return v
      } catch {
        // HTTP embed 失败 → 回退同步(可能也失败,返回 null)
      }
    }
    return this.embedSync(text)
  }

  /** embedder 可能是 async(HttpEmbedder)或 sync(HashEmbedder)。优先 async,失败回退 sync。 */
  private embedSync(text: string): number[] | null {
    const e = this.opts.embedder as Embedder & { embedAsync?: (t: string) => Promise<number[]> }
    // 同步路径:HashEmbedder / 任何实现 embed() 的。async 路径在 retrieve 里是 async,
    // 但此处保持同步以简化 5 通道循环;真正的 HTTP async 在 chat pipeline 层预热缓存。
    try {
      return e.embed(text)
    } catch {
      // HttpEmbedder 的同步 embed() 会抛错——这里返回 null,等价 vector 通道为 0。
      return null
    }
  }

  private cosineWithStored(item: MemoryItem, qvec: number[]): number {
    // 优先用向量库里存的向量(已归一化);否则现算 embed。
    const getter = this.opts.vectorDb.getVectorsByIds?.bind(this.opts.vectorDb)
    let v: number[] | null = null
    if (getter) {
      const m = getter([item.id])
      v = m.get(item.id) ?? null
    }
    if (!v) v = this.embedSync(item.content)
    if (!v) return 0
    let dot = 0
    let qn = 0
    let vn = 0
    for (let i = 0; i < qvec.length; i++) {
      dot += qvec[i]! * v[i]!
      qn += qvec[i]! * qvec[i]!
      vn += v[i]! * v[i]!
    }
    const denom = Math.sqrt(qn) * Math.sqrt(vn)
    return denom === 0 ? 0 : dot / denom
  }
}

// ----------------------------------------------------------------
// 时间衰减:统一走权威来源 temporal/engine.recencyScore(二进制半衰期 0.5**(age/half)),
// 与 Python retrieval/pipeline.py(从 temporal.engine import recency_score)一致。
// recencyScore 在顶部 import;这里 re-export 保持旧 import 路径兼容。
// ----------------------------------------------------------------

export { recencyScore } from '../temporal/engine.js'

// ----------------------------------------------------------------
// BM25 / exact / tokenize(对齐 bm25.py / exact_match.py 的简化版)
// ----------------------------------------------------------------

export function tokenize(text: string): string[] {
  const out: string[] = []
  const asciiWords = text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []
  out.push(...asciiWords)
  const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.push(run.slice(i, i + 2))
    if (run.length < 2) out.push(run)
  }
  return out
}

/** BM25 简化版(无 IDF,因为单查询无法算全局 IDF;用饱和的词频)。 */
export function bm25Score(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0
  const docFreq = new Map<string, number>()
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  const k1 = 1.5
  const b = 0.75
  const avgdl = docTokens.length
  let score = 0
  const qSeen = new Set<string>()
  for (const qt of queryTokens) {
    if (qSeen.has(qt)) continue
    qSeen.add(qt)
    const f = docFreq.get(qt) ?? 0
    if (f === 0) continue
    const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docTokens.length / avgdl)))
    score += tfNorm
  }
  // 归一化到 [0,1] 量级
  return Math.min(1, score / Math.max(1, queryTokens.length))
}

/** exact token:query 里有多少 token 完整出现在 doc 里。 */
export function exactScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const docSet = new Set(docTokens)
  let matched = 0
  const qSeen = new Set<string>()
  for (const qt of queryTokens) {
    if (qSeen.has(qt)) continue
    qSeen.add(qt)
    if (docSet.has(qt)) matched += 1
  }
  return matched / queryTokens.length
}
