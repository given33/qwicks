import { describe, expect, it } from 'vitest'
import { getQWicksBaseUrl, normalizeLocalQWicksHost } from './qwicks-base-url'

describe('getQWicksBaseUrl', () => {
  it('uses 127.0.0.1 by default', () => {
    expect(getQWicksBaseUrl(8899)).toBe('http://127.0.0.1:8899')
  })

  it('formats IPv6 loopback hosts for URL use', () => {
    expect(getQWicksBaseUrl(8899, '::1')).toBe('http://[::1]:8899')
    expect(getQWicksBaseUrl(8899, '[::1]')).toBe('http://[::1]:8899')
  })

  it('accepts localhost aliases only', () => {
    expect(normalizeLocalQWicksHost('localhost')).toBe('localhost')
    expect(() => getQWicksBaseUrl(8899, 'example.com')).toThrow(/local host/)
  })
})
