import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimiter } from '@qwicks/mesh/security/rate-limiter.js'

describe('RateLimiter (RFC 006 §6)', () => {
  let now = 0
  beforeEach(() => {
    now = 0
  })

  it('allows up to the per-window quota then denies', () => {
    const limiter = new RateLimiter({ maxCalls: 3, windowSeconds: 60 }, () => now)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(false)
  })

  it('resets the window after it elapses', () => {
    const limiter = new RateLimiter({ maxCalls: 2, windowSeconds: 60 }, () => now)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    now += 61_000
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
  })

  it('tracks devices and methods independently', () => {
    const limiter = new RateLimiter({ maxCalls: 1, windowSeconds: 60 }, () => now)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-ccc', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'memory/query')).toBe(true)
  })

  it('returns retryAfterMs for a denied call', () => {
    const limiter = new RateLimiter({ maxCalls: 1, windowSeconds: 60 }, () => now)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(true)
    expect(limiter.checkAndConsume('d-bbb', 'tools/call')).toBe(false)
    now += 10_000
    expect(limiter.retryAfterMs('d-bbb', 'tools/call')).toBeGreaterThan(0)
  })
})
