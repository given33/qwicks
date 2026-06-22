/**
 * IvfVectorIndex —— 粗量化 IVF(可选,大规模用)。
 *
 * 策略(对齐 Python VectorDbConfig indexType='ivf'):
 *  - 当向量数 >= nlist*2 时训练:k-means 初始化 nlist 个质心,每条向量分到最近质心的桶。
 *  - search:取 query 最近 nprobe 个桶,在桶内做暴力余弦,合并 topK。
 *  - 向量数不足以训练时,fallback 到全量暴力扫描(等价 flat)。
 *  - 不持久化(内存索引;FlatVectorIndex 负责落盘的主路径)。
 *
 * 对桌面单用户场景这通常是 over-engineering(flat 已够),但保留以备万级以上规模。
 */
import type { ScoredHit, VectorDb, VectorDbHealth, VectorSearchOptions } from './base.js'

export interface IvfVectorIndexOptions {
  dim: number
  /** 桶数。 */
  nlist?: number
  /** 查询时探测的桶数。 */
  nprobe?: number
}

interface Bucket {
  centroid: number[]
  members: Array<{ id: string; vector: number[] }>
}

export class IvfVectorIndex implements VectorDb {
  private readonly dimValue: number
  private readonly nlist: number
  private readonly nprobe: number
  private idToVector = new Map<string, number[]>()
  private buckets: Bucket[] = []
  private trained = false

  constructor(opts: IvfVectorIndexOptions) {
    this.dimValue = opts.dim
    this.nlist = Math.max(1, opts.nlist ?? 8)
    this.nprobe = Math.min(this.nlist, Math.max(1, opts.nprobe ?? Math.ceil(this.nlist / 4)))
  }

  name(): string {
    return 'dream.ivf-vector.v1'
  }

  dim(): number {
    return this.dimValue
  }

  isDegraded(): boolean {
    return false
  }

  strict(): boolean {
    return true
  }

  count(): number {
    return this.idToVector.size
  }

