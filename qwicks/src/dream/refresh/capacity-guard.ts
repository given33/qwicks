/**
 * Batch D (spec §4): 容量管理 —— "memory full" 防护。
 *
 * 活跃记忆超过 softLimit 时,自动把最低价值的活跃记忆降到 background(仍可检索,
 * 不主动注入),保留 top-of-mind / 保护期内 / RESTRICTED 记忆。超过 hardLimit 触发告警。
 *
 * 价值分复用 topOfMindScore(salience/importance/recency/usage)。
 * - RESTRICTED 永不进候选集(接 Batch B)。
 * - SENSITIVE 计算时乘 sensitiveDemotePenalty(默认 0.5)—— 同价值下先降,但不会无脑降。
 * - background 不是删除:用户显式问仍能召回(对齐文档"gray memory 可被问起")。
 */
import type { MemoryItem } from '../types.js'
import { SensitivityLevel, nowIso } from '../types.js'
import { topOfMindScore } from './top-of-mind.js'
import type { MemoryRepository } from '../storage/repository.js'

export interface CapacityConfig {
  /** 活跃记忆上限,超过触发 demote。 */
  softLimit: number
  /** 硬上限,触达即告警(dream_stage_failed)。 */
  hardLimit: number
  /** 新记忆保护期(小时),期内不降。 */
  protectWindowHours: number
  /** SENSITIVE 降权系数。 */
  sensitiveDemotePenalty: number
}

export const DEFAULT_CAPACITY_CONFIG: CapacityConfig = {
  softLimit: 500,
  hardLimit: 1000,
  protectWindowHours: 24,
  sensitiveDemotePenalty: 0.5
}

export interface DemotionPlan {
  /** 需要降级到 background 的 memory id。 */
  toDemote: string[]
  /** 活跃计数。 */
  activeCount: number
  /** 是否触达 hardLimit(触发告警)。 */
  atHardLimit: boolean
}

function withinProtectWindow(item: MemoryItem, now: Date, hours: number): boolean {
  const created = new Date(item.createdAt)
  if (Number.isNaN(created.getTime())) return false
  return now.getTime() - created.getTime() < hours * 3_600_000
}

/**
 * 纯函数:给定活跃记忆集合 + 配置,返回应降到 background 的 id 列表。
 * 不修改入参,不碰 repository。执行(写 background)由 MemoryCapacityGuard.run 完成。
 */
export function guardCapacity(items: MemoryItem[], config: CapacityConfig, now: Date): DemotionPlan {
  // active = 非 background 且 ACTIVE/CONFIRMED 状态。
  const active = items.filter(
    (it) => !it.metadata.background && (it.status === 'active' || it.status === 'confirmed')
  )
  const activeCount = active.length

  if (activeCount <= config.softLimit) {
    return { toDemote: [], activeCount, atHardLimit: activeCount > config.hardLimit }
  }

  // 候选集:排除 RESTRICTED / 保护期内 / top-of-mind。
  const candidates = active.filter(
    (it) =>
      it.sensitivity !== SensitivityLevel.RESTRICTED &&
      !it.isTopOfMind &&
      !withinProtectWindow(it, now, config.protectWindowHours)
  )

  // 按价值分排序(升序,最低的先降)。SENSITIVE 乘惩罚系数。
  const ranked = candidates
    .map((it) => {
      let score = topOfMindScore(it, { now })
      if (it.sensitivity === SensitivityLevel.SENSITIVE) {
        score *= config.sensitiveDemotePenalty
      }
      return { id: it.id, score }
    })
    .sort((a, b) => a.score - b.score)

  const toDemoteCount = activeCount - config.softLimit
  const toDemote = ranked.slice(0, toDemoteCount).map((r) => r.id)

  return {
    toDemote,
    activeCount,
    atHardLimit: activeCount > config.hardLimit
  }
}

/**
 * 执行器:把 DemotionPlan 应用到 repository(写 background + statusHistory)。
 * 在 dreaming tick / afterTurn 后台调用,不阻塞热路径。
 * 返回实际降级条数 + 是否触达 hardLimit(供 pipeline 记 dream_stage_failed)。
 */
export class MemoryCapacityGuard {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly config: CapacityConfig = DEFAULT_CAPACITY_CONFIG
  ) {}

  /** 跑一次容量检查并执行 demote。 */
  run(userId: string, now: Date = new Date()): { demoted: number; atHardLimit: boolean } {
    const items = this.repository.list(userId, {})
    const plan = guardCapacity(items, this.config, now)
    let demoted = 0
    for (const id of plan.toDemote) {
      const item = this.repository.get(id)
      if (!item) continue
      item.metadata.background = true
      item.statusHistory.push({
        at: nowIso(),
        actor: 'capacity_guard',
        reason: 'auto_demote_capacity',
        from: item.status,
        to: item.status
      })
      this.repository.upsert(item)
      demoted += 1
    }
    return { demoted, atHardLimit: plan.atHardLimit }
  }
}
