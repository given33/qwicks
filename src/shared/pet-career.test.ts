import { describe, expect, it } from 'vitest'
import {
  canEnroll, canWork, completeEducation, defaultCareer, EDUCATION_LEVELS,
  educationName, highestEligibleJob, JOBS, workReward
} from './pet-career'

describe('education system', () => {
  it('7 levels from kindergarten to phd', () => {
    expect(EDUCATION_LEVELS).toHaveLength(7)
    expect(EDUCATION_LEVELS[0].id).toBe('kindergarten')
    expect(EDUCATION_LEVELS[6].id).toBe('phd')
  })

  it('can enroll kindergarten with no prereq', () => {
    expect(canEnroll(defaultCareer(), 'kindergarten').ok).toBe(true)
  })

  it('cannot skip levels', () => {
    expect(canEnroll(defaultCareer(), 'college').ok).toBe(false)
  })

  it('complete education boosts stats and sets level', () => {
    const after = completeEducation(defaultCareer(), 'kindergarten')
    expect(after.stats.intelligence).toBeGreaterThan(0)
    expect(after.education).toBe('kindergarten')
    expect(canEnroll(after, 'primary').ok).toBe(true)
  })

  it('phd requires high intelligence', () => {
    expect(canEnroll({ ...defaultCareer(), education: 'master' as const }, 'phd').ok).toBe(false)
    const smart = { ...defaultCareer(), education: 'master' as const, stats: { intelligence: 150, charm: 50, strength: 30 } }
    expect(canEnroll(smart, 'phd').ok).toBe(true)
  })
})

describe('job system', () => {
  it('8 jobs with increasing salary', () => {
    expect(JOBS).toHaveLength(8)
    expect(JOBS[0].salary).toBeLessThan(JOBS[7].salary)
  })

  it('cleaner has no requirement', () => {
    expect(canWork(defaultCareer(), 'cleaner').ok).toBe(true)
  })

  it('ceo requires master + high stats', () => {
    expect(canWork(defaultCareer(), 'ceo').ok).toBe(false)
    const elite = {
      education: 'master' as const,
      stats: { intelligence: 200, charm: 100, strength: 50 },
      currentJob: null
    }
    expect(canWork(elite, 'ceo').ok).toBe(true)
  })

  it('workReward gives coins and fatigue', () => {
    const r = workReward('ceo')
    expect(r.coins).toBe(250)
    expect(r.moodDelta).toBeLessThan(0)
  })

  it('highestEligibleJob returns best available', () => {
    expect(highestEligibleJob(defaultCareer())).toBe('cleaner')
    const grad = {
      education: 'college' as const,
      stats: { intelligence: 100, charm: 50, strength: 30 },
      currentJob: null
    }
    expect(['engineer', 'teacher']).toContain(highestEligibleJob(grad))
  })
})

describe('educationName', () => {
  it('null → 未入学', () => {
    expect(educationName(null)).toBe('未入学')
  })
  it('known level → 中文名', () => {
    expect(educationName('phd')).toBe('博士')
  })
})
