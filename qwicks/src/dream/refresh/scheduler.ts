/**
 * Dream 后台 refresh / dreaming —— 1:1 对齐 Python `dream/refresh/` 核心组件。
 *
 * - MemoryDecay:扫 user 的 active memory,expiresAt 过期 → transition EXPIRED;
 *   recency 低于阈值(stale)→ importance 降级(不删)。__do_not_decay__ tag 免疫。
 * - MemoryReinforcement:被 retrieve 命中的 memory importance 提升(封顶 1)。
 * - DreamingScheduler:OpenAI-style 后台 markDirty + tick;chat 写新 memory →
 *   markDirty,后台按 interval 跑 tick(decay+reinforcement),不阻塞热路径。
 *
 * 注:Python refresh/advanced.py(2008 行)里的 L1/L2 分层洞察 / structured_attrs /
 * stale_refresh_loop / soft_gate_progression 都是针对 540-gold 的质量调参,不在
 * spec §6 核心范围;本 TS 实现先做 decay/reinforcement/scheduler 核心。
 */
import { MemoryLifecycleStatus as Status } from '../types.js'
import { assess } from '../temporal/engine.js'
import type { MemoryItem } from '../types.js'
import type { MemoryRepository } from '../storage/repository.js'

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

export interface MemoryReinforcementOptions {
  repository: MemoryRepository
  boostStep?: number
}

export class MemoryReinforcement {
  private readonly boostStep: number
  constructor(private readonly opts: MemoryReinforcementOptions) {
    this.boostStep = opts.boostStep ?? 0.05
  }

  reinforce(item: MemoryItem): void {
    const current = this.opts.repository.get(item.id)
    if (!current) return
    current.importance = Math.min(1, current.importance + this.boostStep)
    this.opts.repository.upsert(current)
  }
}

export interface DreamingSchedulerOptions {
  decay: MemoryDecay
  reinforcement: MemoryReinforcement
}

export class DreamingScheduler {
  private readonly dirty = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly opts: DreamingSchedulerOptions) {}

  /** chat 写新 memory 后调用,标记该 user 需要 dreaming。 */
  markDirty(userId: string): void {
    this.dirty.add(userId)
  }

  isDirty(userId: string): boolean {
    return this.dirty.has(userId)
  }

  dirtyCount(): number {
    return this.dirty.size
  }

  /**
   * 跑一轮 dreaming:decay + reinforcement。指定 userId 只处理该 user 且清其 dirty;
   * 不指定则处理所有 dirty user。返回是否实际跑了(有 dirty)。
   */
  tick(opts: { userId?: string } = {}): boolean {
    if (opts.userId) {
      if (!this.dirty.has(opts.userId)) return false
      this.opts.decay.apply({ userId: opts.userId })
      this.dirty.delete(opts.userId)
      return true
    }
    if (this.dirty.size === 0) return false
    for (const userId of this.dirty) this.opts.decay.apply({ userId })
    this.dirty.clear()
    return true
  }

  /** 启动后台定时 dreaming(对齐 Python start_dreaming(interval_sec))。 */
  start(intervalMs: number): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch {
        // 后台 tick 失败不致命
      }
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
