/**
 * Dream 向量库接口(对齐 Python `dream/vectordb/base.py` 的 VectorDb 协议)。
 *
 * 决策:不移植 FAISS(原生 C++ 依赖,桌面打包不可接受)。FlatVectorIndex 是自研 TS
 * 暴力余弦索引(对齐 Python NumpyVectorDb 的语义),桌面单用户万级记忆 p95≤300ms 可达。
 * IVF 分桶变体(大规模)在 ivf-index.ts 提供(可选)。
 */
export interface ScoredHit {
  id: string
  score: number
}

export interface VectorSearchOptions {
  topK?: number
  minScore?: number
  /** 只在这些 id 里搜(候选集白名单)。 */
  filterIds?: ReadonlySet<string>
}

export interface VectorDb {
  name(): string
  dim(): number
  add(ids: string[], vectors: number[][]): void
  /** 批量 add(默认走 add)。 */
  addBatch?(ids: string[], vectors: number[][]): void
  remove(ids: string[]): void
  search(query: number[], opts?: VectorSearchOptions): ScoredHit[]
  count(): number
  save(): void
  load(): void
  /** 拿 ids 对应向量(供 retrieve brute-force 用)。默认不支持。 */
  getVectorsByIds?(ids: Iterable<string>): Map<string, number[]>
  healthCheck(): VectorDbHealth
  isDegraded(): boolean
  strict(): boolean
  /** 释放句柄(如文件句柄)。 */
  close?(): void
}

export interface VectorDbHealth {
  backend: string
  status: 'ok' | 'degraded' | 'error'
  dim: number
  docCount: number
  strict: boolean
}
