/**
 * ExtractionRouter —— LLM 优先,失败/空时降级到启发式(对齐 Python ExtractionRouter)。
 *
 * 策略:
 *  - 先调 primary(AsyncExtractor)。若返回非空 → 用之。
 *  - 否则(抛错或空)→ fallback(Extractor,同步)。
 *  - lastBackend() 反映本轮实际走了哪个后端(供 observability / 评测)。
 */
import type { AsyncExtractor, ExtractInput } from './base.js'
import type { Extractor } from './base.js'
import type { MemoryItemDraft } from '../types.js'

export interface ExtractionRouterOptions {
  primary: AsyncExtractor
  fallback: Extractor
}

export class ExtractionRouter implements AsyncExtractor {
  private last = ''

  constructor(private readonly opts: ExtractionRouterOptions) {}

  name(): string {
    return 'dream.extraction-router'
  }

  lastBackend(): string {
    return this.last
  }

  async extractAsync(input: ExtractInput): Promise<MemoryItemDraft[]> {
    try {
      const drafts = await this.opts.primary.extractAsync(input)
      if (drafts.length > 0) {
        this.last = this.opts.primary.name()
        return drafts
      }
    } catch {
      // fall through to heuristic
    }
    const fallbackDrafts = this.opts.fallback.extract(input)
    this.last = this.opts.fallback.name()
    return fallbackDrafts
  }
}
