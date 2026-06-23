/**
 * Memory Ledger / Memory Sources —— 1:1 对齐 Python `dream/memory_ledger/__init__.py`
 * + 文档 §4.3(回答下方书本图标,展示哪些来源用于个性化,可解释)。
 *
 * 对每次 retrieve/gate 调用,产出 4 类 entry:
 *   used       - 实际进入 top_k 的记忆(按 score 排序)
 *   downranked - 候选但被降权(judicious/freshness/user_correction)
 *   suppressed - 因 suppress 被完全过滤
 *   skipped    - 因 lifecycle(deleted/superseded)被跳过
 *
 * 每条 entry 带 memory_id/reason/score/source_text/source_type/timestamp/
 * hidden_when_shared(分享聊天时不暴露的 source)。
 */
import { randomUUID } from 'node:crypto'
import type { MemoryItem } from '../types.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'
import type { ObservableDecision } from '../retrieval/observable-gate.js'

export interface LedgerEntry {
  memoryId: string
  reason: string
  score: number
  sourceText: string
  /** raw_memory / l1 / l2 / connector */
  sourceType: string
  timestamp: string
  hiddenWhenShared: boolean
  metadata: Record<string, unknown>
}

export interface MemoryLedger {
  queryId: string
  userId: string
  queryText: string
  used: LedgerEntry[]
  downranked: LedgerEntry[]
  suppressed: LedgerEntry[]
  skipped: LedgerEntry[]
  generatedAt: string
  toDict(): Record<string, unknown>
}

const DERIVED_SOURCE_TYPES = new Set(['l1', 'l2', 'connector', 'synthesized'])

export interface BuildLedgerInput {
  userId: string
  queryText: string
  hits: RetrievalHit[]
  decisions: ObservableDecision[]
  allUserItems?: MemoryItem[]
}

export function buildMemoryLedger(input: BuildLedgerInput): MemoryLedger {
  const ledger: MemoryLedger = {
    queryId: randomUUID(),
    userId: input.userId,
    queryText: input.queryText,
    used: [],
    downranked: [],
    suppressed: [],
    skipped: [],
    generatedAt: new Date().toISOString(),
    toDict() {
      return ledgerToDict(this)
    }
  }

  const hitById = new Map(input.hits.map((h) => [h.item.id, h]))
  const decidedIds = new Set<string>()
  const now = new Date().toISOString()

  for (const d of input.decisions) {
    decidedIds.add(d.memoryId)
    const hit = hitById.get(d.memoryId)
    const item = hit?.item ?? input.allUserItems?.find((it) => it.id === d.memoryId)
    const sourceType = typeof item?.metadata.source_type === 'string' ? (item.metadata.source_type as string) : 'raw_memory'
    const hiddenWhenShared = DERIVED_SOURCE_TYPES.has(sourceType)
    const sourceText = (item?.content ?? '').slice(0, 200)
    const entry: LedgerEntry = {
      memoryId: d.memoryId,
      reason: d.reason || 'vector_match',
      score: round(d.scoreAfter),
      sourceText,
      sourceType,
      timestamp: now,
      hiddenWhenShared,
      metadata: { ...d.features }
    }
    if (d.finalDecision === 'suppress') ledger.suppressed.push(entry)
    else if (d.finalDecision === 'demote') ledger.downranked.push(entry)
    else ledger.used.push(entry)
  }

  // skipped: in allUserItems but neither hit nor decided (lifecycle: deleted/superseded)
  if (input.allUserItems) {
    for (const it of input.allUserItems) {
      if (hitById.has(it.id) || decidedIds.has(it.id)) continue
      ledger.skipped.push({
        memoryId: it.id,
        reason: 'lifecycle_skipped',
        score: 0,
        sourceText: (it.content ?? '').slice(0, 200),
        sourceType: typeof it.metadata.source_type === 'string' ? (it.metadata.source_type as string) : 'raw_memory',
        timestamp: now,
        hiddenWhenShared: false,
        metadata: {}
      })
    }
  }

  // used 按 score 排序
  ledger.used.sort((a, b) => b.score - a.score)
  return ledger
}

export function ledgerToDict(ledger: MemoryLedger): Record<string, unknown> {
  const ser = (lst: LedgerEntry[]) =>
    lst.map((e) => ({
      memory_id: e.memoryId,
      reason: e.reason,
      score: e.score,
      source_text: e.sourceText,
      source_type: e.sourceType,
      timestamp: e.timestamp,
      hidden_when_shared: e.hiddenWhenShared,
      metadata: e.metadata
    }))
  return {
    query_id: ledger.queryId,
    user_id: ledger.userId,
    query_text: ledger.queryText,
    used: ser(ledger.used),
    downranked: ser(ledger.downranked),
    suppressed: ser(ledger.suppressed),
    skipped: ser(ledger.skipped),
    generated_at: ledger.generatedAt
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
