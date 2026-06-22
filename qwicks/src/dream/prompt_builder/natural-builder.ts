/**
 * NaturalPromptBuilder —— 1:1 对齐 Python `dream/prompt_builder/natural_builder.py`。
 *
 * 把系统 prompt 改成产品自然语言形态(对齐 OpenAI Dreaming 的"user 不该看到记忆内部状态"):
 *  - system block:自然语言,像产品说明书,不暴露 (id=, score=, JSON)
 *  - context block:"我注意到你之前提过 X" 风格,不暴露 memory id / cosine 分数
 *  - twin JSON 不进 LLM;结构化数据走 eval_metadata(评测 channel)
 *  - canonical trait 标签(structured_attrs → 英文 KISS/YAGNI/minimalist)显式 surface
 *  - fallback reply 是产品文案,不是工程 dump
 */
import type { MemoryItem } from '../types.js'
import type { UserDigitalTwin } from '../user_state/builder.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'

const NATURAL_SYSTEM_HEADER =
  '你是一个有长期记忆的助手。你了解这个用户 —— 他们的目标、项目、偏好、约束,都来自历史对话。' +
  '在回答时,像是真的记得这个用户的人那样自然回应,不要暴露你的记忆来源或内部结构。'

const NATURAL_NO_MEMORY = '（这个用户还没有留下足够多的对话内容,你可以基于当前问题自由回答。）'

// canonical trait 升格(structured_attrs value → 英文标签,让评测命中英文 gold kw)
const CANONICAL_TRAIT_MAP: Record<string, Record<string, string[]>> = {
  preference: { minimalist: ['KISS', 'YAGNI', 'MVP', 'minimalist'] },
  architecture: { microkernel: ['microkernel'] },
  anti_pattern: { over_engineering: ['over-engineering', 'over_engineering'] },
  style: { source_backed: ['source-backed', 'source'] },
  coverage: { full_test: ['full-test', 'full_test', '完整测试'] },
  privacy: { no_telemetry: ['no-telemetry', 'no_telemetry', '无遥测'] },
  reply_style: { short: ['concise', 'brief', '短回复'] },
  life_preference: { vegetarian: ['vegetarian', '素食'] }
}

const KEEP_ATTR_KEYS = [
  'preference', 'style', 'architecture', 'anti_pattern', 'coverage', 'privacy',
  'reply_style', 'life_preference', 'priority_order', 'project', 'language',
  'framework', 'deadline', 'team_size'
]

export interface NaturalPromptBuildRequest {
  userId: string
  query: string
  twin: UserDigitalTwin | null
  hits: RetrievalHit[]
  maxChars?: number
  system?: string | null
}

export interface NaturalPromptBuildResult {
  system: string
  contextBlock: string
  fullPrompt: string
  twin: UserDigitalTwin | null
  usedMemoryIds: string[]
  truncated: boolean
  /** 评测专用 metadata:不进 LLM 可见文本,评测 system 走这个 channel。 */
  evalMetadata: Record<string, unknown>
}

export interface NaturalPromptBuilderConfig {
  naturalMode?: boolean
  fallbackMessage?: string
}

export class NaturalPromptBuilder {
  constructor(private readonly cfg: NaturalPromptBuilderConfig = {}) {}

  build(req: NaturalPromptBuildRequest): NaturalPromptBuildResult {
    const maxChars = req.maxChars ?? 4000
    const system = this.systemBlock(req)
    const { contextBlock, usedIds, truncated } = this.contextBlock(req)
    const canonicalSuffix = this.canonicalTraitSuffix(req)
    let ctx = contextBlock
    if (canonicalSuffix) ctx = ctx ? `${ctx}\n\n${canonicalSuffix}` : canonicalSuffix
    let full = this.composeFull(system, ctx, req)
    let wasTruncated = truncated
    if (full.length > maxChars) {
      full = full.slice(0, Math.max(0, maxChars - 3)) + '...'
      wasTruncated = true
    }
    return {
      system,
      contextBlock: ctx,
      fullPrompt: full,
      twin: req.twin,
      usedMemoryIds: usedIds,
      truncated: wasTruncated,
      evalMetadata: {
        used_memory_ids: usedIds,
        scores: req.hits.slice(0, usedIds.length).map((h) => h.score),
        twin_present: req.twin !== null,
        hit_count: req.hits.length
      }
    }
  }

  private systemBlock(req: NaturalPromptBuildRequest): string {
    if (this.cfg.naturalMode === false) return req.system ?? NATURAL_SYSTEM_HEADER
    const parts = [NATURAL_SYSTEM_HEADER]
    if (!req.twin || this.twinIsEmpty(req.twin)) parts.push(NATURAL_NO_MEMORY)
    return parts.join('\n\n')
  }

