import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultQWicksRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from './runtime-client'

function settings(apiKey: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      qwicks: {
        ...defaultQWicksRuntimeSettings(),
        apiKey
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: [],
    pet: { enabled: true, spriteScale: 1, walkEnabled: true, consoleOnLaunch: false, diaryRetentionDays: 90, growthSpeed: 1 }
  }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('rendererRuntimeClient', () => {
  it('caches settings reads until invalidated', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    vi.stubGlobal('window', {
      qwicksGui: {
        getSettings,
        setSettings: vi.fn(),
        runtimeRequest: vi.fn(),
        restartRuntime: vi.fn(),
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    const first = await rendererRuntimeClient.getSettings()
    const second = await rendererRuntimeClient.getSettings()

    expect(first.agents.qwicks.apiKey).toBe('sk-1')
    expect(second.agents.qwicks.apiKey).toBe('sk-1')
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('refreshes the cache after setSettings', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    const setSettings = vi.fn(async () => settings('sk-2'))
    vi.stubGlobal('window', {
      qwicksGui: {
        getSettings,
        setSettings,
        runtimeRequest: vi.fn(),
        restartRuntime: vi.fn(),
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    await rendererRuntimeClient.getSettings()
    const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '/tmp/next' })
    const cached = await rendererRuntimeClient.getSettings()

    expect(next.agents.qwicks.apiKey).toBe('sk-2')
    expect(cached.agents.qwicks.apiKey).toBe('sk-2')
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledTimes(1)
  })

  it('forwards explicit runtime restarts through the preload bridge', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      qwicksGui: {
        getSettings: vi.fn(),
        setSettings: vi.fn(),
        runtimeRequest: vi.fn(),
        restartRuntime,
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    await expect(rendererRuntimeClient.restartRuntime()).resolves.toBeUndefined()
    expect(restartRuntime).toHaveBeenCalledTimes(1)
  })
})
