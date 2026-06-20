import { describe, expect, it } from 'vitest'
import { isQWicksHealthResponseBody } from './qwicks-health'

describe('isQWicksHealthResponseBody', () => {
  it('accepts QWicks serve health responses', () => {
    expect(isQWicksHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'qwicks',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isQWicksHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isQWicksHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})
