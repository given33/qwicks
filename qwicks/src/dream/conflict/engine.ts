/**
 * Dream 冲突消解引擎 —— 1:1 对齐 Python `dream/conflict/engine.py`。
 *
 * 判定:新记忆 vs 已有记忆 的 verdict:
 *   NONE / COMPATIBLE / DUPLICATE / CONTRADICTS / SUPERSEDES
 *
 * 策略(对齐 Python):
 *   1) 强信号(否定词 + 同 type + token 重叠/cosine) → CONTRADICTS
 *   2) 同 type + jaccard>0.6 + cosine>0.85 → DUPLICATE
 *   3) 同 type + cosine>0.75 + (替换意图 或 新置信度更高) → SUPERSEDES
 *   4) 不同 type + cosine>0.7 → COMPATIBLE
 *   5) jaccard>0.5 + cosine>0.6 → COMPATIBLE(soft)
 *   6) 默认 NONE
 */
import type { MemoryItem } from '../types.js'
import { ConflictVerdict } from '../types.js'

export interface ConflictAssessment {
  verdict: ConflictVerdict
  newId: string
  relatedId: string | null
  reason: string
  confidence: number
}

const NEGATION_PATTERNS: readonly RegExp[] = [
  /\bnot\b/i, /\bno longer\b/i, /\bnever\b/i, /\bdidn't\b/i, /\bdon't\b/i,
  /\bwon't\b/i, /\bcannot\b/i, /\brefuse\b/i, /\brejected\b/i,
  /不(?:再|会|是|需要|想|喜欢|使用|要)/,
  /否/, /反/, /取消/, /禁止/,
  /\bbut\b/i, /\bhowever\b/i, /\bactually\b/i
]

const REPLACE_PATTERNS: readonly RegExp[] = [
  /换成|改为|改成|改用|改去|替代|替换|update to|switch to|change to/i,
  // v3(P2-4 报告 §4):增强迁移/变更意图检测
  /\bmoved?\s+to\b/i, /\brelocated\s+to\b/i, /\bnow\s+live\s+in\b/i,
  /\bI\s+(?:now|currently)\s+(?:live|work|study|am based)\s+in\b/i,
  /搬到了?|搬去|现在住在|现在在|搬到|迁到|换到了?/
]

/**
 * v3(P2-4 报告 §4):结构化槽位匹配 —— 检测"住址/工作地变更"类 supersede。
 * 若新旧记忆都包含 live-in/work-in 语义但地点不同,判定为 SUPERSEDES。
 */
const LOCATION_SLOT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:live|live[sd]?|living|reside[sd]?|based|work[sing]?|study(?:ing)?)\s+(?:in|at)\s+([A-Z][\w\s.]+?)(?:[.,;!?\n]|$)/i, 'location'],
  [/(?:住在|在|来自|位于|搬到了?|搬去|现在住在)\s*([一-鿿]{2,8}[市省]?)/, 'location']
]

/**
 * 检测"同槽位不同值"supersede:两条记忆都含 live-in/location 槽,
 * 但值不同(地点不同)→ SUPERSEDES。
 */
function detectLocationSupersede(newText: string, oldText: string): boolean {
  const newLocs = extractLocations(newText)
  const oldLocs = extractLocations(oldText)
  if (newLocs.size === 0 || oldLocs.size === 0) return false
  // 有重叠则 COMPATIBLE(同一地点);完全不重叠 → SUPERSEDES(搬家了)
  let overlap = false
  for (const l of newLocs) {
    for (const o of oldLocs) {
      if (l.toLowerCase() === o.toLowerCase() || l.includes(o) || o.includes(l)) overlap = true
    }
  }
  return !overlap
}

function extractLocations(text: string): Set<string> {
  const out = new Set<string>()
  for (const [pat] of LOCATION_SLOT) {
    const m = text.match(pat)
    if (m && m[1]) out.add(m[1].trim())
  }
  return out
}

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\w\u4e00-\u9fff]+/g) ?? []))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

