import { describe, expect, it } from 'vitest'
import { judgeCast, rollBiteDelay, rollCatch, BITE_MAX_MS, BITE_MIN_MS } from './fishing-logic'

describe('rollBiteDelay', () => {
  it('returns time within range', () => {
    const d = rollBiteDelay(() => 0.5)
    expect(d).toBeGreaterThanOrEqual(BITE_MIN_MS)
    expect(d).toBeLessThanOrEqual(BITE_MAX_MS)
  })
  it('min at rng 0, max at rng 1', () => {
    expect(rollBiteDelay(() => 0)).toBe(BITE_MIN_MS)
    expect(rollBiteDelay(() => 1)).toBe(BITE_MAX_MS)
  })
})

describe('rollCatch', () => {
  it('returns a valid catch', () => {
    const c = rollCatch(0)
    expect(c.value).toBeGreaterThan(0)
    expect(typeof c.name).toBe('string')
  })
  it('combo boosts rare chance', () => {
    // 高 combo 下多次抽样，稀有鱼应出现
    let rareCount = 0
    for (let i = 0; i < 200; i += 1) {
      if (rollCatch(10).rarity === 'rare') rareCount += 1
    }
    expect(rareCount).toBeGreaterThan(0)
  })
})

describe('judgeCast', () => {
  it('early cast (before bite) resets combo', () => {
    expect(judgeCast(1000, null, 3)).toEqual({ outcome: 'early', combo: 0 })
  })
  it('cast in bite window succeeds and increments combo', () => {
    const r = judgeCast(2000, 1500, 2)
    expect(r.outcome).toBe('success')
    if (r.outcome === 'success') {
      expect(r.combo).toBe(3)
      expect(r.catch).toBeDefined()
    }
  })
  it('cast after bite window escapes', () => {
    const r = judgeCast(5000, 1000, 2) // 咬钩在1000，5000才提，超窗口
    expect(r.outcome).toBe('escaped')
  })
})
