/**
 * Pulse —— 文档 §7(Reference memory in suggestions / ChatGPT Pulse)。
 *
 * 夜间异步替用户做研究:从用户的 goal/project 记忆里提炼研究主题,跑研究(可注入的
 * research 函数,生产里走 web search / LLM),次日提供可快速浏览的可视化摘要
 * (展开更多 / 保存稍后阅读 / 追问 / 反馈)。
 *
 * 设计:
 *  - generatePulseTopics:从高 importance 的 goal/project 记忆提炼主题(去重 + cap)
 *  - buildPulseDigest:并发跑 research,产出 PulseDigest(每条含 summary/sources/followUps)
 *  - research 失败容忍(记录 error,继续其它主题)
 */
import { MemoryType, nowIso, type MemoryItem } from '../types.js'

export interface PulseTopic {
  /** 研究查询(喂给 web search / LLM)。 */
  query: string
  sourceMemoryIds: string[]
  rationale: string
}

export interface PulseSource {
  title: string
  url?: string
}

export interface PulseResearchResult {
  query: string
  summary: string
  sources: PulseSource[]
  followUps: string[]
}

export interface PulseResearchInput {
  query: string
}

/** 可注入的研究函数(生产里走 web search + LLM 摘要;测试里 mock)。 */
export type PulseResearchFn = (query: string) => Promise<PulseResearchResult>

export interface PulseResult extends PulseResearchResult {
  error?: string
  sourceMemoryIds: string[]
  rationale: string
  /** 文档 §7 "save for later" —— 用户是否已保存该研究条目。 */
  saved: boolean
  /** 文档 §7 "feedback" —— 用户对该条目的反馈(空表示未反馈)。 */
  feedback?: string | null
}

export interface PulseDigest {
  userId: string
  generatedAt: string
  results: PulseResult[]
  toDict(): Record<string, unknown>
}

// 从 goal/project 记忆提炼主题的辅助:剥掉"我想/我的目标是"等前缀
const GOAL_PREFIX = /^(?:我想|我要|我的目标是|我打算|我计划|i want to|i plan to|my goal is|i aim to|going to|i'm going to)\s*/i

export interface ChatTurn {
  role: string
  content: string
}

export function generatePulseTopics(
  memories: readonly MemoryItem[],
  opts: { userId: string; maxTopics?: number; minImportance?: number; recentChats?: readonly ChatTurn[] }
): PulseTopic[] {
  const maxTopics = opts.maxTopics ?? 5
  const minImportance = opts.minImportance ?? 0.5
  const candidates = memories
    .filter((m) => (m.type === MemoryType.GOAL || m.type === MemoryType.PROJECT) && m.importance >= minImportance)
    .sort((a, b) => b.importance - a.importance)

  const seen: Array<Set<string>> = []
  const topics: PulseTopic[] = []
  const pushTopic = (cleaned: string, sourceMemoryIds: string[], rationale: string): boolean => {
    if (!cleaned || cleaned.length < 3) return false
    const tokens = new Set(cleaned.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? [])
    if (seen.some((prev) => jaccard(tokens, prev) >= 0.6)) return false
    seen.push(tokens)
    topics.push({ query: cleaned, sourceMemoryIds, rationale })
    return true
  }
  for (const m of candidates) {
    pushTopic(m.content.replace(GOAL_PREFIX, '').trim(), [m.id], `${m.type}: ${m.content.slice(0, 60)}`)
    if (topics.length >= maxTopics) return topics
  }
  // 文档 §7:Pulse 也参考 chat history(用户近期对话里提到的目标/项目)。
  const GOAL_IN_CHAT = /(?:我想|我要|我的目标是|我打算|我计划|i want to|i plan to|my goal is|i aim to|i'm going to|i'm working on)\s*(.{4,80})/i
  if (opts.recentChats) {
    for (const turn of opts.recentChats) {
      if (turn.role !== 'user') continue
      const m = turn.content.match(GOAL_IN_CHAT)
      if (!m) continue
      pushTopic(m[1]!.trim().replace(/[。.!?！？]$/, ''), [], `chat: ${m[1]!.slice(0, 50)}`)
      if (topics.length >= maxTopics) break
    }
  }
  return topics
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

export interface BuildDigestOptions {
  userId: string
  topics: PulseTopic[]
  research: PulseResearchFn
  /** 并发上限(默认 3)。 */
  concurrency?: number
}

export async function buildPulseDigest(opts: BuildDigestOptions): Promise<PulseDigest> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const results: PulseResult[] = new Array(opts.topics.length)

  // 简单并发池
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, opts.topics.length) }, async () => {
    while (cursor < opts.topics.length) {
      const idx = cursor++
      const topic = opts.topics[idx]!
      try {
        const r = await opts.research(topic.query)
        results[idx] = {
          ...r,
          sourceMemoryIds: topic.sourceMemoryIds,
          rationale: topic.rationale,
          saved: false,
          feedback: null
        }
      } catch (err) {
        results[idx] = {
          query: topic.query,
          summary: '',
          sources: [],
          followUps: [],
          error: err instanceof Error ? err.message : String(err),
          sourceMemoryIds: topic.sourceMemoryIds,
          rationale: topic.rationale,
          saved: false,
          feedback: null
        }
      }
    }
  })
  await Promise.all(workers)

  const digest: PulseDigest = {
    userId: opts.userId,
    generatedAt: nowIso(),
    results: results.filter(Boolean),
    toDict() {
      return pulseDigestToDict(this)
    }
  }
  return digest
}

export function pulseDigestToDict(digest: PulseDigest): Record<string, unknown> {
  return {
    user_id: digest.userId,
    generated_at: digest.generatedAt,
    results: digest.results.map((r) => ({
      query: r.query,
      summary: r.summary,
      sources: r.sources,
      follow_ups: r.followUps,
      ...(r.error ? { error: r.error } : {}),
      source_memory_ids: r.sourceMemoryIds,
      rationale: r.rationale,
      saved: r.saved,
      ...(r.feedback ? { feedback: r.feedback } : {})
    }))
  }
}
