import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

export const IQWICKS_MODE_STORAGE_KEY = 'qwicks.iqwicksMode'

export function readIqwicksModePreference(): boolean {
  const value = readBrowserStorageItem(IQWICKS_MODE_STORAGE_KEY)?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

export function writeIqwicksModePreference(enabled: boolean): void {
  writeBrowserStorageItem(IQWICKS_MODE_STORAGE_KEY, enabled ? '1' : '0')
}
