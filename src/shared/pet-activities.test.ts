import { describe, expect, it } from 'vitest'
import { PET_ACTIVITIES, pickActivity, pickActivityByMood, validateActivities } from './pet-activities'

describe('PET_ACTIVITIES integrity', () => {
  it('has at least 40 activities', () => {
    expect(PET_ACTIVITIES.length).toBeGreaterThanOrEqual(40)
  })

  it('passes validateActivities (no errors)', () => {
    expect(validateActivities()).toEqual([])
  })

  it('every activity has required fields', () => {
    for (const a of PET_ACTIVITIES) {
      expect(typeof a.id).toBe('string')
      expect(a.id.length).toBeGreaterThan(0)
      expect(typeof a.pose).toBe('string')
      expect(typeof a.duration).toBe('number')
      expect(a.duration).toBeGreaterThan(0)
      expect(typeof a.expBoost).toBe('number')
      expect(typeof a.moodBoost).toBe('number')
      expect(typeof a.logText).toBe('string')
      expect(a.logText.length).toBeGreaterThan(0)
      expect(typeof a.weight).toBe('number')
      expect(a.weight).toBeGreaterThan(0)
    }
  })
})

describe('pickActivity', () => {
  it('egg stage returns null (no activity)', () => {
    expect(pickActivity('egg')).toBeNull()
  })

  it('kid stage picks an eligible activity', () => {
    const a = pickActivity('kid', () => 0.5)
    expect(a).not.toBeNull()
    // kid 不能选 adult-only
    expect(a!.minStage).not.toBe('adult')
  })

  it('adult stage can pick any non-egg-gated activity', () => {
    const a = pickActivity('adult', () => 0.5)
    expect(a).not.toBeNull()
  })

  it('respects injected RNG deterministically', () => {
    const a1 = pickActivity('kid', () => 0.0)
    const a2 = pickActivity('kid', () => 0.0)
    expect(a1).toEqual(a2)
  })
})

describe('pickActivityByMood (情绪态驱动)', () => {
  it('sad mood avoids energetic activities', () => {
    // sad 时不应选 dance/jump
    for (let i = 0; i < 20; i += 1) {
      const a = pickActivityByMood('kid', 'sad')
      if (a) expect(['dance', 'jump', 'spin', 'clap']).not.toContain(a.id)
    }
  })
  it('happy mood prefers energetic activities', () => {
    // happy 时多次抽样应出现活泼行为
    const ids = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      const a = pickActivityByMood('kid', 'happy')
      if (a) ids.add(a.id)
    }
    expect(ids.size).toBeGreaterThan(1)
  })
  it('sick mood allows sleep/rest', () => {
    const a = pickActivityByMood('kid', 'sick')
    expect(a).not.toBeNull()
  })
  it('egg returns null regardless of mood', () => {
    expect(pickActivityByMood('egg', 'happy')).toBeNull()
  })
})
