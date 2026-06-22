/**
 * FlatVectorIndex —— 自研 TS 暴力余弦向量索引(对齐 Python NumpyVectorDb)。
 *
 * 语义:
 *  - add:按 id 插入或替换(同 id 覆盖旧行,对齐 Python upsert 行为)。
 *  - search:对全部向量算余弦相似度(内部归一化,所以输入无需预先归一化),按 score 降序,
 *    应用 topK / minScore / filterIds。
 *  - save/load:JSON 落盘(id 列表 + 矩阵),跨实例可重建。
 *  - 线程安全:Node 单线程,但 add/search 期间不被 await 中断时无 race;持久化用原子写。
 *
 * 桌面单用户万级记忆:暴力余弦 O(n*dim) 在 dim=1024、n=10000 时约 10M 次乘加,
 * 现代 CPU < 5ms,远低于 retrieve p95≤300ms 目标。
 */
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import type { ScoredHit, VectorDb, VectorDbHealth, VectorSearchOptions } from './base.js'

export interface FlatVectorIndexOptions {
  dim: number
  persistDir: string
  /** 每多少次变更自动 save 一次(0 = 不自动)。 */
  autoSaveEvery?: number
}

interface PersistShape {
  dim: number
  ids: string[]
  vectors: number[][]
}

export class FlatVectorIndex implements VectorDb {
  private readonly dimValue: number
  private readonly persistDir: string
  private readonly persistPath: string
  private readonly autoSaveEvery: number
  private ids: string[] = []
  private vectors: number[][] = []
  private dirty = 0

  constructor(opts: FlatVectorIndexOptions) {
    this.dimValue = opts.dim
    this.persistDir = opts.persistDir
    this.persistPath = join(opts.persistDir, 'flat_vectors.json')
    this.autoSaveEvery = opts.autoSaveEvery ?? 200
    this.load()
  }

  name(): string {
    return 'dream.flat-vector.v1'
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
    return this.ids.length
  }

  add(ids: string[], vectors: number[][]): void {
    if (ids.length === 0) return
    if (ids.length !== vectors.length) {
      throw new Error(`id/vector length mismatch: ${ids.length} vs ${vectors.length}`)
    }
    for (const v of vectors) this.assertDim(v)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const existing = this.ids.indexOf(id)
      if (existing >= 0) {
        this.vectors[existing] = this.normalize(vectors[i]!)
      } else {
        this.ids.push(id)
        this.vectors.push(this.normalize(vectors[i]!))
      }
    }
    this.maybeAutoSave()
  }

  addBatch(ids: string[], vectors: number[][]): void {
    this.add(ids, vectors)
  }

  remove(ids: string[]): void {
    if (ids.length === 0) return
    const toRemove = new Set(ids)
    const keepIds: string[] = []
    const keepVecs: number[][] = []
    for (let i = 0; i < this.ids.length; i++) {
      if (!toRemove.has(this.ids[i]!)) {
        keepIds.push(this.ids[i]!)
        keepVecs.push(this.vectors[i]!)
      }
    }
    this.ids = keepIds
    this.vectors = keepVecs
    this.maybeAutoSave()
  }

  search(query: number[], opts: VectorSearchOptions = {}): ScoredHit[] {
    const topK = opts.topK ?? 8
    const minScore = opts.minScore ?? 0
    const q = this.normalize(query)
    const filterIds = opts.filterIds
    const hits: ScoredHit[] = []
    for (let i = 0; i < this.ids.length; i++) {
      if (filterIds && !filterIds.has(this.ids[i]!)) continue
      const score = this.dot(q, this.vectors[i]!)
      if (score >= minScore) hits.push({ id: this.ids[i]!, score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, topK)
  }

  getVectorsByIds(ids: Iterable<string>): Map<string, number[]> {
    const want = new Set(ids)
    const out = new Map<string, number[]>()
    for (let i = 0; i < this.ids.length; i++) {
      if (want.has(this.ids[i]!)) out.set(this.ids[i]!, this.vectors[i]!)
    }
    return out
  }

  healthCheck(): VectorDbHealth {
    return {
      backend: 'flat',
      status: 'ok',
      dim: this.dimValue,
      docCount: this.ids.length,
      strict: true
    }
  }

  async save(): Promise<void> {
    await mkdir(this.persistDir, { recursive: true })
    const payload: PersistShape = { dim: this.dimValue, ids: this.ids, vectors: this.vectors }
    await atomicWriteFile(this.persistPath, JSON.stringify(payload))
    this.dirty = 0
  }

  load(): void {
    let raw: string | null = null
    try {
      raw = readFileSync(this.persistPath, 'utf8') as string
    } catch {
      raw = null
    }
    if (!raw) return
    try {
      const data = JSON.parse(raw) as PersistShape
      if (data.dim !== this.dimValue) return // 维度不匹配,放弃(由调用方重建)
      this.ids = data.ids
      this.vectors = data.vectors.map((v) => this.normalize(v))
    } catch {
      // 损坏文件:忽略,空表起步。
    }
  }

  close(): void {
    // 无句柄;持久化在 save()。
  }

  // ----------------------------------------------------------------

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

  private maybeAutoSave(): void {
    this.dirty += 1
    if (this.autoSaveEvery > 0 && this.dirty >= this.autoSaveEvery) {
      void this.save()
    }
  }
}