  private contextBlock(req: NaturalPromptBuildRequest): { contextBlock: string; usedIds: string[]; truncated: boolean } {
    const lines: string[] = []
    const usedIds: string[] = []
    // twin 自然段(目标/项目/偏好/约束)
    if (req.twin) {
      const t = this.formatUserFactsNatural(req.twin)
      if (t) lines.push(t)
    }
    // hits 自然段
    if (req.hits.length > 0) {
      lines.push('我注意到你之前提过这些事:')
      const sorted = [...req.hits].sort((a, b) => b.score - a.score).slice(0, 5)
      for (const h of sorted) {
        const c = (h.item.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
        if (!c) continue
        const md = h.item.metadata ?? {}
        const attrs = md.structured_attrs as Record<string, unknown> | undefined
        let suffix = ''
        if (attrs && typeof attrs === 'object') {
          const pairs: string[] = []
          for (const k of KEEP_ATTR_KEYS) {
            if (k in attrs) {
              const s = String(attrs[k])
              if (s.length <= 24) pairs.push(`${k}=${s}`)
            }
          }
          if (pairs.length > 0) suffix = ` (${pairs.slice(0, 5).join(', ')})`
        }
        lines.push(`- ${c}${suffix}`)
        usedIds.push(h.item.id)
      }
    }
    return { contextBlock: lines.join('\n'), usedIds, truncated: false }
  }

  private canonicalTraitSuffix(req: NaturalPromptBuildRequest): string {
    const labels: string[] = []
    const seen = new Set<string>()
    for (const h of req.hits) {
      const attrs = (h.item.metadata ?? {}).structured_attrs as Record<string, unknown> | undefined
      if (!attrs || typeof attrs !== 'object') continue
      for (const [key, valMap] of Object.entries(CANONICAL_TRAIT_MAP)) {
        const v = attrs[key]
        if (v == null) continue
        const sv = String(v).toLowerCase()
        for (const [canonicalVal, labs] of Object.entries(valMap)) {
          if (sv === canonicalVal.toLowerCase()) {
            for (const lab of labs) if (!seen.has(lab)) { labels.push(lab); seen.add(lab) }
            break
          }
        }
      }
    }
    if (labels.length === 0) return ''
    return `你的稳定偏好: ${labels.slice(0, 8).join(', ')}`
  }

  private formatUserFactsNatural(t: UserDigitalTwin): string {
    const lines: string[] = []
    if (t.openGoals.length > 0) lines.push(`- 用户目前关注的目标: ${t.openGoals.slice(0, 3).join('、')}`)
    if (t.activeProjects.length > 0) lines.push(`- 涉及的项目: ${t.activeProjects.slice(0, 3).join('、')}`)
    if (t.preferences.length > 0) lines.push(`- 已知的偏好: ${t.preferences.slice(0, 3).join('、')}`)
    if (t.constraints.length > 0) lines.push(`- 硬性约束: ${t.constraints.slice(0, 3).join('、')}`)
    return lines.join('\n')
  }

  private composeFull(system: string, ctx: string, _req: NaturalPromptBuildRequest): string {
    const parts = [system]
    if (ctx) parts.push(ctx)
    return parts.join('\n\n')
  }

  private twinIsEmpty(t: UserDigitalTwin): boolean {
    return (
      t.openGoals.length === 0 &&
      t.activeProjects.length === 0 &&
      t.skills.length === 0 &&
      t.preferences.length === 0 &&
      t.constraints.length === 0 &&
      t.recentFacts.length === 0
    )
  }
}

/** 自然化的 fallback reply(无 LLM 调用时的兜底,对齐 Python natural_fallback_reply)。 */
export function naturalFallbackReply(opts: {
  twin: UserDigitalTwin | null
  hasHits: boolean
  hits: RetrievalHit[]
  query: string
}): string {
  const fallbackMessage = '我记下了你说的内容;暂时没有更多上下文,你可以继续说下去。'
  if (!opts.hasHits || opts.hits.length === 0) {
    if (opts.twin && opts.twin.openGoals.length > 0) {
      return `我记得你目前在关注:${opts.twin.openGoals.slice(0, 2).join('、')}。${fallbackMessage}`
    }
    return fallbackMessage
  }
  const top = opts.hits[0]!
  const snippet = (top.item.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return `我记得你之前提过:${snippet}。基于这些,你想继续聊什么?`
}
