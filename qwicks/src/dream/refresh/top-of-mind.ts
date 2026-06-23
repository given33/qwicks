/**
 * TopOfMindBalancer —— 后台 dreaming 的 top-of-mind / background 调整器(对齐文档 §2)。
 *
 * 把高 salience + 高 recency + 最近被 retrieve 命中的 memory 提升到 top-of-mind,
 * 把低 salience + stale 的 memory 降级到 background。
 *
 * 文档 §2:"支持自动管理,把高相关记忆保持 top of mind,把低相关记忆降级到 background"。
 */
import { nowIso } from '../types.js'
import type { MemoryItem } from '../types.js'
import type { MemoryRepository } from '../storage/repository.js'
import { recencyScore } from '../temporal/engine.js'

export interface TopOfMindBalancerOptions {
  repository: MemoryRepository
  /** 综合分 ≥ promoteThreshold → 提升为 top-of-mind。 */
  promoteThreshold?: number
  /** 综合分 ≤ demoteThreshold → 降级到 background。 */
  demoteThreshold?: number
  /** top-of-mind 池上限(超过则只保留分最高的 N 条)。 */
  maxTopOfMind?: number
  /** 半衰期(天),对齐 temporal.engine。 */
  halfLifeDays?: number
  now?: () => Date
}

export interface TopOfMindBalancerResult {
  promoted: number
  demoted: number
  changedMemoryIds: string[]
}

/**
 * 综合分 = 0.4*salience + 0.3*importance + 0.2*recency + 0.1*usageFreshness
 * - salience: v3 显著度字段
 * - importance: 传统重要度
 * - recency: 二进制半衰期(基于 updatedAt)
 * - usageFreshness: 基于 lastUsedAt 的近期使用度(从未用过=0.5)
 */
export function topOfMindScore(
  item: MemoryItem,
  opts: { now?: Date; halfLifeDays?: number } = {}
): number {
  const now = opts.now ?? new Date()
  const halfLifeDays = opts.halfLifeDays ?? 60
  const rec = recencyScore(item.updatedAt, halfLifeDays, now)
  let usage = 0.5
  if (item.lastUsedAt) {
    const usedDate = new Date(item.lastUsedAt)
    if (!Number.isNaN(usedDate.getTime())) {
      const ageDays = Math.max(0, (now.getTime() - usedDate.getTime()) / 86_400_000)
      usage = 0.5 ** (ageDays / Math.max(1, halfLifeDays / 2))
    }
  }
  return 0.4 * item.salience + 0.3 * item.importance + 0.2 * rec + 0.1 * usage
}

export class TopOfMindBalancer {
  private readonly promoteThreshold: number
  private readonly demoteThreshold: number
  private readonly maxTopOfMind: number
  private readonly halfLifeDays: number
  private readonly now: () => Date

  constructor(private readonly opts: TopOfMindBalancerOptions) {
    this.promoteThreshold = opts.promoteThreshold ?? 0.7
    this.demoteThreshold = opts.demoteThreshold ?? 0.3
    this.maxTopOfMind = opts.maxTopOfMind ?? 20
    this.halfLifeDays = opts.halfLifeDays ?? 60
    this.now = opts.now ?? (() => new Date())
  }

  apply(opts: { userId?: string } = {}): TopOfMindBalancerResult {
    const now = this.now()
    const items = this.opts.repository.list(opts.userId, {})
    // 计算每条的综合分
    const scored = items.map((item) => ({
      item,
      score: topOfMindScore(item, { now, halfLifeDays: this.halfLifeDays })
    }))
    // 按分排序,取 top N 作为 top-of-mind 候选
    scored.sort((a, b) => b.score - a.score)
    const topIds = new Set(scored.slice(0, this.maxTopOfMind).map((s) => s.item.id))

    const result: TopOfMindBalancerResult = { promoted: 0, demoted: 0, changedMemoryIds: [] }
    let changed = false
    for (const { item, score } of scored) {
      const shouldBeTop = topIds.has(item.id) && score >= this.promoteThreshold
      const shouldDemote = score <= this.demoteThreshold
      if (shouldBeTop && !item.isTopOfMind) {
        item.promoteToTopOfMind()
        this.opts.repository.upsert(item)
        result.promoted += 1
        result.changedMemoryIds.push(item.id)
        changed = true
      } else if (shouldDemote && item.isTopOfMind) {
        item.demoteToBackground()
        this.opts.repository.upsert(item)
        result.demoted += 1
        result.changedMemoryIds.push(item.id)
        changed = true
      } else if (shouldBeTop && item.isTopOfMind) {
        // 已在 top,无需变
      } else if (!shouldBeTop && item.isTopOfMind && !topIds.has(item.id)) {
        // 跌出 top N 池 → 降级
        item.demoteToBackground()
        this.opts.repository.upsert(item)
        result.demoted += 1
        result.changedMemoryIds.push(item.id)
        changed = true
      }
    }
    if (changed) {
      this.opts.repository.logEvent('top_of_mind_rebalance', {
        userId: opts.userId,
        payload: {
          promoted: result.promoted,
          demoted: result.demoted,
          changed: result.changedMemoryIds
        }
      })
    }
    return result
  }
}
