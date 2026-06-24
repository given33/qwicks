import { describe, expect, it } from 'vitest'
import {
  canEnroll, canWork, completeEducation, defaultCareer, EDUCATION_LEVELS,
  educationName, highestEligibleJob, JOBS, workReward, statName, JOB_CATEGORY_NAMES
} from './pet-career'
import type { CareerState } from './pet-career'

describe('education system (2026 China)', () => {
  it('has 9 levels incl vocational track', () => {
    expect(EDUCATION_LEVELS).toHaveLength(9)
    const ids = EDUCATION_LEVELS.map((e) => e.id)
    expect(ids).toContain('vocational')  // 职高分流
    expect(ids).toContain('associate')   // 大专
  })

  it('9-year compulsory: kindergarten→middle chain', () => {
    let c = defaultCareer()
    expect(canEnroll(c, 'kindergarten').ok).toBe(true)
    c = completeEducation(c, 'kindergarten')
    expect(canEnroll(c, 'primary').ok).toBe(true)
    c = completeEducation(c, 'primary')
    expect(canEnroll(c, 'middle').ok).toBe(true)
  })

  it('streaming: after middle can go high OR vocational', () => {
    const afterMiddle: CareerState = { ...defaultCareer(), education: 'middle', stats: { intelligence: 40, charm: 10, strength: 20 } }
    expect(canEnroll(afterMiddle, 'high').ok).toBe(true)       // 普高需智力30
    expect(canEnroll(afterMiddle, 'vocational').ok).toBe(true) // 职高无门槛
  })

  it('college requires high (not vocational)', () => {
    const fromVoc: CareerState = { ...defaultCareer(), education: 'vocational', stats: { intelligence: 60, charm: 20, strength: 30 } }
    expect(canEnroll(fromVoc, 'college').ok).toBe(false) // 大学需普高
    expect(canEnroll(fromVoc, 'associate').ok).toBe(true) // 大专接职高
  })

  it('phd chain: master→phd with high intelligence', () => {
    const master: CareerState = { ...defaultCareer(), education: 'master', stats: { intelligence: 150, charm: 50, strength: 30 } }
    expect(canEnroll(master, 'phd').ok).toBe(true)
  })

  it('education boosts 3 stats', () => {
    const after = completeEducation(defaultCareer(), 'kindergarten')
    expect(after.stats.intelligence).toBeGreaterThan(0)
    expect(after.stats.charm).toBeGreaterThan(0)
    expect(after.stats.strength).toBeGreaterThan(0)
  })
})

describe('job system (2026 China, 35 jobs)', () => {
  it('has 30+ jobs across 10 categories', () => {
    expect(JOBS.length).toBeGreaterThanOrEqual(30)
    const cats = new Set(JOBS.map((j) => j.category))
    expect(cats.size).toBe(10)
  })

  it('covers 2026 new-economy jobs', () => {
    const ids = JOBS.map((j) => j.id)
    expect(ids).toContain('delivery')      // 外卖
    expect(ids).toContain('ride-hailing')  // 网约车
    expect(ids).toContain('ai-engineer')   // AI工程师
    expect(ids).toContain('streamer')      // 主播
    expect(ids).toContain('civil-servant') // 公务员
  })

  it('blue-collar high-strength jobs pay well without degree', () => {
    const strong: CareerState = { stats: { intelligence: 10, charm: 10, strength: 30 }, education: 'middle', currentJob: null }
    expect(canWork(strong, 'delivery').ok).toBe(true)
    expect(workReward('delivery').coins).toBeGreaterThan(workReward('factory').coins)
  })

  it('tech jobs need college+ and high intelligence', () => {
    const noDegree: CareerState = { stats: { intelligence: 120, charm: 30, strength: 30 }, education: 'middle', currentJob: null }
    expect(canWork(noDegree, 'programmer').ok).toBe(false)
    const grad: CareerState = { ...noDegree, education: 'college' }
    expect(canWork(grad, 'programmer').ok).toBe(true)
    expect(canWork(grad, 'ai-engineer').ok).toBe(false) // 需硕士
  })

  it('creative jobs unlocked by charm (no degree barrier)', () => {
    const charming: CareerState = { stats: { intelligence: 40, charm: 65, strength: 20 }, education: 'middle', currentJob: null }
    expect(canWork(charming, 'streamer').ok).toBe(true)
  })

  it('vocational track unlocks skill jobs', () => {
    const voc: CareerState = { stats: { intelligence: 30, charm: 25, strength: 20 }, education: 'vocational', currentJob: null }
    expect(canWork(voc, 'chef').ok).toBe(true)
    expect(canWork(voc, 'programmer').ok).toBe(false)
  })

  it('elite jobs (ceo/professor/scientist) are top-tier', () => {
    const top = workReward('ceo').coins
    expect(top).toBeGreaterThan(workReward('programmer').coins)
    expect(workReward('scientist').coins).toBeGreaterThan(workReward('doctor').coins)
  })

  it('highestEligibleJob scales with progression', () => {
    // defaultCareer 只能做零门槛工作（factory 22 > waiter 20 > ...）
    const starter = highestEligibleJob(defaultCareer())
    const starterDef = JOBS.find((j) => j.id === starter)
    expect(starterDef!.salary).toBeLessThanOrEqual(25)
    const grad: CareerState = { stats: { intelligence: 110, charm: 40, strength: 30 }, education: 'college', currentJob: null }
    const best = highestEligibleJob(grad)
    const bestDef = JOBS.find((j) => j.id === best)
    expect(bestDef!.salary).toBeGreaterThanOrEqual(100)
  })
})

describe('helpers', () => {
  it('educationName / statName', () => {
    expect(educationName(null)).toBe('未入学')
    expect(educationName('phd')).toBe('博士研究生')
    expect(statName('intelligence')).toBe('智力')
    expect(statName('charm')).toBe('魅力')
    expect(statName('strength')).toBe('体力')
  })

  it('JOB_CATEGORY_NAMES has all 10', () => {
    expect(Object.keys(JOB_CATEGORY_NAMES).length).toBe(10)
  })
})
