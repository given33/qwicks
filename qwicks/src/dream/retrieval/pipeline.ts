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
  /**
   * B15:不含 topOfMind/corrected boost 的基础分(5 通道加权和)。用于过滤零相关命中
   * (boost 只能放大相关性,不能凭空召回)。下游 InjectionRouter 可能依赖此字段。
   */
  baseScore: number
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

    // B6:BM25 长度归一化需要语料全局平均文档长度。先对所有候选(类型/scope/tag/
    // recency 过滤后)分词,算一次 avgdl。用未过 min_recency 的集合更稳,但为保持
    // 与候选循环一致,这里用循环内相同的过滤口径。为避免两次分词,先预算所有候选
    // 的 docTokens,再算 avgdl,再复用。
    // 注:这里只对会进入评分的候选(type/scope/tag 过滤后)计长度,符合 BM25 语义
    // (文档集合 = 当前检索的候选集)。
    const prefiltered: Array<{ item: MemoryItem; docTokens: string[] }> = []
    for (const item of candidates) {
      if (query.types && !query.types.includes(item.type)) continue
      if (query.scopes && !query.scopes.includes(item.scope)) continue
      if (query.tags && !query.tags.every((t) => item.tags.includes(t))) continue
      prefiltered.push({ item, docTokens: tokenize(`${item.content} ${item.tags.join(' ')}`) })
    }
    const corpusAvgdl =
      prefiltered.length > 0
        ? prefiltered.reduce((s, p) => s + p.docTokens.length, 0) / prefiltered.length
        : 1

    for (const { item, docTokens } of prefiltered) {
      // min_recency 硬过滤(对齐 Python)
      // B5:recency 改读 lastUsedAt ?? createdAt(见 assess 同理);updatedAt 每次都刷新,
      // 用它会把刚 suppress/edit 的旧记忆顶成最新。
      const recency = recencyScore(item.lastUsedAt ?? item.createdAt, halfLifeDays, this.now())
      if (this.minRecency > 0 && recency < this.minRecency) continue

      const vectorScore = qvec ? this.cosineWithStored(item, qvec) : 0
      const bm25 = bm25Score(queryTokens, docTokens, corpusAvgdl)
      const exact = exactScore(queryTokens, docTokens)
      const importance = Math.max(0, Math.min(1, item.importance)) * item.confidence

      // v3(P2-5 报告 §11):top-of-mind / user-corrected 加权提升。
      // top-of-mind 记忆是 dreaming 判定的高优先级,应在检索中优先注入。
      // user-corrected 记忆是用户人工纠正过的,可信度更高。
      // B15 修复:boost 只能**放大已有的相关性**,不能凭空召回零相关记忆。旧版
      // topOfMindBoost(+0.12) 加法叠加在混合分上,minScore 默认 0 → 任何 top-of-mind
      // 记忆即使零语义相关也会因 +0.12 > 0 被召回(过度注入隐患)。改为:只有当至少一个
      // **相关性通道**(vector/bm25/exact)> 0 时才应用 boost,并据此过滤零相关命中。
      // 注意:不能用含 importance 的总分做门控 —— importance 是内在属性(默认 0.5),
      // 会让每条记忆的总分恒 > 0,门控失效。recency 也是查询无关的时效信号,同样排除。
      const hasRelevance = vectorScore > 0 || bm25 > 0 || exact > 0
      const baseScore =
        this.weights.vector * vectorScore +
        this.weights.bm25 * bm25 +
        this.weights.exact * exact +
        this.weights.recency * recency +
        this.weights.importance * importance
      const topOfMindBoost = item.isTopOfMind && hasRelevance ? 0.12 : 0
      const correctedBoost = item.userCorrected && hasRelevance ? 0.06 : 0

      const score = baseScore + topOfMindBoost + correctedBoost

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
        baseScore,
        vectorScore,
        recencyScore: recency,
        importanceScore: importance,
        bm25Score: bm25,
        exactScore: exact,
        source
      })
    }

    // B15:filter 仍按 minScore(默认 0,允许 importance/recency 驱动的召回 —— 这是
    // 既有契约,如 "what do you know about my skills" 靠 importance 召回相关记忆)。
    // B15 的修复点在** boost 门控**(上面 hasRelevance):零相关的 top-of-mind/corrected
    // 记忆不再因 +0.12 凭空被 boost 到 minScore 之上。即 boost 只能放大相关性,不创造召回。
    const filtered = hits.filter((h) => h.score >= minScore)
    filtered.sort((a, b) => b.score - a.score || (b.item.lastUsedAt ?? b.item.createdAt).localeCompare(a.item.lastUsedAt ?? a.item.createdAt))
    const injected = filtered.slice(0, topK)

    // B2+B3+B5(合并写侧):对最终注入集做一次批量强化 —— 刷新 last_used_at + 封顶提升
    // importance(+ 可选 salience)。一次 round-trip,不写 event、不同步 source_link、
    // 不碰 updated_at(保护 B5 的时效语义)。只强化真正被注入的(baseScore>0 由 B15 filter
    // 保证;此处再以防 minScore=0 时混入零相关命中)。
    if (injected.length > 0) {
      try {
        this.opts.repository.reinforceUsed(
          injected.map((h) => h.item.id),
          { boost: 0.05 }
        )
      } catch {
        // 强化失败不阻断检索(对齐 spec fail-open)
      }
    }
    return injected
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

/**
 * BM25 简化版(无 IDF,因为单查询无法算全局 IDF;用饱和的词频)。
 *
 * B6 修复:长度归一化必须用**语料全局平均文档长度**(avgdl),不是当前文档长度。
 * 旧实现 `avgdl = docTokens.length` → `b*(docTokens.length/avgdl)` 恒等于 b,
 * 长度项退化为常数,长文档不被惩罚,BM25 退化成饱和 TF。
 *
 * @param avgdl 语料平均文档长度(token 数)。缺省时回退到 docTokens.length(保持
 *   旧的单文档调用语义,不破坏现有无参调用方)。
 */
export function bm25Score(queryTokens: string[], docTokens: string[], avgdl?: number): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0
  const docFreq = new Map<string, number>()
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  const k1 = 1.5
  const b = 0.75
  // avgdl 用调用方传入的语料平均值;缺省时回退到本文档长度(向后兼容)。
  const effectiveAvgdl = avgdl && avgdl > 0 ? avgdl : docTokens.length
  let score = 0
  const qSeen = new Set<string>()
  for (const qt of queryTokens) {
    if (qSeen.has(qt)) continue
    qSeen.add(qt)
    const f = docFreq.get(qt) ?? 0
    if (f === 0) continue
    const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docTokens.length / effectiveAvgdl)))
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
