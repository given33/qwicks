import { describe, expect, it } from 'vitest'
import { checkAchievements, defaultStats, PET_ACHIEVEMENTS } from './pet-achievements'

describe('PET_ACHIEVEMENTS', () => {
  it('has multiple categories', () => {
    const cats = new Set(PET_ACHIEVEMENTS.map((a) => a.category))
    expect(cats.has('growth')).toBe(true)
    expect(cats.has('care')).toBe(true)
    expect(cats.has('survival')).toBe(true)
    expect(cats.has('play')).toBe(true)
    expect(cats.has('collection')).toBe(true)
  })

  it('has at least 15 achievements', () => {
    expect(PET_ACHIEVEMENTS.length).toBeGreaterThanOrEqual(15)
  })

  it('ids are unique', () => {
    const ids = PET_ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('checkAchievements', () => {
  it('empty stats unlock nothing', () => {
    const r = checkAchievements(defaultStats(), [])
    expect(r.newlyUnlocked).toHaveLength(0)
  })

  it('feed milestones unlock progressively', () => {
    expect(checkAchievements({ ...defaultStats(), feedCount: 10 }, []).newlyUnlocked).toContain('feed-10')
    expect(checkAchievements({ ...defaultStats(), feedCount: 100 }, []).newlyUnlocked).toContain('feed-100')
  })

  it('does not re-unlock already unlocked', () => {
    const stats = { ...defaultStats(), feedCount: 10 }
    const r1 = checkAchievements(stats, [])
    expect(r1.newlyUnlocked).toContain('feed-10')
    const r2 = checkAchievements(stats, r1.newlyUnlocked)
    expect(r2.newlyUnlocked).not.toContain('feed-10')
  })

  it('level achievements gate correctly', () => {
    expect(checkAchievements({ ...defaultStats(), maxLevel: 7 }, []).newlyUnlocked).toContain('level-3')
    expect(checkAchievements({ ...defaultStats(), maxLevel: 7 }, []).newlyUnlocked).toContain('level-7')
  })

  it('survival achievements are hidden but still triggerable', () => {
    const r = checkAchievements({ ...defaultStats(), revivedCount: 1 }, [])
    expect(r.newlyUnlocked).toContain('survive-collapse')
  })
})
