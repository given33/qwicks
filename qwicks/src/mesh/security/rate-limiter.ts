/**
 * Per-peer, per-method rate limiting (RFC 006 §6).
 *
 * Fixed-window counter: each (deviceId, method) pair gets a quota of calls per
 * window. The clock is injectable so the window logic is deterministic in tests.
 * On a denied call the caller can ask for `retryAfterMs` to populate the
 * JSON-RPC `-32001 rate_limited` response's `retryAfter`.
 */

interface Bucket {
  count: number
  windowStart: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxCalls: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(opts: { maxCalls: number; windowSeconds: number }, now?: () => number) {
    this.maxCalls = opts.maxCalls
    this.windowMs = opts.windowSeconds * 1000
    this.now = now ?? (() => Date.now())
  }

  checkAndConsume(deviceId: string, method: string): boolean {
    const key = `${deviceId}|${method}`
    const t = this.now()
    let bucket = this.buckets.get(key)
    if (!bucket || t - bucket.windowStart >= this.windowMs) {
      bucket = { count: 0, windowStart: t }
      this.buckets.set(key, bucket)
    }
    if (bucket.count >= this.maxCalls) return false
    bucket.count += 1
    return true
  }

  retryAfterMs(deviceId: string, method: string): number {
    const key = `${deviceId}|${method}`
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    const elapsed = this.now() - bucket.windowStart
    const remaining = this.windowMs - elapsed
    return remaining > 0 ? remaining : 0
  }
}
