import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  DEFAULT_LOG_RETENTION_DAYS,
  normalizeGuiUpdateChannel,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type ClawSettingsPatchV1,
  type GuiUpdateConfigV1,
  type NotificationConfigV1,
  type PetSettingsV1,
  type ScheduleSettingsPatchV1,
  WINDOW_CLOSE_ACTIONS,
  type WindowCloseAction,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultQWicksRuntimeSettings,
  getQWicksRuntimeSettings,
  qwicksSettingsEnvelope,
  mergeQWicksRuntimeSettings,
  migrateLegacyAppSettings
} from './app-settings-qwicks'
import {
  defaultMiniMaxMediaGenerationQWicksPatch,
  normalizeModelProviderSettings
} from './app-settings-provider'
import { normalizeDeepseekBaseUrl } from './app-settings-normalizers'
import { normalizeClawSettings } from './app-settings-claw'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWorkflowSettings } from './app-settings-workflow'
import { normalizeWriteSettings } from './app-settings-write'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const migrated = shouldMigrateLegacySettings(settings)
    ? migrateLegacyAppSettings(settings as Parameters<typeof migrateLegacyAppSettings>[0])
    : settings
  const maybeSettings = migrated as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    schedule?: ScheduleSettingsPatchV1
    workflow?: WorkflowSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
    pet?: Partial<PetSettingsV1>
  }
  const providerSettings = normalizeModelProviderSettings(maybeSettings.provider)
  const runtime = getQWicksRuntimeSettings(maybeSettings)
  const rawQWicks = maybeSettings.agents?.qwicks
  const rawMediaPatch: Parameters<typeof defaultMiniMaxMediaGenerationQWicksPatch>[0]['qwicksPatch'] = {
    ...(rawQWicks?.textToSpeech !== undefined ? { textToSpeech: rawQWicks.textToSpeech } : {}),
    ...(rawQWicks?.musicGeneration !== undefined ? { musicGeneration: rawQWicks.musicGeneration } : {}),
    ...(rawQWicks?.videoGeneration !== undefined ? { videoGeneration: rawQWicks.videoGeneration } : {})
  }
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationQWicksPatch({
    providers: providerSettings.providers,
    currentQWicks: runtime,
    qwicksPatch: rawMediaPatch
  })
  return {
    ...migrated,
    version: 1,
    locale: maybeSettings.locale === 'zh' ? 'zh' : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale:
      maybeSettings.uiFontScale === 'small' ||
      maybeSettings.uiFontScale === 'medium' ||
      maybeSettings.uiFontScale === 'large'
        ? maybeSettings.uiFontScale
        : 'small',
    cursorSpotlight: maybeSettings.cursorSpotlight !== false,
    provider: providerSettings,
    agents: qwicksSettingsEnvelope(mergeQWicksRuntimeSettings(defaultQWicksRuntimeSettings(), {
      ...runtime,
      baseUrl: runtime.baseUrl.trim() ? normalizeDeepseekBaseUrl(runtime.baseUrl) : '',
      ...(miniMaxMediaDefaults ?? {})
    })),
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: typeof maybeSettings.log?.retentionDays === 'number'
        ? maybeSettings.log.retentionDays
        : DEFAULT_LOG_RETENTION_DAYS
    },
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    claw: normalizeClawSettings(maybeSettings.claw),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    workflow: normalizeWorkflowSettings(maybeSettings.workflow),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : '',
    disabledSkillIds: normalizeDisabledSkillIds(maybeSettings.disabledSkillIds),
    pet: normalizePetSettings(maybeSettings.pet)
  }
}

function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().replace(/^\/?skill:/i, '').trim())
    .filter(Boolean))]
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  const closeAction = normalizeWindowCloseAction(settings?.closeAction)
    ?? (settings?.closeToTray === true ? 'tray' : 'ask')
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeAction,
    closeToTray: closeAction === 'tray'
  }
}

export function normalizeWindowCloseAction(value: unknown): WindowCloseAction | null {
  return typeof value === 'string' && WINDOW_CLOSE_ACTIONS.includes(value as WindowCloseAction)
    ? value as WindowCloseAction
    : null
}

export function mergeAppBehaviorSettings(
  current: AppBehaviorConfigV1,
  patch?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const translatedPatch: Partial<AppBehaviorConfigV1> | undefined =
    patch && patch.closeAction === undefined && patch.closeToTray !== undefined
      ? {
          ...patch,
          closeAction: patch.closeToTray ? 'tray' : 'quit'
        }
      : patch
  return normalizeAppBehaviorSettings({
    ...current,
    ...(translatedPatch ?? {})
  })
}

/** 桌面宠物设置的默认值与规范化（M1+）。 */
export function normalizePetSettings(settings?: Partial<PetSettingsV1>): PetSettingsV1 {
  const spriteScale = typeof settings?.spriteScale === 'number' && settings.spriteScale > 0
    ? settings.spriteScale
    : 1
  const diaryRetentionDays = typeof settings?.diaryRetentionDays === 'number' &&
    Number.isFinite(settings.diaryRetentionDays) && settings.diaryRetentionDays >= 1
    ? Math.floor(settings.diaryRetentionDays)
    : 90
  const growthSpeed = typeof settings?.growthSpeed === 'number' &&
    Number.isFinite(settings.growthSpeed) && settings.growthSpeed > 0
    ? settings.growthSpeed
    : 1
  return {
    enabled: settings?.enabled !== false,
    spriteScale,
    walkEnabled: settings?.walkEnabled !== false,
    consoleOnLaunch: settings?.consoleOnLaunch === true,
    diaryRetentionDays,
    growthSpeed
  }
}

export function mergePetSettings(current: PetSettingsV1, patch?: Partial<PetSettingsV1>): PetSettingsV1 {
  return normalizePetSettings({ ...current, ...(patch ?? {}) })
}

function shouldMigrateLegacySettings(settings: AppSettingsV1): boolean {
  const raw = settings as AppSettingsV1 & {
    agentProvider?: unknown
    deepseek?: unknown
    agents?: {
      qwicks?: Partial<ReturnType<typeof defaultQWicksRuntimeSettings>>
      codewhale?: unknown
      reasonix?: unknown
    }
  }
  if (!raw.agents?.qwicks) return true
  if ('agentProvider' in raw || 'deepseek' in raw) return true
  if (raw.agents.codewhale || raw.agents.reasonix) return true
  const dataDir = typeof raw.agents.qwicks.dataDir === 'string'
    ? raw.agents.qwicks.dataDir.replace(/\\/g, '/').toLowerCase()
    : ''
  return dataDir === '~/.deepseekgui/coreagent' || dataDir.endsWith('/.deepseekgui/coreagent')
}
