import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_QWICKS_DATA_DIR,
  getQWicksRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  buildQWicksServeArgs,
  resolveQWicksExecutable
} from '../resolve-qwicks-binary'
import {
  isQWicksChildRunning,
  reclaimQWicksPort,
  resolveAvailableQWicksPort,
  startQWicksChild,
  stopQWicksChildAndWait
} from '../qwicks-process'
import { getQWicksBaseUrl } from '../qwicks-base-url'

const QWICKS_RUNTIME_ID = 'qwicks' as const

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export const qwicksRuntimeAdapter = {
  id: QWICKS_RUNTIME_ID,

  async resolveExecutable(settings: AppSettingsV1): Promise<string> {
    const runtime = getQWicksRuntimeSettings(settings)
    const resolution = resolveQWicksExecutable(appRoot(), runtime.binaryPath)
    if (resolution.kind === 'node-script') {
      const scriptPath = resolution.args[0] ?? ''
      return runtime.binaryPath.trim()
        ? `Node.js script (${scriptPath})`
        : `Bundled QWicks (${scriptPath})`
    }
    return resolution.command
  },

  ensureRunning(settings: AppSettingsV1): Promise<void> {
    return startQWicksChild(settings)
  },

  stopAndWait(): Promise<void> {
    return stopQWicksChildAndWait()
  },

  isChildRunning(): boolean {
    return isQWicksChildRunning()
  },

  getBaseUrl(settings: AppSettingsV1): string {
    const runtime = getQWicksRuntimeSettings(settings)
    return getQWicksBaseUrl(runtime.port)
  },

  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return reclaimQWicksPort(port)
  },

  resolveAvailablePort(port: number): Promise<{ port: number; changed: boolean; message?: string }> {
    return resolveAvailableQWicksPort(port)
  }
}

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return qwicksRuntimeAdapter.getBaseUrl(settings)
}

/** Build the bearer-token authorization header for QWicks requests. */
export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const runtime = getQWicksRuntimeSettings(settings)
  const headers = new Headers()
  if (runtime.runtimeToken.trim()) {
    headers.set('Authorization', `Bearer ${runtime.runtimeToken.trim()}`)
  }
  return headers
}

export type RuntimeRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export async function runtimeRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit,
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
): Promise<{ ok: boolean; status: number; body: string }> {
  const ensuredSettings = await ensureRuntime(settings)
  const requestSettings = ensuredSettings ?? settings
  const base = getRuntimeBaseUrlForSettings(requestSettings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  const url = `${base}${pathNorm}`
  const hdrs = runtimeAuthHeaders(requestSettings)
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: hdrs,
    body: init.body,
    signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

export { buildQWicksServeArgs, resolveQWicksExecutable }

/**
 * Default data directory used when the user has not provided one.
 * The path lives under the app user-data directory so packaged
 * installs do not need write access to the install folder.
 */
export function defaultQWicksDataDir(): string {
  return DEFAULT_QWICKS_DATA_DIR.replace(/^~(?=$|[\\/])/, homedir())
}
