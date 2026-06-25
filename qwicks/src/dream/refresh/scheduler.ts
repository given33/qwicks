/**
 * Dream 后台 refresh / dreaming —— 1:1 对齐 Python `dream/refresh/` 核心组件。
 *
 * - MemoryDecay:扫 user 的 active memory,expiresAt 过期 → transition EXPIRED;
 *   recency 低于阈值(stale)→ importance 降级(不删)。__do_not_decay__ tag 免疫。
 *   (B5:recency 改读 lastUsedAt ?? createdAt,不再被 upsert 刷新污染。)
 * - 强化(importance 提升):历史上有个 MemoryReinforcement 类,但 tick/forceTick
 *   从不调用它 → 死代码。B2+B3+B5 已把强化收口到检索侧的 `repository.reinforceUsed`
 *   批量 UPDATE(在 retrieve/beforeTurn 切完最终注入集后调一次),故此处不再持有它。
 * - DreamingScheduler:OpenAI-style 后台 markDirty + tick;chat 写新 memory →
 *   markDirty,后台按 interval 跑 tick(decay + temporal + top-of-mind),不阻塞热路径。
 *
 * 注:Python refresh/advanced.py(2008 行)里的 L1/L2 分层洞察 / structured_attrs /
 * stale_refresh_loop / soft_gate_progression 都是针对 540-gold 的质量调参,不在
 * spec §6 核心范围;本 TS 实现先做 decay/scheduler 核心。
 */
import { MemoryLifecycleStatus as Status } from '../types.js'
import { assess } from '../temporal/engine.js'
import type { MemoryRepository } from '../storage/repository.js'
import type { TemporalDreamer } from './temporal-dreamer.js'
import type { TopOfMindBalancer } from './top-of-mind.js'

const DO_NOT_DECAY_TAG = '__do_not_decay__'

export interface MemoryDecayOptions {
  repository: MemoryRepository
  staleThreshold?: number
  demoteStep?: number
  halfLifeDays?: number
}

export class MemoryDecay {
  private readonly staleThreshold: number
  private readonly demoteStep: number
  private readonly halfLifeDays: number
  constructor(private readonly opts: MemoryDecayOptions) {
    this.staleThreshold = opts.staleThreshold ?? 0.25
    this.demoteStep = opts.demoteStep ?? 0.1
    this.halfLifeDays = opts.halfLifeDays ?? 60
  }

  apply(opts: { userId?: string; now?: Date } = {}): { expired: number; demoted: number } {
    const now = opts.now ?? new Date()
    const items = this.opts.repository.list(opts.userId, {})
    let expired = 0
    let demoted = 0
    for (const it of items) {
      if (it.tags.includes(DO_NOT_DECAY_TAG)) continue
      // 1) 过期 → EXPIRED
      if (it.expiresAt) {
        const exp = new Date(it.expiresAt)
        if (!Number.isNaN(exp.getTime()) && exp <= now) {
          it.transitionStatus(Status.EXPIRED, { actor: 'dream.decay', reason: 'expires_at passed' })
          this.opts.repository.upsert(it)
          expired += 1
          continue
        }
      }
      // 2) stale → importance 降级(不删)
      const a = assess(it, { now, halfLifeDays: this.halfLifeDays, staleThreshold: this.staleThreshold })
      if (a.isStale && it.importance > 0.1) {
        it.importance = Math.max(0.1, it.importance - this.demoteStep)
        this.opts.repository.upsert(it)
        demoted += 1
      }
    }
    return { expired, demoted }
  }
}

export interface DreamingSchedulerOptions {
  decay: MemoryDecay
  /** v3:可选的时间状态转换器(planned→occurred 等)。 */
  temporalDreamer?: TemporalDreamer
  /** v3:可选的 top-of-mind 平衡器。 */
  topOfMindBalancer?: TopOfMindBalancer
  /** 3.1(工业级):持久化 dream_job 队列(可选;提供则 markDirty 入队 + tick 从队列处理)。 */
  repository?: import('../storage/repository.js').MemoryRepository
  /** Batch B(spec §2.5 要点6):可选的高敏感待确认 store —— tick 时清理 30 天未确认草稿。 */
  pendingStore?: import('../storage/pending-sensitive-store.js').PendingSensitiveStore
  /** Batch D(spec §4):可选的容量防护 —— tick 时检查 softLimit,自动降级最低价值记忆。 */
  capacityGuard?: import('./capacity-guard.js').MemoryCapacityGuard
}

export interface DreamingTickResult {
  ran: boolean
  /** v3:各阶段的转换统计(若有配置)。 */
  temporal?: import('./temporal-dreamer.js').TemporalDreamerResult
  topOfMind?: import('./top-of-mind.js').TopOfMindBalancerResult
}

