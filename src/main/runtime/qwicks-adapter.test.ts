import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultQWicksRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { runtimeRequestViaHost } from './qwicks-adapter'

let server: Server | null = null

function settingsForPort(port: number): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      qwicks: {
        ...defaultQWicksRuntimeSettings(port),
        runtimeToken: 'usage-token'
      }
    },
    workspaceRoot: '/tmp',
    log: { enabled: true, retentionDays: 7 },
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

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

function listen(handler: RequestHandler): Promise<number> {
  server = createServer(handler)
  return new Promise((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address() as AddressInfo
      resolve(address.port)
    })
  })
}

afterEach(async () => {
  const current = server
  server = null
  if (!current) return
  await new Promise<void>((resolve, reject) => {
    current.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

describe('runtimeRequestViaHost', () => {
  it('forwards daily usage requests to the QWicks runtime with bearer auth', async () => {
    let seenUrl = ''
    let seenAuthorization = ''
    let ensured = false
    const port = await listen((req, res) => {
      seenUrl = req.url ?? ''
      seenAuthorization = req.headers.authorization ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        group_by: 'day',
        buckets: [],
        totals: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          turns: 0,
          cache_hit_tokens: 0,
          cache_miss_tokens: 0,
          cached_tokens: 0,
          cost_usd: 0,
          active_days: 0
        },
        date_range: { from: '2026-06-01', to: '2026-06-02', days: 2 },
        timezone: 'Asia/Shanghai'
      }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(port),
      '/v1/usage?group_by=day&from=2026-06-01&to=2026-06-02&timezone=Asia%2FShanghai',
      { method: 'GET' },
      async () => {
        ensured = true
      }
    )

    expect(ensured).toBe(true)
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({ group_by: 'day' }))
    expect(seenUrl).toBe('/v1/usage?group_by=day&from=2026-06-01&to=2026-06-02&timezone=Asia%2FShanghai')
    expect(seenAuthorization).toBe('Bearer usage-token')
  })

  it('uses settings returned by ensureRuntime when the managed port changes', async () => {
    let seenUrl = ''
    const port = await listen((req, res) => {
      seenUrl = req.url ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(1),
      '/v1/threads?limit=1',
      { method: 'GET' },
      async () => settingsForPort(port)
    )

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(seenUrl).toBe('/v1/threads?limit=1')
  })

  it('retries once when a managed runtime restart interrupts startup', async () => {
    let ensureCalls = 0
    const port = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(1),
      '/health',
      { method: 'GET' },
      async () => {
        ensureCalls += 1
        if (ensureCalls === 1) {
          throw new Error('QWicks exited during startup with signal SIGTERM')
        }
        return settingsForPort(port)
      }
    )

    expect(ensureCalls).toBe(2)
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
  })
})