  add(ids: string[], vectors: number[][]): void {
    if (ids.length === 0) return
    let retrainNeeded = false
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const v = vectors[i]!
      this.assertDim(v)
      if (!this.idToVector.has(id)) retrainNeeded = true
      this.idToVector.set(id, this.normalize(v))
    }
    // 新增了新 id → 标记需要重训(简单稳健;生产可增量插入)。
    if (retrainNeeded) this.trained = false
    if (this.idToVector.size >= this.nlist * 2) this.train()
  }

  remove(ids: string[]): void {
    if (ids.length === 0) return
    let changed = false
    for (const id of ids) {
      if (this.idToVector.delete(id)) changed = true
    }
    if (changed) {
      this.trained = false
      this.buckets = []
      if (this.idToVector.size >= this.nlist * 2) this.train()
    }
  }

  search(query: number[], opts: VectorSearchOptions = {}): ScoredHit[] {
    const topK = opts.topK ?? 8
    const minScore = opts.minScore ?? 0
    const q = this.normalize(query)
    const filterIds = opts.filterIds

    if (!this.trained) {
      // fallback: brute-force over all
      return this.bruteForce(q, topK, minScore, filterIds)
    }
    // 选 nprobe 个最近桶
    const probeOrder = this.buckets
      .map((b, idx) => ({ idx, d: this.dot(q, b.centroid) }))
      .sort((a, b) => b.d - a.d)
      .slice(0, this.nprobe)
      .map((x) => x.idx)
    const hits: ScoredHit[] = []
    for (const bi of probeOrder) {
      const bucket = this.buckets[bi]!
      for (const m of bucket.members) {
        if (filterIds && !filterIds.has(m.id)) continue
        const score = this.dot(q, m.vector)
        if (score >= minScore) hits.push({ id: m.id, score })
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  healthCheck(): VectorDbHealth {
    return {
      backend: 'ivf',
      status: 'ok',
      dim: this.dimValue,
      docCount: this.idToVector.size,
      strict: true
    }
  }

  save(): void {
    /* 内存索引,不落盘 */
  }
  load(): void {
    /* 内存索引 */
  }
  close(): void {
    this.idToVector.clear()
    this.buckets = []
  }

  // ----------------------------------------------------------------

  private train(): void {
    const entries = Array.from(this.idToVector.entries())
    if (entries.length < this.nlist) return
    // k-means++,简化版:随机选 nlist 个不同向量做初始质心。
    const centroids = this.initCentroids(entries.map((e) => e[1]))
    // 10 轮 Lloyd 迭代
    let assignment = new Array(entries.length).fill(0)
    for (let iter = 0; iter < 10; iter++) {
      // 分配
      let changed = false
      for (let i = 0; i < entries.length; i++) {
        const v = entries[i]![1]
        let best = 0
        let bestSim = -Infinity
        for (let c = 0; c < centroids.length; c++) {
          const sim = this.dot(v, centroids[c]!)
          if (sim > bestSim) {
            bestSim = sim
            best = c
          }
        }
        if (assignment[i] !== best) {
          assignment[i] = best
          changed = true
        }
      }
      // 更新质心
      const sums: number[][] = centroids.map(() => new Array(this.dimValue).fill(0))
      const counts = new Array(centroids.length).fill(0)
      for (let i = 0; i < entries.length; i++) {
        const c = assignment[i]!
        const v = entries[i]![1]
        for (let d = 0; d < this.dimValue; d++) sums[c]![d]! += v[d]!
        counts[c]! += 1
      }
      for (let c = 0; c < centroids.length; c++) {
        if (counts[c] === 0) continue
        centroids[c] = this.normalize(sums[c]!.map((s) => s / counts[c]!))
      }
      if (!changed && iter > 0) break
    }
    // 构造桶
    this.buckets = centroids.map((c) => ({ centroid: c, members: [] }))
    for (let i = 0; i < entries.length; i++) {
      this.buckets[assignment[i]!]!.members.push({ id: entries[i]![0], vector: entries[i]![1] })
    }
    this.trained = true
  }

  private initCentroids(vectors: number[][]): number[][] {
    // 简化 k-means++:按距离加权随机。这里用确定性的"分散选取"——
    // 取相互距离尽量远的向量做初始质心,避免随机性导致测试不稳。
    const chosen: number[][] = []
    chosen.push(this.normalize([...vectors[0]!]))
    while (chosen.length < this.nlist && chosen.length < vectors.length) {
      let bestVec = vectors[0]!
      let bestMinSim = Infinity
      for (const v of vectors) {
        const nv = this.normalize(v)
        let minSim = Infinity
        for (const c of chosen) minSim = Math.min(minSim, this.dot(nv, c))
        // 想要离已选质心最远的 → 最小相似度最低
        if (minSim < bestMinSim) {
          bestMinSim = minSim
          bestVec = v
        }
      }
      chosen.push(this.normalize([...bestVec]))
    }
    return chosen
  }

  private bruteForce(
    q: number[],
    topK: number,
    minScore: number,
    filterIds?: ReadonlySet<string>
  ): ScoredHit[] {
    const hits: ScoredHit[] = []
    for (const [id, v] of this.idToVector) {
      if (filterIds && !filterIds.has(id)) continue
      const score = this.dot(q, v)
      if (score >= minScore) hits.push({ id, score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  private assertDim(v: number[]): void {
    if (v.length !== this.dimValue) {
      throw new Error(`vector dim mismatch: got ${v.length} expected ${this.dimValue}`)
    }
  }

  private normalize(v: number[]): number[] {
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    if (norm === 0) return new Array(this.dimValue).fill(0)
    const out = new Array<number>(v.length)
    for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm
    return out
  }

  private dot(a: number[], b: number[]): number {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
    return s
  }
}
