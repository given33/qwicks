/**
 * Dream 主动判断 (judicious personalization + freshness routing) —— 1:1 对齐
 * Python `dream/retrieval/judicious.py`。
 *
 * 1) JudiciousPersonalization:通用问题不附加个人历史(命中 → demote)
 * 2) FreshnessRouting:supersede 链 → 旧值 demote,新值 boost(同 user 范围)
 *
 * 两个 gate 都在 retrieval 末尾对 candidate score 做调整,不破坏既有 5 通道公式。
 */
import type { MemoryItem } from '../types.js'

// 通用问题信号:缺个人项目/偏好/个人化关键词
const PERSONAL_PROJECT_KEYWORDS = /(?:我的|我之前|我之前说|我之前聊|我之前做|我做的|我做|我的项目|根据我|my\s+project|i\s+work|i\s+built|i\s+use\s+for|for\s+my)/i
const GENERIC_TOPIC_KEYWORDS = /(?:怎么用|怎么写|怎么实现|怎么读|怎么读大文件|怎么启动|怎么跑|怎么调|什么是|区别|对比|最佳实践|how\s+to|what\s+is|tutorial|example|Python|Java|Rust|Go|TypeScript|JavaScript|C\+\+|Kotlin|Swift)/i
const THIRD_PARTY_KEYWORDS = /(?:React|Vue|Svelte|Angular|express|fastapi|axum|tokio|reqwest|httpx|requests|sqlalchemy|django|flask|postgres|sqlite|mysql|redis|kafka|docker|kubernetes|aws|gcp|azure|linux|windows|macos)/i

// supersede 候选 key(对齐 Python)
const SUPERSEDE_KEYS = new Set([
  'project', 'language', 'library', 'tool', 'current_http_lib', 'deadline', 'stack', 'fix',
  'current_location', 'location', 'active_during_travel', 'post_travel_state',
  'expired_travel', 'home_location', 'current_role', 'current_focus', 'current_team_size',
  'current_priority', 'current_company', 'previous_http_lib', 'previous_language', 'previous_location'
])

export interface JudiciousGateDecision {
  isGeneric: boolean
  genericReason: string
  personalKeywordsToDemote: string[]
}

export function detectGenericQuestion(query: string): JudiciousGateDecision {
  const t = (query ?? '').trim()
  if (!t) return { isGeneric: false, genericReason: 'empty', personalKeywordsToDemote: [] }
  if (PERSONAL_PROJECT_KEYWORDS.test(t)) {
    return { isGeneric: false, genericReason: 'has_personal_pronoun', personalKeywordsToDemote: [] }
  }
  const hasGeneric = GENERIC_TOPIC_KEYWORDS.test(t)
  const hasThird = THIRD_PARTY_KEYWORDS.test(t)
  if (!hasGeneric && !hasThird) {
    return { isGeneric: false, genericReason: 'no_topic_signal', personalKeywordsToDemote: [] }
  }
  return { isGeneric: true, genericReason: 'generic_topic_or_third_party', personalKeywordsToDemote: [] }
}

/** 根据 judicious 决定返回 demote(-0.15 ~ 0)。 */
export function applyJudiciousDemote(item: MemoryItem, decision: JudiciousGateDecision): number {
  if (!decision.isGeneric) return 0
  if (PERSONAL_PROJECT_KEYWORDS.test(item.content ?? '')) return -0.15
  return 0
}

/**
 * detect 同 user 下的 supersede 链,返回 {old_id: new_id}(对齐 Python detect_supersede_chain)。
 * 启发式:同 user,同 structured_attrs.key,不同 value,最新(updated_at 最大)为 current。
 */
