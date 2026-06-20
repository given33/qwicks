import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'
import { IQWICKS_MODE_STORAGE_KEY } from './iqwicks-mode'

/**
 * 形象模式偏好:'default' | 'iqwicks' | <UI 插件 id>。
 * 取代旧的布尔型 qwicks.iqwicksMode(读取时自动迁移)。
 */
export const UI_MODE_STORAGE_KEY = 'qwicks.uiMode'

export const UI_MODE_DEFAULT = 'default'
export const UI_MODE_IQWICKS = 'iqwicks'

const UI_MODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

export function readUiModePreference(): string {
  const stored = readBrowserStorageItem(UI_MODE_STORAGE_KEY)?.trim().toLowerCase()
  if (stored && (stored === UI_MODE_DEFAULT || UI_MODE_PATTERN.test(stored))) {
    return stored
  }
  // 迁移:旧的 iQWicks 开关
  const legacy = readBrowserStorageItem(IQWICKS_MODE_STORAGE_KEY)?.trim().toLowerCase()
  if (legacy === '1' || legacy === 'true' || legacy === 'on') {
    return UI_MODE_IQWICKS
  }
  return UI_MODE_DEFAULT
}

export function writeUiModePreference(mode: string): void {
  writeBrowserStorageItem(UI_MODE_STORAGE_KEY, mode)
  // 同步旧键,兼容尚未迁移的读取方
  writeBrowserStorageItem(IQWICKS_MODE_STORAGE_KEY, mode === UI_MODE_IQWICKS ? '1' : '0')
}
