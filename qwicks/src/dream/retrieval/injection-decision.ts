/**
 * 5-dimension injection decision (SelectiveInjectionRouter 的决策核) —— 1:1 对齐
 * Python `dream/retrieval/injection_decision.py`。
 *
 * 5 维度:query_intent / memory_relevance / risk / utility / budget。
 * 复合分:0.15*i + 0.35*r + 0.20*risk + 0.20*util + 0.10*budget;阈值 ≥0.35 → inject。
 * 原则:显式"用我之前记忆"提高 utility 但不是前置条件;自然查询同样纳入考量。
 */
import type { MemoryItem } from '../types.js'

const EXPLICIT_MEMORY_TRIGGERS = /(?:用我之前|用之前的|用我的记忆|remember|recall|use my memory|based on what you know|根据你知道的|你记得|你还记得|之前聊过|之前说的|之前讨论|上下文|context|根据上下文)/i
const PROJECT_OR_PERSONAL = /(?:我的|我做的|我的项目|我在做|我在写|我的代码|我后端|my project|i'm working|i'm building|i'm using|my code|my backend|my app)/i
const GENERIC_TOPIC = /(?:怎么|如何|什么是|区别|对比|最佳实践|教程|how to|what is|tutorial|example|explain)/i
const TECH_STACK_QUERY = /(?:Python|Java|Rust|Go|TypeScript|JavaScript|C\+\+|Kotlin|Swift|React|Vue|Svelte|Angular|Tauri|FastAPI|Axum|Tokio|用什么语言|用哪个框架|技术栈|tech stack)/i
const SAFETY_RISK_PATTERNS = /(?:password|api[_\s]?key|secret|token|credential|密码|密钥|凭证|DAN|ignore all|忽略所有)/i

export interface InjectionDecision {
  queryIntent: number
  memoryRelevance: number
  risk: number
  utility: number
  budget: number
  shouldInject: boolean
  score: number
  reason: string
  explicitMemoryTrigger: boolean
}

export interface DecideInjectionOptions {
  query: string
  availableMemories?: MemoryItem[]
  userId?: string
  threadId?: string
  isSafetyContext?: boolean
  contextBudgetTokens?: number
}

export function decideInjection(opts: DecideInjectionOptions): InjectionDecision {
  const q = (opts.query ?? '').trim()
  const qLow = q.toLowerCase()
  const isSafetyContext = opts.isSafetyContext ?? false
  const contextBudgetTokens = opts.contextBudgetTokens ?? 4000

  // 1. query_intent
  let queryIntent: number
  let explicitTrigger: boolean
  if (EXPLICIT_MEMORY_TRIGGERS.test(q)) {
    queryIntent = 1.0
    explicitTrigger = true
  } else if (PROJECT_OR_PERSONAL.test(q)) {
    queryIntent = 0.7
    explicitTrigger = false
  } else if (GENERIC_TOPIC.test(q) || TECH_STACK_QUERY.test(q)) {
    queryIntent = 0.3
    explicitTrigger = false
  } else if (!q) {
    queryIntent = 0.0
    explicitTrigger = false
  } else {
    queryIntent = 0.5
    explicitTrigger = false
  }

  // 2. memory_relevance
  const memoryRelevance = computeMemoryRelevance(qLow, opts.availableMemories)

  // 3. risk
  let risk: number
  if (isSafetyContext || SAFETY_RISK_PATTERNS.test(q)) risk = 0.1
  else if (queryIntent < 0.3) risk = 1.0
  else risk = 0.85

  // 4. utility
  let utility: number
  if (explicitTrigger) utility = 0.9
  else if (queryIntent >= 0.7 && memoryRelevance >= 0.5) utility = 0.8
  else if (queryIntent >= 0.5 && memoryRelevance >= 0.3) utility = 0.6
  else if (GENERIC_TOPIC.test(q) && memoryRelevance < 0.3) utility = 0.2
  else utility = 0.4

  // 5. budget
  let budget: number
  if (contextBudgetTokens >= 6000) budget = 0.9
  else if (contextBudgetTokens >= 3000) budget = 0.7
  else if (contextBudgetTokens >= 1000) budget = 0.4
  else budget = 0.1
  if (explicitTrigger) budget = Math.min(1.0, budget + 0.2)

  // composite
  const score = queryIntent * 0.15 + memoryRelevance * 0.35 + risk * 0.2 + utility * 0.2 + budget * 0.1
  // 文档 §3.4:纯通用技术问题(无个人代词 + queryIntent ≤ 0.3)不应注入个人历史,
  // 除非用户显式要求记忆。带 "my/I" 的个人查询(如 "what are my skills")仍注入。
  const hasPersonalPronoun = /\b(?:my|i\b|i\s|mine|me\b|i'm|i have|i am)\b/i.test(q) || /我|我的|我有|我是/.test(q)
  const isGenericImpersonal = !explicitTrigger && queryIntent <= 0.3 && !hasPersonalPronoun
  const shouldInject = isGenericImpersonal ? false : score >= 0.35

  const reasons: string[] = []
  if (explicitTrigger) reasons.push('explicit_memory_trigger')
  if (queryIntent >= 0.7) reasons.push('personal_context')
  if (memoryRelevance >= 0.5) reasons.push('relevant_memories')
  if (risk < 0.5) reasons.push('safety_suppress')
  if (utility >= 0.7) reasons.push('high_utility')

  return {
    queryIntent,
    memoryRelevance,
    risk,
    utility,
    budget,
    shouldInject,
    score,
    reason: reasons.length > 0 ? reasons.join('+') : 'default',
    explicitMemoryTrigger: explicitTrigger
  }
}

function computeMemoryRelevance(queryLow: string, memories?: MemoryItem[]): number {
  if (!memories || memories.length === 0) return 0
  if (!queryLow) return 0
  const queryTokens = new Set(queryLow.match(/[\w\u4e00-\u9fff]{2,}/g) ?? [])
  if (queryTokens.size === 0) return 0
  const hitScores: number[] = []
  for (const mem of memories.slice(0, 50)) {
    const content = (mem.content ?? '').toLowerCase()
    if (!content) continue
    const memTokens = new Set(content.match(/[\w\u4e00-\u9fff]{2,}/g) ?? [])
    let overlap = 0
    for (const t of queryTokens) if (memTokens.has(t)) overlap += 1
    if (overlap > 0) hitScores.push(Math.min(1, overlap / Math.max(1, queryTokens.size)))
  }
  if (hitScores.length === 0) return 0
  hitScores.sort((a, b) => b - a)
  const top = hitScores.slice(0, 5)
  return top.reduce((s, x) => s + x, 0) / top.length
}
