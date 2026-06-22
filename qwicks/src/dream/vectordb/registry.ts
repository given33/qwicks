/**
 * VectorDb 注册/工厂(对齐 Python VectorDbRegistry)。按 backend 名取实例。
 * 决策:仅 self-built(flat 默认 + ivf 可选)。faiss/numpy/zvec 不移植。
 */
import type { VectorDb } from './base.js'
import { FlatVectorIndex } from './flat-index.js'
import { IvfVectorIndex } from './ivf-index.js'

export type VectorBackend = 'flat' | 'ivf'

export interface BuildVectorDbOptions {
  backend: VectorBackend
  dim: number
  persistDir?: string
  /** ivf 专属。 */
  nlist?: number
  nprobe?: number
}

export function buildVectorDb(opts: BuildVectorDbOptions): VectorDb {
  switch (opts.backend) {
    case 'flat':
      return new FlatVectorIndex({ dim: opts.dim, persistDir: opts.persistDir ?? './dream_vectors' })
    case 'ivf':
      return new IvfVectorIndex({ dim: opts.dim, nlist: opts.nlist, nprobe: opts.nprobe })
    default:
      throw new Error(`unknown vectordb backend: ${opts.backend as string}`)
  }
}