function cosine(v1: number[], v2: number[]): number {
  if (v1.length === 0 || v2.length === 0 || v1.length !== v2.length) return 0
  let dot = 0
  let n1 = 0
  let n2 = 0
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i]! * v2[i]!
    n1 += v1[i]! * v1[i]!
    n2 += v2[i]! * v2[i]!
  }
  if (n1 === 0 || n2 === 0) return 0
  return dot / (Math.sqrt(n1) * Math.sqrt(n2))
}

function hasNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((p) => p.test(text))
}

function hasReplaceIntent(text: string): boolean {
  return REPLACE_PATTERNS.some((p) => p.test(text))
}

function reasonFor(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

export function compare(newItem: MemoryItem, existing: MemoryItem): ConflictAssessment {
  if (existing.metadata.__deleted__ === true) {
    return { verdict: ConflictVerdict.NONE, newId: newItem.id, relatedId: existing.id, reason: 'existing deleted', confidence: 0.5 }
  }

  const newTokens = tokenize(newItem.content)
  const oldTokens = tokenize(existing.content)
  const jac = jaccard(newTokens, oldTokens)
  const cos = cosine(newItem.embedding ?? [], existing.embedding ?? [])
  const detail: Record<string, unknown> = { jaccard: round(jac), cosine: round(cos) }

  const newNeg = hasNegation(newItem.content)
  const newRep = hasReplaceIntent(newItem.content)
  const sameType = newItem.type === existing.type

  // 1) 强信号:否定
  if (newNeg && sameType && (jac > 0.4 || cos > 0.55)) {
    return { verdict: ConflictVerdict.CONTRADICTS, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, negation: true }), confidence: 0.7 }
  }
  // 2) 重复
  if (sameType && jac > 0.6 && cos > 0.85) {
    return { verdict: ConflictVerdict.DUPLICATE, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'duplicate' }), confidence: 0.85 }
  }
  // v3(P2-4 报告 §4):结构化 location 槽位 supersede ——
  // "I now live in B" 取代 "I live in A"(同 live-in 语义,不同地点)
  if (sameType && detectLocationSupersede(newItem.content, existing.content) && jac > 0.3) {
    return { verdict: ConflictVerdict.SUPERSEDES, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'location_slot_supersede' }), confidence: 0.8 }
  }
  // 3) 替代
  if (sameType && cos > 0.75 && (newRep || newItem.importance > existing.importance + 0.1)) {
    return { verdict: ConflictVerdict.SUPERSEDES, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'supersedes' }), confidence: 0.75 }
  }
  // 4) 兼容(不同 type)
  if (cos > 0.7 && !sameType) {
    return { verdict: ConflictVerdict.COMPATIBLE, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'compatible' }), confidence: 0.6 }
  }
  if (jac > 0.5 && cos > 0.6) {
    return { verdict: ConflictVerdict.COMPATIBLE, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'soft_match' }), confidence: 0.55 }
  }
  return { verdict: ConflictVerdict.NONE, newId: newItem.id, relatedId: existing.id, reason: reasonFor({ ...detail, rule: 'no_relation' }), confidence: 0.5 }
}

export function reconcile(newItem: MemoryItem, candidates: readonly MemoryItem[]): ConflictAssessment[] {
  return candidates.map((c) => compare(newItem, c))
}

export function decide(assessment: ConflictAssessment): string {
  switch (assessment.verdict) {
    case ConflictVerdict.NONE:
    case ConflictVerdict.COMPATIBLE:
      return 'keep_both'
    case ConflictVerdict.DUPLICATE:
      return 'merge_into_existing'
    case ConflictVerdict.CONTRADICTS:
      return 'ask_user_or_invalidate_old'
    case ConflictVerdict.SUPERSEDES:
      return 'supersede_old'
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
