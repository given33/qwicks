import { describe, expect, it } from 'vitest'
import {
  pickWeather,
  seasonForDate,
  spawnDustParticles,
  stepParticles,
  SEASON_WEATHER_WEIGHTS
} from './pet-environment'

describe('seasonForDate', () => {
  it('maps months to seasons (northern hemisphere)', () => {
    expect(seasonForDate(new Date(2026, 2, 15))).toBe('spring')  // 3月
    expect(seasonForDate(new Date(2026, 6, 15))).toBe('summer')  // 7月
    expect(seasonForDate(new Date(2026, 9, 15))).toBe('autumn')  // 10月
    expect(seasonForDate(new Date(2026, 0, 15))).toBe('winter')  // 1月
    expect(seasonForDate(new Date(2026, 11, 15))).toBe('winter') // 12月
  })
})

describe('pickWeather', () => {
  it('respects weights via injected RNG', () => {
    // summer: sunny 0.8, rng=0.5 → sunny
    expect(pickWeather('summer', () => 0.5)).toBe('sunny')
    // winter: snow weight 0.4, rng 高值 → snow 或 fog
    const w = pickWeather('winter', () => 0.95)
    expect(['snow', 'fog', 'sunny']).toContain(w)
  })

  it('weights sum to consistent total per season', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const total = Object.values(SEASON_WEATHER_WEIGHTS[season]).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThan(0)
    }
  })
})

describe('spawnDustParticles', () => {
  it('creates requested count of particles', () => {
    const particles = spawnDustParticles(100, 200, 12)
    expect(particles).toHaveLength(12)
  })

  it('particles start at center', () => {
    const particles = spawnDustParticles(100, 200, 3)
    for (const p of particles) {
      expect(p.x).toBe(100)
      expect(p.y).toBe(200)
    }
  })

  it('particles have upward initial velocity', () => {
    const particles = spawnDustParticles(0, 0, 5, () => 0.5)
    for (const p of particles) {
      expect(p.vy).toBeLessThanOrEqual(0) // 向上（屏幕坐标 y 减小）
    }
  })
})

describe('stepParticles', () => {
  it('ages and moves particles, applies gravity', () => {
    const particles = spawnDustParticles(0, 0, 1, () => 0.5)
    const before = particles[0]
    const stepped = stepParticles(particles, 100)
    expect(stepped).toHaveLength(1)
    expect(stepped[0].life).toBeLessThan(before.life)
    expect(stepped[0].vy).toBeGreaterThan(before.vy) // 重力让 vy 增大
  })

  it('removes dead particles', () => {
    const particles = spawnDustParticles(0, 0, 1, () => 0.5)
    // 推进远超寿命
    const stepped = stepParticles(particles, 100000)
    expect(stepped).toHaveLength(0)
  })
})
