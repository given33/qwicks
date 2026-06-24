import { describe, expect, it } from 'vitest'
import { resolveMemoryBackend } from './app-settings-qwicks'

describe('resolveMemoryBackend', () => {
  it('defaults to file when absent (old install)', () => {
    expect(resolveMemoryBackend(undefined)).toBe('file')
    expect(resolveMemoryBackend({})).toBe('file')
  })
  it('returns dream when explicitly set', () => {
    expect(resolveMemoryBackend({ memoryBackend: 'dream' })).toBe('dream')
  })
  it('coerces garbage back to file', () => {
    expect(resolveMemoryBackend({ memoryBackend: 'weird' })).toBe('file')
  })
})