export function detectSupersedeChain(items: readonly MemoryItem[], userId: string): Map<string, string> {
  const chains = new Map<string, string>()
  const groups = new Map<string, MemoryItem[]>()
  for (const it of items) {
    if (it.userId !== userId) continue
    const attrs = it.metadata.structured_attrs
    if (!attrs || typeof attrs !== 'object') continue
    for (const k of Object.keys(attrs as Record<string, unknown>)) {
      if (SUPERSEDE_KEYS.has(k)) {
        const arr = groups.get(k) ?? []
        arr.push(it)
        groups.set(k, arr)
        break
      }
    }
  }
  for (const [key, lst] of groups) {
    const seen = new Set<string>()
    const uniq = lst.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    if (uniq.length < 2) continue
    const sorted = [...uniq].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
    const newItem = sorted[0]!
    const newVal = (newItem.metadata.structured_attrs as Record<string, unknown>)?.[key]
    for (const oldItem of sorted.slice(1)) {
      if (oldItem.id === newItem.id) continue
      const oldVal = (oldItem.metadata.structured_attrs as Record<string, unknown>)?.[key]
      if (oldVal != null && newVal != null && String(oldVal) !== String(newVal)) {
        chains.set(oldItem.id, newItem.id)
      }
    }
  }

  // R70+ v4: cross-key supersede —— active_during_travel(旧) 被 current_location(新) supersede,
  // previous_* 被 current_* supersede(对齐 Python judicious.py:175-203)。
  const crossKeyPairs: ReadonlyArray<readonly [string, string]> = [
    ['active_during_travel', 'current_location'],
    ['expired_travel', 'current_location'],
    ['expired_travel', 'post_travel_state'],
    ['home_location', 'current_location'],
    ['previous_http_lib', 'current_http_lib'],
    ['previous_language', 'language'],
    ['previous_location', 'current_location']
  ]
  for (const [oldKey, newKey] of crossKeyPairs) {
    const olds = items.filter(
      (it) => it.userId === userId && hasStructuredKey(it, oldKey)
    )
    const news = items.filter(
      (it) => it.userId === userId && hasStructuredKey(it, newKey)
    )
    if (olds.length === 0 || news.length === 0) continue
    const newLatest = [...news].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!
    const newIds = new Set(news.map((n) => n.id))
    for (const oldItem of olds) {
      if (newIds.has(oldItem.id)) continue // 不 supersede 自己
      const oldVal = structuredVal(oldItem, oldKey)
      const newVal = structuredVal(newLatest, newKey)
      if (oldVal && newVal && String(oldVal).toLowerCase() !== String(newVal).toLowerCase()) {
        chains.set(oldItem.id, newLatest.id)
      }
    }
  }
  return chains
}

function hasStructuredKey(item: MemoryItem, key: string): boolean {
  const attrs = item.metadata.structured_attrs
  return !!attrs && typeof attrs === 'object' && key in (attrs as Record<string, unknown>)
}

function structuredVal(item: MemoryItem, key: string): unknown {
  const attrs = item.metadata.structured_attrs as Record<string, unknown> | undefined
  return attrs?.[key]
}

/** freshness 调整:supersede 旧值强 demote,新值 boost(对齐 Python freshness_score_adjust)。 */
export function freshnessScoreAdjust(item: MemoryItem, supersedeChains: Map<string, string>): number {
  if (supersedeChains.size === 0) return 0
  if (supersedeChains.has(item.id)) return -0.5
  for (const v of supersedeChains.values()) if (v === item.id) return 0.15
  return 0
}

export interface GateAdjustments {
  judiciousDemote: number
  freshnessAdjust: number
  isGeneric: boolean
  isSuperseded: boolean
  readonly total: number
}

/** 对单条 item 计算 judicious + freshness 调整(对齐 Python assess_judicious_and_freshness)。 */
export function assessJudiciousAndFreshness(opts: {
  item: MemoryItem
  query: string
  userId: string
  allUserItems?: MemoryItem[]
}): GateAdjustments {
  const decision = detectGenericQuestion(opts.query)
  const judicious = applyJudiciousDemote(opts.item, decision)
  let chains = new Map<string, string>()
  if (opts.allUserItems) chains = detectSupersedeChain(opts.allUserItems, opts.userId)
  const freshness = freshnessScoreAdjust(opts.item, chains)
  return {
    judiciousDemote: judicious,
    freshnessAdjust: freshness,
    isGeneric: decision.isGeneric,
    isSuperseded: chains.has(opts.item.id),
    get total() {
      return judicious + freshness
    }
  }
}
