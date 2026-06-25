/**
 * Dream 时间推理引擎 —— 1:1 对齐 Python `dream/temporal/engine.py`。
 *
 * 职责:recency 衰减 / 过期判定 / 时间短语检测 / type 级时间窗口。
 * 衰减公式(对齐 Python):recency = 0.5 ** (age_days / half_life_days)(二进制半衰期)。
 *
 * 注:retrieval/pipeline.ts 的 recencyScore 之前用了 exp(-Δt/half),与 Python 不一致;
 * 本引擎是权威来源,pipeline 应统一走它(后续重构时对齐)。本文件先把权威实现定下。
 */
import type { MemoryItem, MemoryType } from '../types.js'
import { MemoryType as MT } from '../types.js'

export interface TemporalAssessment {
  isExpired: boolean
  isStale: boolean
  ageDays: number
  recencyScore: number
  halfLifeDays: number
  reason: string
}

function parseIso(ts: string): Date | null {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 二进制半衰期衰减:[0,1]。无法解析返回 0.5(对齐 Python)。 */
export function recencyScore(updatedAt: string, halfLifeDays = 60, now: Date = new Date()): number {
  const ts = parseIso(updatedAt)
  if (ts === null) return 0.5
  let age = (now.getTime() - ts.getTime()) / 86_400_000
  if (age < 0) age = 0
  return 0.5 ** (age / Math.max(1, halfLifeDays))
}

export function ageDays(updatedAt: string, now: Date = new Date()): number {
  const ts = parseIso(updatedAt)
  if (ts === null) return 0
  return Math.max(0, (now.getTime() - ts.getTime()) / 86_400_000)
}

const TIME_PHRASES: ReadonlyArray<readonly [RegExp, number]> = [
  [/今年|this year/i, 0.7],
  [/去年|last year/i, 0.4],
  [/很久|ages ago|long ago|a long time ago/i, 0.2],
  [/刚|just now|just|recently|最近/i, 0.95],
  [/曾经|once|previously|以前|之前/i, 0.3],
  [/现在|now|currently|当前|目前/i, 1.0],
  [/以后|将来|in the future|later/i, 0.5]
]

export function detectTemporalHint(text: string): number | null {
  for (const [pat, score] of TIME_PHRASES) {
    if (pat.test(text)) return score
  }
  return null
}

export function assess(
  item: MemoryItem,
  opts: { now?: Date; halfLifeDays?: number; staleThreshold?: number } = {}
): TemporalAssessment {
  const now = opts.now ?? new Date()
  const halfLifeDays = opts.halfLifeDays ?? 60
  const staleThreshold = opts.staleThreshold ?? 0.25

  // B5:时效性改读"上次使用时间,回退创建时间"。updatedAt 每次都刷新(=now),
  // 用它会导致 decay 一次性、suppress/edit 后旧记忆顶成"最新"。createdAt/lastUsedAt
  // 不会被 decay/suppress/upsert 改变(强化走 reinforceUsed 不碰 updated_at),语义稳定。
  const freshnessField = item.lastUsedAt ?? item.createdAt
  const age = ageDays(freshnessField, now)
  let rec = recencyScore(freshnessField, halfLifeDays, now)
  const hint = detectTemporalHint(item.content)
  if (hint !== null) rec = Math.min(1, Math.max(0, 0.6 * rec + 0.4 * hint))

  let expired = false
  let reason = 'fresh'
  if (item.expiresAt) {
    const exp = parseIso(item.expiresAt)
    if (exp && exp <= now) {
      expired = true
      reason = 'expired'
    }
  }
  const stale = !expired && rec < staleThreshold
  if (stale && reason === 'fresh') reason = 'stale'

  return { isExpired: expired, isStale: stale, ageDays: age, recencyScore: rec, halfLifeDays, reason }
}

export function sortbyRecency(
  items: readonly MemoryItem[],
  opts: { now?: Date; halfLifeDays?: number; reverse?: boolean } = {}
): MemoryItem[] {
  const now = opts.now ?? new Date()
  const halfLifeDays = opts.halfLifeDays ?? 60
  const reverse = opts.reverse ?? true
  const out = [...items]
  out.sort((a, b) => recencyScore(a.updatedAt, halfLifeDays, now) - recencyScore(b.updatedAt, halfLifeDays, now))
  return reverse ? out.reverse() : out
}

export function filterActive(
  items: readonly MemoryItem[],
  opts: { now?: Date; halfLifeDays?: number; includeExpired?: boolean } = {}
): MemoryItem[] {
  const out: MemoryItem[] = []
  for (const it of items) {
    const a = assess(it, opts)
    if (a.isExpired && !opts.includeExpired) continue
    if (a.isStale && (it.type === MT.GOAL || it.type === MT.PROJECT)) {
      it.metadata.needs_refresh = true
    }
    out.push(it)
  }
  return out
}
