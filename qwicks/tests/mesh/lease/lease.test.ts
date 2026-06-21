import { describe, it, expect, vi } from 'vitest'
import { TaskLease, type ScheduleTimer } from '@qwicks/mesh/lease/lease.js'

/** Fake timer: stores every scheduled callback and lets the test fire all
 *  pending ones at once. Returns a cancel that removes that callback. */
function fakeTimer(): { schedule: ScheduleTimer; fire: () => void } {
  const pending: Array<{ fn: () => void; active: boolean }> = []
  return {
    schedule: (fn, _ms) => {
      const entry = { fn, active: true }
      pending.push(entry)
      return () => {
        entry.active = false
      }
    },
    fire: () => {
      const snapshot = pending.splice(0)
      for (const entry of snapshot) if (entry.active) entry.fn()
    }
  }
}

describe('TaskLease (RFC 007 §4, §6.1, §6.2)', () => {
  it('fires onExpire when the lease elapses without a heartbeat', () => {
    let now = 1000
    const onExpire = vi.fn()
    const timer = fakeTimer()
    const lease = new TaskLease({ leaseTimeoutMs: 5000, heartbeatIntervalMs: 1000, now: () => now, schedule: timer.schedule }, onExpire)

    lease.acquire('task-1')
    expect(onExpire).not.toHaveBeenCalled()

    // Advance past the lease window and let the scheduled timer fire.
    now += 6000
    timer.fire()
    expect(onExpire).toHaveBeenCalledWith('task-1')
  })

  it('does not expire while heartbeats keep the lease alive', () => {
    let now = 0
    const onExpire = vi.fn()
    const timer = fakeTimer()
    const lease = new TaskLease({ leaseTimeoutMs: 5000, heartbeatIntervalMs: 1000, now: () => now, schedule: timer.schedule }, onExpire)

    lease.acquire('task-1')
    // A series of heartbeats, each before the window closes.
    for (let t = 1000; t <= 4000; t += 1000) {
      now = t
      lease.heartbeat('task-1')
    }
    now = 4500 // still within the refreshed window
    timer.fire()
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('does not fire after release', () => {
    let now = 0
    const onExpire = vi.fn()
    const timer = fakeTimer()
    const lease = new TaskLease({ leaseTimeoutMs: 5000, heartbeatIntervalMs: 1000, now: () => now, schedule: timer.schedule }, onExpire)

    lease.acquire('task-1')
    lease.release('task-1')
    now += 6000
    timer.fire()
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('tracks multiple tasks independently', () => {
    let now = 0
    const onExpire = vi.fn()
    const timer = fakeTimer()
    const lease = new TaskLease({ leaseTimeoutMs: 5000, heartbeatIntervalMs: 1000, now: () => now, schedule: timer.schedule }, onExpire)

    lease.acquire('task-1')
    lease.acquire('task-2')

    // task-1 stays alive via heartbeat; task-2 is left to expire.
    now = 4000
    lease.heartbeat('task-1') // task-1 expiry → 9000
    now = 6000 // past task-2's original 5000 window
    timer.fire()
    expect(onExpire).toHaveBeenCalledWith('task-2')
    expect(onExpire).not.toHaveBeenCalledWith('task-1')
  })
})
