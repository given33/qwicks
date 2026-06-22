import { describe, expect, it } from 'vitest'
import { canMarry, defaultMarriage, divorce, generateSuitor, layEgg, marry } from './pet-marriage'
import type { PetGrowth } from './pet-growth'

const adult: PetGrowth = { stage: 'adult', stageEnteredAt: 0, gender: 'GG', level: 5, exp: 0 }
const kid: PetGrowth = { stage: 'kid', stageEnteredAt: 0, gender: 'GG', level: 2, exp: 0 }

describe('canMarry', () => {
  it('only adults can marry', () => {
    expect(canMarry(adult)).toBe(true)
    expect(canMarry(kid)).toBe(false)
  })
})

describe('generateSuitor', () => {
  it('returns id and name', () => {
    const s = generateSuitor()
    expect(s.id.length).toBeGreaterThan(0)
    expect(s.name.length).toBeGreaterThan(0)
  })
})

describe('marry', () => {
  it('sets partner on marriage', () => {
    const s = generateSuitor(() => 0.5)
    const m = marry(defaultMarriage(), s, 1000)
    expect(m.partnerId).toBe(s.id)
    expect(m.partnerName).toBe(s.name)
    expect(m.marriedAt).toBe(1000)
  })
  it('cannot remarry while married', () => {
    const s1 = generateSuitor(() => 0.1)
    const s2 = generateSuitor(() => 0.9)
    const m1 = marry(defaultMarriage(), s1, 1000)
    const m2 = marry(m1, s2, 2000)
    expect(m2.partnerId).toBe(s1.id) // 不变
  })
})

describe('layEgg', () => {
  it('requires marriage', () => {
    expect(layEgg(defaultMarriage(), 1000).laid).toBe(false)
  })
  it('lays egg when married', () => {
    const m = marry(defaultMarriage(), generateSuitor(), 1000)
    const r = layEgg(m, 2000)
    expect(r.laid).toBe(true)
    expect(r.state.eggs).toBe(1)
  })
})

describe('divorce', () => {
  it('resets to default', () => {
    const m = marry(defaultMarriage(), generateSuitor(), 1000)
    const d = divorce(m)
    expect(d.partnerId).toBeNull()
    expect(d.marriedAt).toBeNull()
    expect(d.eggs).toBe(0)
  })
})
