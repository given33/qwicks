/**
 * TemporalDreamer —— 后台 dreaming 流水线的时间状态转换器(对齐文档 §4)。
 *
 * 核心职责:
 *  1) 把 PLANNED 记忆在 valid_until 过期后转为 OCCURRED(历史化)。
 *     例:"我要去新加坡旅行"(valid_until=旅行结束日)在结束后变成
 *     "我曾在某时间去过新加坡"。
 *  2) 把 CURRENT 记忆在 valid_until 过期后标记 EXPIRED(temporal_state)。
 *  3) 生成可解释的 change log(写 memory_event)。
 *
 * 与 MemoryDecay 的区别:Decay 处理 importance/salience 衰减与 lifecycle EXPIRED;
 * TemporalDreamer 处理 temporal_state 转换(planned→occurred、current→expired)。
 * 二者正交,都在 DreamingScheduler.tick 中执行。
 */
import { MemoryLifecycleStatus, TemporalState, nowIso } from '../types.js'
import type { MemoryItem, MemoryType } from '../types.js'
import type { MemoryRepository } from '../storage/repository.js'

export interface TemporalDreamerOptions {
  repository: MemoryRepository
  /** 注入时间(测试用)。 */
  now?: () => Date
}

export interface TemporalDreamerResult {
  /** planned → occurred 转换数。 */
  occurred: number
  /** current → expired 转换数(temporal_state)。 */
  expiredTemporal: number
  /** 被处理的 memory id 列表(用于 change log)。 */
  changedMemoryIds: string[]
  /** 每条转换的人类可读说明。 */
  changeLog: Array<{ memoryId: string; from: TemporalState; to: TemporalState; reason: string }>
}

/**
 * 把一条 planned 记忆历史化为 occurred 文本。
 * 规则:把"将要/计划/会/打算/going to/will/plan to"等将来时去掉,
 * 把动词转为过去时(中文用"曾/已",英文用 -ed / have done)。
 */
export function historizePlannedContent(content: string, opts: { validUntil?: string | null }): string {
  let out = content
  // 中文将来时 → 历史表达
  out = out.replace(/我要去|我打算去|我计划去|我准备去|我将去|我要到/g, '我去了')
  out = out.replace(/我将会|我将要|我准备|我打算|我计划/g, '我已经')
  out = out.replace(/要去|打算去|计划去|准备去/g, '去了')
  out = out.replace(/将要|即将/g, '已经')
  // 英文将来时 → 过去时
  out = out.replace(/\bI am (going to|gonna)\b/gi, 'I')
  out = out.replace(/\bI will\b/gi, 'I will have')
  out = out.replace(/\bI plan to\b/gi, 'I')
  out = out.replace(/\bI'm planning to\b/gi, 'I')
  out = out.replace(/\bI'm going to\b/gi, 'I')
  out = out.replace(/\bgoing to visit\b/gi, 'visited')
  out = out.replace(/\bgoing to travel to\b/gi, 'traveled to')
  out = out.replace(/\bvisit\b(\s+\w)/gi, (_m, c) => `visited${c}`)
  // 添加历史前缀(若没有明显过去时标记)
  if (!/曾|已经|去了|visited|traveled|went|have/i.test(out)) {
    out = `曾:${out}`
  }
  // 附上时间窗口(若有 validUntil)
  if (opts.validUntil) {
    const dateStr = opts.validUntil.slice(0, 10)
    out = `${out}(截至 ${dateStr})`
  }
  return out
}

export class TemporalDreamer {
  private readonly now: () => Date
  constructor(private readonly opts: TemporalDreamerOptions) {
    this.now = opts.now ?? (() => new Date())
  }

  /**
   * 扫描用户的所有 active memory,执行时间状态转换。
   * 返回转换统计与 change log。
   */
  apply(opts: { userId?: string } = {}): TemporalDreamerResult {
    const now = this.now()
    const items = this.opts.repository.list(opts.userId, {})
    const result: TemporalDreamerResult = {
      occurred: 0,
      expiredTemporal: 0,
      changedMemoryIds: [],
      changeLog: []
    }

    for (const item of items) {
      // 1) PLANNED + valid_until 已过 → OCCURRED(历史化)
      if (
        item.temporalState === TemporalState.PLANNED &&
        item.validUntil &&
        this.isPast(item.validUntil, now)
      ) {
        const historyContent = historizePlannedContent(item.content, { validUntil: item.validUntil })
        item.transitionToOccurred(historyContent, {
          actor: 'dream.temporal',
          reason: `planned event window ended (${item.validUntil})`
        })
        this.opts.repository.upsert(item)
        result.occurred += 1
        result.changedMemoryIds.push(item.id)
        result.changeLog.push({
          memoryId: item.id,
          from: TemporalState.PLANNED,
          to: TemporalState.OCCURRED,
          reason: `valid_until ${item.validUntil} has passed; content historized`
        })
        continue
      }

      // 2) CURRENT + valid_until 已过 → temporal EXPIRED(不删,仅标记失效)
      if (
        item.temporalState === TemporalState.CURRENT &&
        item.validUntil &&
        this.isPast(item.validUntil, now)
      ) {
        item.temporalState = TemporalState.EXPIRED
        item.metadata = {
          ...item.metadata,
          temporal_expired_at: nowIso(),
          temporal_expired_reason: `valid_until ${item.validUntil} passed`
        }
        if (item.schemaVersion < 3) item.schemaVersion = 3
        this.opts.repository.upsert(item)
        result.expiredTemporal += 1
        result.changedMemoryIds.push(item.id)
        result.changeLog.push({
          memoryId: item.id,
          from: TemporalState.CURRENT,
          to: TemporalState.EXPIRED,
          reason: `valid_until ${item.validUntil} has passed`
        })
      }
    }

    // 写一条汇总 change log 事件
    if (result.changedMemoryIds.length > 0) {
      this.opts.repository.logEvent('temporal_dream', {
        userId: opts.userId,
        payload: {
          occurred: result.occurred,
          expired_temporal: result.expiredTemporal,
          changed: result.changedMemoryIds,
          change_log: result.changeLog
        }
      })
    }
    return result
  }

  private isPast(isoTs: string, now: Date): boolean {
    const d = new Date(isoTs)
    if (Number.isNaN(d.getTime())) return false
    return d <= now
  }
}