export class DreamingScheduler {
  private readonly dirty = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly opts: DreamingSchedulerOptions) {}

  /** chat 写新 memory 后调用,标记该 user 需要 dreaming。
   *  3.1(工业级):同时入队 dream_job(持久化,重启不丢)。 */
  markDirty(userId: string): void {
    this.dirty.add(userId)
    // 3.1:持久化入队(幂等)
    if (this.opts.repository) {
      try {
        this.opts.repository.enqueueDreamJob({ type: 'dream_refresh', userId })
      } catch {
        // 入队失败不阻断热路径(in-memory dirty 仍有效)
      }
    }
  }

  isDirty(userId: string): boolean {
    return this.dirty.has(userId)
  }

  dirtyCount(): number {
    return this.dirty.size
  }

  /**
   * P1-E(差距P1-E):强制执行 dreaming,不检查内存 dirty set。
   * 供 durable dream_job worker 使用 —— job 从持久化队列 claim 后,
   * 即使内存 dirty set 在重启后丢失(该 user 不在 dirty 里),
   * 仍然执行 decay/temporal/top-of-mind。
   */
  forceTick(opts: { userId: string }): DreamingTickResult {
    this.opts.decay.apply({ userId: opts.userId })
    const temporal = this.opts.temporalDreamer?.apply({ userId: opts.userId })
    const topOfMind = this.opts.topOfMindBalancer?.apply({ userId: opts.userId })
    this.dirty.delete(opts.userId)
    return { ran: true, temporal, topOfMind }
  }

  /**
   * 跑一轮 dreaming:decay + reinforcement(+ v3 可选 temporal/top-of-mind)。
   * 指定 userId 只处理该 user 且清其 dirty;不指定则处理所有 dirty user。
   * 返回 DreamingTickResult(ran=true 表示实际跑了)。
   */
  tick(opts: { userId?: string } = {}): DreamingTickResult {
    // Batch B(spec §2.5 要点6):清理 30 天未确认的待确认草稿(纯老化,不留 tombstone)。
    if (this.opts.pendingStore) {
      try {
        this.opts.pendingStore.purgeStale(30)
      } catch {
        // fail-open: 清理失败不影响 dreaming 主循环。
      }
    }
    // Batch D(spec §4):检查 softLimit,自动降级最低价值记忆到 background。
    if (this.opts.capacityGuard && opts.userId) {
      try {
        this.opts.capacityGuard.run(opts.userId)
      } catch {
        // fail-open: 容量检查失败不影响 dreaming 主循环。
      }
    }
    if (opts.userId) {
      if (!this.dirty.has(opts.userId)) return { ran: false }
      this.opts.decay.apply({ userId: opts.userId })
      const temporal = this.opts.temporalDreamer?.apply({ userId: opts.userId })
      const topOfMind = this.opts.topOfMindBalancer?.apply({ userId: opts.userId })
      this.dirty.delete(opts.userId)
      return { ran: true, temporal, topOfMind }
    }
    if (this.dirty.size === 0) return { ran: false }
    let temporal: import('./temporal-dreamer.js').TemporalDreamerResult | undefined
    let topOfMind: import('./top-of-mind.js').TopOfMindBalancerResult | undefined
    for (const userId of this.dirty) {
      this.opts.decay.apply({ userId })
      const t = this.opts.temporalDreamer?.apply({ userId })
      const tom = this.opts.topOfMindBalancer?.apply({ userId })
      if (t) temporal = mergeTemporal(temporal, t)
      if (tom) topOfMind = mergeTopOfMind(topOfMind, tom)
    }
    this.dirty.clear()
    return { ran: true, temporal, topOfMind }
  }

  /** 启动后台定时 dreaming(对齐 Python start_dreaming(interval_sec))。 */
  start(intervalMs: number): void {
    if (this.timer) return
    const timer = setInterval(() => {
      try {
        this.tick()
      } catch {
        // 后台 tick 失败不致命
      }
    }, intervalMs)
    timer.unref?.()
    this.timer = timer
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/** 合并多次 apply 的 temporal 结果(跨 user)。 */
function mergeTemporal(
  acc: import('./temporal-dreamer.js').TemporalDreamerResult | undefined,
  next: import('./temporal-dreamer.js').TemporalDreamerResult
): import('./temporal-dreamer.js').TemporalDreamerResult {
  if (!acc) return next
  return {
    occurred: acc.occurred + next.occurred,
    expiredTemporal: acc.expiredTemporal + next.expiredTemporal,
    changedMemoryIds: [...acc.changedMemoryIds, ...next.changedMemoryIds],
    changeLog: [...acc.changeLog, ...next.changeLog]
  }
}

/** 合并多次 apply 的 top-of-mind 结果(跨 user)。 */
function mergeTopOfMind(
  acc: import('./top-of-mind.js').TopOfMindBalancerResult | undefined,
  next: import('./top-of-mind.js').TopOfMindBalancerResult
): import('./top-of-mind.js').TopOfMindBalancerResult {
  if (!acc) return next
  return {
    promoted: acc.promoted + next.promoted,
    demoted: acc.demoted + next.demoted,
    changedMemoryIds: [...acc.changedMemoryIds, ...next.changedMemoryIds]
  }
}
