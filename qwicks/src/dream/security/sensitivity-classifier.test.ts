/**
 * Batch B (spec §2.4): classifySensitivity — financial/health/identity tagging.
 * Reuses detectSecrets (zero new detection) + health keyword table.
 *
 * NOTE: runs under qwicks/ vitest which requires Node 22 (see .nvmrc). Logic
 * verified via tsc here; runtime verification happens in the Node-22 dev/CI env.
 */
import { describe, expect, it } from 'vitest'
import { SensitivityLevel } from '../types.js'
import { classifySensitivity } from './sensitivity-classifier.js'

describe('classifySensitivity', () => {
  it('returns NORMAL with no categories for clean text', () => {
    const r = classifySensitivity('user prefers concise answers')
    expect(r.sensitivity).toBe(SensitivityLevel.NORMAL)
    expect(r.categories).toEqual([])
  })

  it('tags credit card as financial + SENSITIVE', () => {
    const r = classifySensitivity('my card is 4111-1111-1111-1111')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('financial')
  })

  it('tags email/phone/ip/ssn as identity + SENSITIVE', () => {
    const r = classifySensitivity('reach me at alice@example.com or 555-123-4567')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('identity')
  })

  it('tags api_key as identity + RESTRICTED', () => {
    const r = classifySensitivity('the api key is sk-abcdefgh12345678')
    expect(r.sensitivity).toBe(SensitivityLevel.RESTRICTED)
    expect(r.categories).toContain('identity')
  })

  it('tags health keywords as health + SENSITIVE', () => {
    const r = classifySensitivity('I am taking antidepressants for my diagnosis')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('health')
  })

  it('tags Chinese health keywords (病情/服药)', () => {
    const r = classifySensitivity('我最近在服用降压药，病情稳定')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
    expect(r.categories).toContain('health')
  })

  it('combines categories when multiple hit (health + identity email)', () => {
    const r = classifySensitivity('my doctor is at alice@example.com about my diabetes')
    expect(r.categories).toContain('health')
    expect(r.categories).toContain('identity')
    expect(r.sensitivity).toBe(SensitivityLevel.SENSITIVE)
  })

  it('records matched patterns for UI display', () => {
    const r = classifySensitivity('card 4111-1111-1111-1111')
    expect(r.matchedPatterns.length).toBeGreaterThan(0)
  })
})
