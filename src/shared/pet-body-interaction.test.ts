import { describe, expect, it } from 'vitest'
import { BODY_PARTS, bodyReact, deriveInteractionMood, pickBodyPart, validateBodyMatrix } from './pet-body-interaction'

describe('pet-body-interaction', () => {
  it('has 8 body parts', () => {
    expect(BODY_PARTS).toHaveLength(8)
  })

  it('matrix has 32 reactions (8 parts × 4 moods)', () => {
    expect(validateBodyMatrix()).toEqual([])
  })

  it('belly+happy gives most mood (sweet spot)', () => {
    const r = bodyReact('belly', 'happy')
    expect(r.moodDelta).toBe(15)
    expect(r.expression).toBe('excited')
  })

  it('belly+sick is negative (do not touch sick belly)', () => {
    expect(bodyReact('belly', 'sick').moodDelta).toBeLessThan(0)
  })

  it('head+sad gives comfort boost', () => {
    expect(bodyReact('head', 'sad').moodDelta).toBeGreaterThan(5)
  })

  it('tail+happy is very positive', () => {
    expect(bodyReact('tail', 'happy').moodDelta).toBeGreaterThan(10)
  })

  it('every reaction has expression + text', () => {
    for (const part of BODY_PARTS) {
      for (const mood of ['happy', 'neutral', 'sad', 'sick'] as const) {
        const r = bodyReact(part.id, mood)
        expect(typeof r.expression).toBe('string')
        expect(r.text.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('deriveInteractionMood', () => {
  it('sick when health < 30', () => {
    expect(deriveInteractionMood({ mood: 80, health: 20 })).toBe('sick')
  })
  it('sad when mood < 30', () => {
    expect(deriveInteractionMood({ mood: 20, health: 80 })).toBe('sad')
  })
  it('happy when mood > 70 and healthy', () => {
    expect(deriveInteractionMood({ mood: 85, health: 80 })).toBe('happy')
  })
  it('neutral otherwise', () => {
    expect(deriveInteractionMood({ mood: 50, health: 80 })).toBe('neutral')
  })
})

describe('pickBodyPart', () => {
  it('returns a valid part', () => {
    const ids = BODY_PARTS.map((p) => p.id)
    expect(ids).toContain(pickBodyPart())
  })
})
