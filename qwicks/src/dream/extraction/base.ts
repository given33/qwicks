/**
 * Dream 记忆提取层接口(对齐 Python `dream/extraction/base.py` 的 Extractor 协议)。
 *
 * 提取的目标产物:`MemoryItemDraft` 列表(还没分配 id / embedding)。
 */
import type { MemoryItemDraft } from '../types.js'

export interface ExtractInput {
  user: string
  assistant?: string | null
  /** 既往对话(可选,LLM 抽取可参考)。 */
  history?: Array<{ role: string; content: string }>
}

export interface Extractor {
  name(): string
  /** 同步抽取(启发式)。 */
  extract(input: ExtractInput): MemoryItemDraft[]
}

/** 异步抽取器(LLM)。ExtractionRouter 优先尝试异步,失败回退同步启发式。 */
export interface AsyncExtractor {
  name(): string
  extractAsync(input: ExtractInput): Promise<MemoryItemDraft[]>
}
