import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'
import zhCommon from './locales/zh/common.json'
import enSettings from './locales/en/settings.json'
import zhSettings from './locales/zh/settings.json'

// Seed the UI language from the browser locale so the FIRST paint matches the
// system language (Chinese Windows → Chinese). The persisted user setting is
// applied later in boot() via applyI18nFromSettings, but boot() has to make an
// async IPC round-trip (getSettings) before it can switch languages — without
// this synchronous guess every launch would flash English text first.
// navigator.language reflects the OS UI language on Chromium.
export function detectInitialLanguage(): 'en' | 'zh' {
  return pickLanguageFromNavigator(
    typeof navigator === 'undefined' ? undefined : navigator
  )
}

/** Pure helper (exported for testing): maps a navigator-like object to a locale. */
export function pickLanguageFromNavigator(nav: {
  languages?: readonly string[]
  language?: string
} | undefined): 'en' | 'zh' {
  if (!nav) return 'en'
  // The UI language is the FIRST preferred language (navigator.language /
  // languages[0]). A Chinese entry only in a secondary slot means the OS UI
  // is English, so the app should boot in English.
  const primary = nav.languages?.length ? nav.languages[0] : nav.language
  return typeof primary === 'string' && primary.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, settings: enSettings },
    zh: { common: zhCommon, settings: zhSettings }
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  defaultNS: 'common',
  ns: ['common', 'settings']
})

export default i18n
