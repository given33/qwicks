/**
 * Task lease (RFC 007 §4, §6.1, §6.2).
 *
 * An orchestrator-side watchdog for each in-flight remote Task. The worker
 * must heartbeat (or complete) within the lease window; otherwise the lease
 * expires and `onExpire(taskId)` fires so the orchestrator cancels the task and
 * reclaims it. Both the clock (`now`) and the timer (`schedule`) are injectable
 * so the expiry logic is deterministic in tests.
 */

export type ScheduleTimer = (fn: () => void, ms: number) => () => void

export interface LeaseOptions {
  leaseTimeoutMs: number
  heartbeatIntervalMs: number
  now?: () => number
  schedule?: ScheduleTimer
}

interface LeaseEntry {
  expiresAt: number
  cancel: () => void
  released: boolean
}

const realSchedule: ScheduleTimer = (fn, ms) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

export class TaskLease {
  private readonly leaseTimeoutMs: number
  private readonly now: () => number
  private readonly schedule: ScheduleTimer
  private readonly onExpire: (taskId: string) => void
  private readonly entries = new Map<string, LeaseEntry>()

  constructor(opts: LeaseOptions, onExpire: (taskId: string) => void) {
    this.leaseTimeoutMs = opts.leaseTimeoutMs
    this.now = opts.now ?? (() => Date.now())
    this.schedule = opts.schedule ?? realSchedule
    this.onExpire = onExpire
  }

  acquire(taskId: string): void {
    this.scheduleExpiry(taskId, this.now() + this.leaseTimeoutMs)
  }

  heartbeat(taskId: string): void {
    const entry = this.entries.get(taskId)
    if (!entry || entry.released) return
    this.scheduleExpiry(taskId, this.now() + this.leaseTimeoutMs)
  }

  release(taskId: string): void {
    const entry = this.entries.get(taskId)
    if (!entry) return
    entry.released = true
    entry.cancel()
    this.entries.delete(taskId)
  }

  private scheduleExpiry(taskId: string, expiresAt: number): void {
    const existing = this.entries.get(taskId)
    if (existing) existing.cancel()
    const delay = Math.max(0, expiresAt - this.now())
    const cancel = this.schedule(() => this.check(taskId), delay)
    this.entries.set(taskId, { expiresAt, cancel, released: false })
  }

  private check(taskId: string): void {
    const entry = this.entries.get(taskId)
    if (!entry || entry.released) return
    if (this.now() < entry.expiresAt) {
      // Heartbeat pushed the window out; reschedule for the new expiry.
      this.scheduleExpiry(taskId, entry.expiresAt)
      return
    }
    // Lease elapsed without a fresh heartbeat.
    this.entries.delete(taskId)
    this.onExpire(taskId)
  }
}
