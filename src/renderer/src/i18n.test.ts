import { describe, expect, it } from 'vitest'
import { pickLanguageFromNavigator } from './i18n'

describe('pickLanguageFromNavigator', () => {
  it('returns zh when the OS UI language is Chinese', () => {
    expect(pickLanguageFromNavigator({ language: 'zh-CN', languages: ['zh-CN', 'zh', 'en'] })).toBe('zh')
  })

  it('returns zh for Chinese variants (zh-TW, zh-HK)', () => {
    expect(pickLanguageFromNavigator({ language: 'zh-TW' })).toBe('zh')
    expect(pickLanguageFromNavigator({ language: 'zh-HK', languages: ['zh-HK'] })).toBe('zh')
  })

  it('falls back to English for a non-Chinese system', () => {
    expect(pickLanguageFromNavigator({ language: 'en-US', languages: ['en-US', 'en'] })).toBe('en')
    expect(pickLanguageFromNavigator({ language: 'ja-JP', languages: ['ja-JP'] })).toBe('en')
  })

  it('treats a zh entry anywhere in the preference list as Chinese', () => {
    // Some systems list the UI language first and English second; the inverse
    // (English UI + Chinese as a secondary) must still be English.
    expect(pickLanguageFromNavigator({ language: 'en-US', languages: ['en-US', 'zh-CN'] })).toBe('en')
    expect(pickLanguageFromNavigator({ language: 'zh-CN', languages: ['zh-CN', 'en-US'] })).toBe('zh')
  })

  it('defaults to English when navigator is unavailable (SSR/no-DOM)', () => {
    expect(pickLanguageFromNavigator(undefined)).toBe('en')
    expect(pickLanguageFromNavigator({})).toBe('en')
  })
})
