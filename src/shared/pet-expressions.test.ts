import { describe, expect, it } from 'vitest'
import { PET_EXPRESSIONS, deriveExpression, getExpression, validateExpressions } from './pet-expressions'

describe('PET_EXPRESSIONS', () => {
  it('has at least 20 expressions (richness beyond 9 frames)', () => {
    expect(Object.keys(PET_EXPRESSIONS).length).toBeGreaterThanOrEqual(20)
  })

  it('passes validation', () => {
    expect(validateExpressions()).toEqual([])
  })

  it('covers core + nuanced emotions', () => {
    const required = ['happy', 'sad', 'surprised', 'angry', 'shy', 'love', 'hungry', 'curious']
    for (const e of required) {
      expect(PET_EXPRESSIONS[e]).toBeDefined()
    }
  })
})

describe('getExpression', () => {
  it('returns params for known mood', () => {
    expect(getExpression('happy').eyes).toBe('happy')
  })
  it('falls back to neutral for unknown', () => {
    expect(getExpression('nonexistent')).toEqual(getExpression('neutral'))
  })
})

describe('deriveExpression', () => {
  const base = { status: 'healthy', mood: 70, hunger: 80, health: 90, isIdle: true }

  it('dragged → scared', () => {
    expect(deriveExpression({ ...base, beingDragged: true })).toBe('scared')
  })
  it('petted → content', () => {
    expect(deriveExpression({ ...base, beingPetted: true })).toBe('content')
  })
  it('collapsed → dizzy', () => {
    expect(deriveExpression({ ...base, status: 'collapsed' })).toBe('dizzy')
  })
  it('low hunger → hungry', () => {
    expect(deriveExpression({ ...base, hunger: 20 })).toBe('hungry')
  })
  it('low mood → sad', () => {
    expect(deriveExpression({ ...base, mood: 15 })).toBe('sad')
  })
  it('high mood idle → happy', () => {
    expect(deriveExpression({ ...base, mood: 85, isIdle: true })).toBe('happy')
  })
  it('healthy neutral default', () => {
    expect(deriveExpression({ ...base, mood: 50, hunger: 80 })).toBe('neutral')
  })
})
