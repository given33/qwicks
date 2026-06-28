import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog } from 'electron'
import type { MessageBoxOptions } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateFailureCode,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from '../shared/gui-update'
import { nextGuiUpdateCheckDelay } from '../shared/gui-update-schedule'
import { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel } from '../shared/gui-update'
import { redactSecretText } from '../shared/secret-redaction'
import {
  codeUpdateDownloadDir,
  codeUpdatePackagePath,
  currentCodeOrShellVersion,
  installCodeUpdatePackage,
  type CodeUpdateManifest,
  type DownloadedCodeUpdatePackage
} from './code-update'

const DEFAULT_GITHUB_OWNER = 'given33'
const DEFAULT_GITHUB_REPO = 'qwicks'
const DEFAULT_UPDATE_BASE_URL = 'http://8.138.40.16/qwicks'
const { autoUpdater } = electronUpdater

function envWithLegacyFallback(qwicksName: string, legacyName: string): string {
  return process.env[qwicksName]?.trim() || process.env[legacyName]?.trim() || ''
}

let initialized = false
let getMainWindow: (() => BrowserWindow | null) | null = null
let lastInfo: Extract<GuiUpdateInfo, { ok: true }> | null = null
let lastState: GuiUpdateState = { status: 'idle' }
let downloaded = false
let downloadPromise: Promise<string[]> | null = null
let pendingCodeUpdate: CodeUpdateManifest | null = null
let downloadedCodePackage: DownloadedCodeUpdatePackage | null = null
let cachedInstallerManifest: ServerInstallerUpdateManifest | null = null
let configuredChannel: GuiUpdateChannel = normalizeGuiUpdateChannel(
  envWithLegacyFallback('QWICKS_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || undefined
)
let configuredFeedUrl = ''
let getSelectedChannel: (() => GuiUpdateChannel | Promise<GuiUpdateChannel>) | null = null
let getSelectedLocale: (() => 'en' | 'zh' | Promise<'en' | 'zh'>) | null = null
let beforeInstallUpdate: (() => void | Promise<void>) | null = null
let beforeInstallUpdatePromise: Promise<void> | null = null
let pendingVersionStateWrite: Promise<void> | null = null
let backgroundCheckTimer: NodeJS.Timeout | null = null
let backgroundCheckPromise: Promise<void> | null = null

const GUI_UPDATE_SCHEDULE_FILE = 'gui-update-schedule.json'
const GUI_VERSION_STATE_FILE = 'gui-version-state.json'
type GuiVersionState = {
  lastSeenVersion?: string
  pendingUpdate?: {
    version: string
    releaseNotes?: string
  }
}

type ServerInstallerUpdateManifest = {
  kind: 'installer'
  version: string
  releaseDate?: string
  releaseNotes?: string
}

function guiUpdateSchedulePath(): string {
  return join(app.getPath('userData'), GUI_UPDATE_SCHEDULE_FILE)
}

function guiVersionStatePath(): string {
  return join(app.getPath('userData'), GUI_VERSION_STATE_FILE)
}

async function readGuiVersionState(): Promise<GuiVersionState> {
  try {
    const raw = await readFile(guiVersionStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as GuiVersionState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeGuiVersionState(state: GuiVersionState): Promise<void> {
  const path = guiVersionStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8')
}

function currentGuiVersion(): string {
  return currentCodeOrShellVersion()
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !('note' in entry)) return ''
      return typeof entry.note === 'string' ? entry.note.trim() : ''
    })
    .filter(Boolean)
  return notes.length > 0 ? notes.join('\n\n') : undefined
}

async function recordPendingUpdateVersion(version: string, releaseNotes?: string): Promise<void> {
  const state = await readGuiVersionState()
  await writeGuiVersionState({
    ...state,
    pendingUpdate: {
      version: version.trim(),
      releaseNotes
    }
  })
}

async function selectedLocale(): Promise<'en' | 'zh'> {
  try {
    return (await getSelectedLocale?.()) === 'zh' ? 'zh' : 'en'
  } catch {
    return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
}

async function readLastScheduledCheckAt(): Promise<number | null> {
  try {
    const raw = await readFile(guiUpdateSchedulePath(), 'utf8')
    const parsed = JSON.parse(raw) as { lastCheckedAt?: unknown }
    const ms = typeof parsed.lastCheckedAt === 'string' ? Date.parse(parsed.lastCheckedAt) : Number.NaN
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

async function writeLastScheduledCheckAt(nowMs: number): Promise<void> {
  const path = guiUpdateSchedulePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({ lastCheckedAt: new Date(nowMs).toISOString() }, null, 2),
    'utf8'
  )
}

function normalizeGithubOwnerRepo(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('github:')) s = s.slice('github:'.length).trim()
  const ssh = s.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)
  if (ssh?.[1]) return ssh[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  const https = s.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:$|[#/])/i)
  if (https?.[1]) return https[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s
  return null
}

function packageJsonPath(): string {
  return join(app.getAppPath(), 'package.json')
}

function readPackageJson(): Record<string, unknown> | null {
  try {
    const path = packageJsonPath()
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveGithubReleaseUrl(): string {
  const envRepo = normalizeGithubOwnerRepo(process.env.QWICKS_GITHUB_REPO?.trim() ?? '')
  if (envRepo) return `https://github.com/${envRepo}/releases`

  const pkg = readPackageJson()
  const repository = pkg?.repository
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? String((repository as { url?: unknown }).url ?? '')
        : ''
  const repo = normalizeGithubOwnerRepo(raw)
  return repo ? `https://github.com/${repo}/releases` : `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases`
}

function downloadPageUrl(): string {
  const direct = envWithLegacyFallback('QWICKS_DOWNLOAD_URL', 'DEEPSEEK_GUI_DOWNLOAD_URL')
  if (direct) return direct

  return updateBaseUrl()
}

function releaseUrlForVersion(version: string): string {
  const page = downloadPageUrl()
  if (/github\.com\/.+\/releases\/?$/i.test(page)) {
    return `${page.replace(/\/+$/, '')}/tag/v${version.replace(/^v/i, '')}`
  }
  return page
}

function macAutoUpdateAllowed(): boolean {
  if (process.platform !== 'darwin') return true
  if (process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES === '1') return true

  const pkg = readPackageJson()
  const hints = pkg?.buildHints
  if (!hints || typeof hints !== 'object') return false
  const values = hints as { macSigningEnabled?: unknown; notarizationEnabled?: unknown }
  return values.macSigningEnabled === true && values.notarizationEnabled === true
}

function unsupportedMessage(): string {
  if (process.platform === 'darwin') {
    return 'Automatic updates require a signed and notarized macOS build. Review the update notes in the app, then install a full release build when available.'
  }
  return 'Automatic updates are not supported for this build. Review the update notes in the app, then install a full release build when available.'
}

function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/\b(\d{3})\b/)
  if (!match) return null
  const status = Number.parseInt(match[1], 10)
  return Number.isFinite(status) ? status : null
}

function sanitizeUpdaterError(raw: string, channel: GuiUpdateChannel): string {
  const message = raw.trim()
  if (!message) {
    return `Could not read GUI update metadata for the ${channel} channel. Please try again later.`
  }

  if (/Invalid release object path\./i.test(message)) {
    return `The ${channel} update feed is not published correctly yet. Please try again later.`
  }

  if (/Object not found\./i.test(message)) {
    return `The ${channel} update feed is missing release metadata right now. Please try again later.`
  }

  const status = extractHttpStatus(message)
  if (status === 400 || status === 404) {
    return `The ${channel} update feed is not available right now. Please try again later.`
  }
  if (status === 403) {
    return `The ${channel} update feed denied this request. Please try again later.`
  }
  if (status === 429) {
    return `The ${channel} update feed is rate limited right now. Please try again later.`
  }
  if (status && status >= 500) {
    return `The ${channel} update feed is temporarily unavailable. Please try again later.`
  }

  return message.split(/\n(?:Headers:|Data:)/, 1)[0].trim() || message
}

function sanitizeConsoleValue(value: unknown): string {
  try {
    return redactSecretText(typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    return redactSecretText(String(value))
  }
}

function toGuiInfo(updateInfo: UpdateInfo, hasUpdate: boolean, manualOnly = false): Extract<GuiUpdateInfo, { ok: true }> {
  const latestVersion = updateInfo.version.trim()
  const currentVersion = currentGuiVersion()
  const effectiveHasUpdate = hasUpdate && isNewerVersion(latestVersion, currentVersion)
  return {
    ok: true,
    currentVersion,
    latestVersion,
    hasUpdate: effectiveHasUpdate,
    releaseUrl: releaseUrlForVersion(latestVersion),
    releaseDate: updateInfo.releaseDate,
    channel: configuredChannel,
    kind: 'installer',
    releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
    manualOnly,
    downloaded
  }
}

function withInstallerManifestReleaseNotes(
  info: Extract<GuiUpdateInfo, { ok: true }>,
  manifest: ServerInstallerUpdateManifest | null
): Extract<GuiUpdateInfo, { ok: true }> {
  if (!manifest || manifest.version !== info.latestVersion) return info
  return {
    ...info,
    releaseDate: info.releaseDate || manifest.releaseDate,
    releaseNotes: info.releaseNotes || manifest.releaseNotes
  }
}

function toCodeGuiInfo(
  manifest: CodeUpdateManifest,
  hasUpdate: boolean,
  manualOnly = false
): Extract<GuiUpdateInfo, { ok: true }> {
  const packageDownloaded = Boolean(
    downloadedCodePackage && downloadedCodePackage.manifest.version === manifest.version
  )
  return {
    ok: true,
    currentVersion: currentGuiVersion(),
    latestVersion: manifest.version,
    hasUpdate,
    releaseUrl: releaseUrlForVersion(manifest.version),
    releaseDate: manifest.releaseDate,
    channel: configuredChannel,
    kind: 'code',
    releaseNotes: manifest.releaseNotes,
    packageSize: manifest.package.size,
    manualOnly,
    downloaded: packageDownloaded
  }
}

function emitGuiUpdateState(state: GuiUpdateState): void {
  lastState = state
  const win = getMainWindow?.()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('gui:update-state', state)
}

function runBeforeInstallUpdate(): Promise<void> {
  if (!beforeInstallUpdate) return Promise.resolve()
  if (!beforeInstallUpdatePromise) {
    beforeInstallUpdatePromise = Promise.resolve()
      .then(() => beforeInstallUpdate?.())
      .then(() => undefined)
      .finally(() => {
        beforeInstallUpdatePromise = null
      })
  }
  return beforeInstallUpdatePromise
}

function clearBackgroundCheckTimer(): void {
  if (backgroundCheckTimer) {
    clearTimeout(backgroundCheckTimer)
    backgroundCheckTimer = null
  }
}

function shouldSkipScheduledCheck(): boolean {
  return (
    lastState.status === 'checking' ||
    lastState.status === 'downloading' ||
    lastState.status === 'downloaded' ||
    lastState.status === 'installing'
  )
}

async function scheduleNextBackgroundCheck(): Promise<void> {
  clearBackgroundCheckTimer()
  const lastCheckedAtMs = await readLastScheduledCheckAt()
  const delay = nextGuiUpdateCheckDelay(lastCheckedAtMs)
  backgroundCheckTimer = setTimeout(() => {
    void runScheduledGuiUpdateCheck()
  }, delay)
}

async function runScheduledGuiUpdateCheck(): Promise<void> {
  if (backgroundCheckPromise) return backgroundCheckPromise
  backgroundCheckPromise = (async () => {
    try {
      if (shouldSkipScheduledCheck()) return
      const nowMs = Date.now()
      await writeLastScheduledCheckAt(nowMs)
      await checkGuiUpdate()
    } catch (error) {
      console.warn('[qwicks-gui updater] scheduled GUI update check failed:', error)
    } finally {
      backgroundCheckPromise = null
      void scheduleNextBackgroundCheck()
    }
  })()
  return backgroundCheckPromise
}

async function resolveUpdateChannel(requested?: GuiUpdateChannel): Promise<GuiUpdateChannel> {
  if (requested) return normalizeGuiUpdateChannel(requested)
  if (getSelectedChannel) {
    return normalizeGuiUpdateChannel(await getSelectedChannel())
  }
  return DEFAULT_GUI_UPDATE_CHANNEL
}

function normalizeUrlBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function ensureTrailingSlash(raw: string): string {
  const normalized = normalizeUrlBase(raw)
  return normalized ? `${normalized}/` : ''
}

function updateBaseUrl(): string {
  return normalizeUrlBase(
    process.env.QWICKS_UPDATE_BASE_URL?.trim() ||
      process.env.PUBLIC_DOWNLOAD_BASE_URL?.trim() ||
      DEFAULT_UPDATE_BASE_URL
  )
}

function updateFeedUrl(channel: GuiUpdateChannel): string {
  const normalized = normalizeGuiUpdateChannel(channel)
  const direct =
    process.env[`QWICKS_UPDATE_URL_${normalized.toUpperCase()}`]?.trim() ||
    envWithLegacyFallback('QWICKS_UPDATE_URL', 'DEEPSEEK_GUI_UPDATE_URL')
  if (direct) return ensureTrailingSlash(direct.replace(/\{channel\}/g, normalized))
  return `${updateBaseUrl()}/channels/${normalized}/latest/`
}

// Code (hot) updates live in their own code/ sub-path with a distinct
// code-latest.json manifest so they never collide with the installer's
// latest.json at channels/{ch}/latest/latest.json.
//
// URL layout:
//   channels/{channel}/latest/          → installer feed (latest.yml + latest.json + .exe)
//   channels/{channel}/latest/code/     → code-update feed (code-latest.json + code.zip)
//
// The CI workflows deploy to these two directories independently.
function codeUpdateFeedUrl(channel: GuiUpdateChannel): string {
  return `${updateFeedUrl(channel)}code/`
}

function insecureUpdatesAllowed(): boolean {
  if (
    process.env.QWICKS_BLOCK_INSECURE_UPDATES === '1' ||
    process.env.QWICKS_ALLOW_INSECURE_UPDATES === '0' ||
    process.env.QWICKS_ALLOW_INSECURE_CODE_UPDATES === '0'
  ) {
    return false
  }
  return true
}

function isLoopbackUpdateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isTrustedUpdateUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'https:') return true
    if (url.protocol === 'http:' && isLoopbackUpdateHost(url.hostname)) return true
    return false
  } catch {
    return false
  }
}

function insecureUpdateMessage(rawUrl: string): string {
  return `Automatic updates are blocked because the update feed uses insecure HTTP (${rawUrl}). Use HTTPS or a signed update feed before enabling automatic updates.`
}

function insecureUpdateInfo(channel: GuiUpdateChannel, rawUrl: string): Extract<GuiUpdateInfo, { ok: false }> {
  return {
    ok: false,
    currentVersion: currentGuiVersion(),
    code: 'insecure_update',
    message: insecureUpdateMessage(rawUrl),
    releaseUrl: downloadPageUrl(),
    channel
  }
}

function semverParts(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10)
  ]
}

function compareSemver(a: string, b: string): number | null {
  const left = semverParts(a)
  const right = semverParts(b)
  if (!left || !right) return null
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

function isNewerVersion(latest: string, current: string): boolean {
  const compared = compareSemver(latest, current)
  return compared === null ? latest.trim() !== current.trim() : compared > 0
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumberValue(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function resolveManifestPackageUrl(channel: GuiUpdateChannel, rawUrl: string, name: string): string {
  const value = rawUrl || name
  if (!value) return ''
  try {
    return new URL(value, updateFeedUrl(channel)).toString()
  } catch {
    return ''
  }
}

function normalizeCodeUpdateManifest(raw: unknown, channel: GuiUpdateChannel): CodeUpdateManifest | null {
  const data = recordValue(raw)
  if (data.kind !== 'code') return null
  const version = stringValue(data.version)
  const packageData = recordValue(data.package)
  const name = stringValue(packageData.name) || 'code.zip'
  const url = resolveManifestPackageUrl(channel, stringValue(packageData.url), name)
  if (!version || !url) return null
  const normalizedChannel = normalizeGuiUpdateChannel(stringValue(data.channel) || channel)
  const sha256 = stringValue(packageData.sha256).toLowerCase()
  return {
    kind: 'code',
    product: stringValue(data.product) || 'QWicks',
    platform: stringValue(data.platform) || process.platform,
    channel: normalizedChannel,
    version,
    releaseDate: stringValue(data.releaseDate) || stringValue(data.generatedAt) || undefined,
    releaseNotes: normalizeReleaseNotes(
      data.releaseNotes ?? data.release_notes ?? data.notes ?? data.changelog
    ),
    minShellVersion: stringValue(data.minShellVersion) || undefined,
    fullUpdateRequired: data.fullUpdateRequired === true,
    forceRollback: data.forceRollback === true,
    rollbackFromVersion: stringValue(data.rollbackFromVersion) || undefined,
    package: {
      name,
      url,
      ...(sha256 ? { sha256 } : {}),
      ...(positiveNumberValue(packageData.size) ? { size: positiveNumberValue(packageData.size) } : {})
    }
  }
}

function normalizeInstallerUpdateManifest(raw: unknown): ServerInstallerUpdateManifest | null {
  const data = recordValue(raw)
  if (data.kind !== 'installer') return null
  const version = stringValue(data.version)
  if (!version) return null
  return {
    kind: 'installer',
    version,
    releaseDate: stringValue(data.releaseDate) || stringValue(data.generatedAt) || undefined,
    releaseNotes: normalizeReleaseNotes(
      data.releaseNotes ?? data.release_notes ?? data.notes ?? data.changelog
    )
  }
}

function codeUpdateCompatibleWithShell(manifest: CodeUpdateManifest): boolean {
  if (manifest.fullUpdateRequired) return false
  if (!manifest.minShellVersion) return true
  const compared = compareSemver(app.getVersion(), manifest.minShellVersion)
  return compared === null ? app.getVersion() === manifest.minShellVersion : compared >= 0
}

async function fetchServerLatestJson(channel: GuiUpdateChannel): Promise<unknown | null> {
  const url = `${updateFeedUrl(channel)}latest.json`
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000)
  })
  if (response.status === 404) return null
  if (!response.ok) return null
  return JSON.parse(await response.text()) as unknown
}

// Reads the code-update manifest from its dedicated code-latest.json path.
// Prefer this over fetchServerLatestJson for code updates to avoid the
// installer/code manifest collision.
async function fetchCodeUpdateLatestJson(channel: GuiUpdateChannel): Promise<unknown | null> {
  const url = `${codeUpdateFeedUrl(channel)}code-latest.json`
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000)
  })
  if (response.status === 404) return null
  if (!response.ok) return null
  return JSON.parse(await response.text()) as unknown
}

async function fetchInstallerUpdateManifest(
  channel: GuiUpdateChannel
): Promise<ServerInstallerUpdateManifest | null> {
  try {
    return normalizeInstallerUpdateManifest(await fetchServerLatestJson(channel))
  } catch (error) {
    console.warn('[qwicks-gui updater] failed to read installer update manifest:', error)
    return null
  }
}

async function checkCodePackageUpdate(
  channel: GuiUpdateChannel,
  manualOnly = false
): Promise<Extract<GuiUpdateInfo, { ok: true }> | null> {
  let raw: unknown | null = null
  try {
    raw = await fetchCodeUpdateLatestJson(channel)
  } catch (error) {
    console.warn('[qwicks-gui updater] failed to read code update manifest:', error)
    return null
  }
  const manifest = normalizeCodeUpdateManifest(raw, channel)
  if (!manifest) return null
  if (!codeUpdateCompatibleWithShell(manifest)) {
    pendingCodeUpdate = null
    return null
  }

  // 撤包支持：forceRollback 让发布者强制客户端安装服务器指定版本，即便版本号
  // 更低（isNewerVersion 会判定为"非更新"而忽略）。发布者在 code-latest.json 设
  // forceRollback:true + 指向旧版 code.zip，客户端即自动回退，用户无感。
  const hasUpdate =
    manifest.forceRollback === true || isNewerVersion(manifest.version, currentGuiVersion())
  pendingCodeUpdate = hasUpdate ? manifest : null
  downloaded = Boolean(hasUpdate && downloadedCodePackage?.manifest.version === manifest.version)
  return toCodeGuiInfo(manifest, hasUpdate, manualOnly)
}

function genericProviderOptions(channel: GuiUpdateChannel) {
  return {
    provider: 'generic' as const,
    url: updateFeedUrl(channel)
  }
}

function configureUpdaterChannel(channel: GuiUpdateChannel): void {
  const normalized = normalizeGuiUpdateChannel(channel)
  const providerOptions = genericProviderOptions(normalized)
  const feedKey = providerOptions.url
  const changed = normalized !== configuredChannel || feedKey !== configuredFeedUrl
  configuredChannel = normalized
  configuredFeedUrl = feedKey
  autoUpdater.allowPrerelease = normalized === 'frontier'
  autoUpdater.setFeedURL(providerOptions)
  if (!changed) return
  downloaded = false
  downloadPromise = null
  pendingCodeUpdate = null
  downloadedCodePackage = null
  cachedInstallerManifest = null
  lastInfo = null
  emitGuiUpdateState({ status: 'idle' })
}

async function configureReachableUpdaterChannel(channel: GuiUpdateChannel): Promise<void> {
  configureUpdaterChannel(channel)
}

export function setGuiUpdateChannel(channel: GuiUpdateChannel): void {
  configureUpdaterChannel(channel)
}

async function checkManualUpdate(
  channel: GuiUpdateChannel,
  code: GuiUpdateFailureCode = 'unsupported'
): Promise<GuiUpdateInfo> {
  const currentVersion = currentGuiVersion()
  return {
    ok: false,
    currentVersion,
    code,
    message: unsupportedMessage(),
    releaseUrl: downloadPageUrl(),
    channel
  }
}

export function initializeGuiUpdater(
  windowGetter: () => BrowserWindow | null,
  channelGetter?: () => GuiUpdateChannel | Promise<GuiUpdateChannel>,
  beforeInstall?: () => void | Promise<void>,
  localeGetter?: () => 'en' | 'zh' | Promise<'en' | 'zh'>
): void {
  getMainWindow = windowGetter
  getSelectedChannel = channelGetter ?? null
  beforeInstallUpdate = beforeInstall ?? null
  getSelectedLocale = localeGetter ?? null
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  configureUpdaterChannel(configuredChannel)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.logger = {
    info: (message?: unknown) => console.info('[qwicks-gui updater]', sanitizeConsoleValue(message)),
    warn: (message?: unknown) => console.warn('[qwicks-gui updater]', sanitizeConsoleValue(message)),
    error: (message?: unknown) => console.error('[qwicks-gui updater]', sanitizeConsoleValue(message))
  }

  autoUpdater.on('checking-for-update', () => {
    emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  })

  autoUpdater.on('update-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    const info = withInstallerManifestReleaseNotes(toGuiInfo(updateInfo, true), cachedInstallerManifest)
    lastInfo = info
    emitGuiUpdateState({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    const info = withInstallerManifestReleaseNotes(toGuiInfo(updateInfo, false), cachedInstallerManifest)
    lastInfo = info
    emitGuiUpdateState({ status: 'not_available', info })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    emitGuiUpdateState({ status: 'downloading', info: lastInfo ?? undefined, progress })
  })

  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    downloaded = true
    const info = withInstallerManifestReleaseNotes(toGuiInfo(event, true), cachedInstallerManifest)
    lastInfo = info
    pendingVersionStateWrite = recordPendingUpdateVersion(info.latestVersion, info.releaseNotes)
      .catch((error) => {
        console.warn('[qwicks-gui updater] failed to save release notes:', error)
      })
      .finally(() => {
        pendingVersionStateWrite = null
      })
    emitGuiUpdateState({ status: 'downloaded', info })
  })

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'unknown' })
  })

  nativeAutoUpdater?.on?.('before-quit-for-update', () => {
    void runBeforeInstallUpdate().catch((error) => {
      console.warn('[qwicks-gui updater] failed to stop runtimes before update quit:', error)
    })
  })

  void scheduleNextBackgroundCheck()
}

export async function showPostUpdateReleaseNotes(): Promise<void> {
  const currentVersion = currentGuiVersion().trim()
  const state = await readGuiVersionState()
  if (!state.lastSeenVersion) {
    await writeGuiVersionState({ ...state, lastSeenVersion: currentVersion })
    return
  }
  if (state.lastSeenVersion === currentVersion) return

  const pendingUpdate =
    state.pendingUpdate?.version === currentVersion ? state.pendingUpdate : undefined
  await writeGuiVersionState({ lastSeenVersion: currentVersion })

  const locale = await selectedLocale()
  const isZh = locale === 'zh'
  const options: MessageBoxOptions = {
    type: 'info',
    title: isZh ? 'QWicks 已更新' : 'QWicks updated',
    message: isZh ? `已更新到 QWicks ${currentVersion}` : `QWicks has been updated to ${currentVersion}`,
    detail:
      pendingUpdate?.releaseNotes ??
      (isZh
        ? '本次更新未提供详细说明。'
        : 'This update did not include detailed release notes.'),
    buttons: isZh ? ['知道了'] : ['OK'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const window = getMainWindow?.()
  if (window && !window.isDestroyed()) {
    await dialog.showMessageBox(window, options)
  } else {
    await dialog.showMessageBox(options)
  }
}

export function getGuiUpdateState(): GuiUpdateState {
  return lastState
}

export async function checkGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateInfo> {
  const selectedChannel = await resolveUpdateChannel(channel)
  await configureReachableUpdaterChannel(selectedChannel)
  const feedUrl = updateFeedUrl(selectedChannel)
  const untrustedFeed = !insecureUpdatesAllowed() && !isTrustedUpdateUrl(feedUrl)

  emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  const codeInfo = await checkCodePackageUpdate(selectedChannel, untrustedFeed)
  if (codeInfo?.hasUpdate) {
    lastInfo = codeInfo
    emitGuiUpdateState({ status: 'available', info: codeInfo })
    return codeInfo
  }

  if (untrustedFeed) {
    const info = insecureUpdateInfo(selectedChannel, feedUrl)
    emitGuiUpdateState({
      status: 'error',
      info,
      message: info.message,
      code: 'insecure_update'
    })
    return info
  }

  if (!macAutoUpdateAllowed()) {
    return checkManualUpdate(selectedChannel, 'unsupported')
  }

  try {
    cachedInstallerManifest = await fetchInstallerUpdateManifest(selectedChannel)
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      if (codeInfo) {
        lastInfo = codeInfo
        emitGuiUpdateState({ status: 'not_available', info: codeInfo })
        return codeInfo
      }
      return checkManualUpdate(selectedChannel, 'not_configured')
    }
    const info = withInstallerManifestReleaseNotes(
      toGuiInfo(result.updateInfo, result.isUpdateAvailable),
      cachedInstallerManifest
    )
    lastInfo = info
    emitGuiUpdateState(info.hasUpdate ? { status: 'available', info } : { status: 'not_available', info })
    return info
  } catch (e) {
    if (codeInfo) {
      lastInfo = codeInfo
      emitGuiUpdateState({ status: 'not_available', info: codeInfo })
      return codeInfo
    }
    const message = sanitizeUpdaterError(e instanceof Error ? e.message : String(e), selectedChannel)
    const info: GuiUpdateInfo = {
      ok: false,
      currentVersion: currentGuiVersion(),
      message,
      code: 'unknown',
      releaseUrl: downloadPageUrl(),
      channel: selectedChannel
    }
    emitGuiUpdateState({ status: 'error', info, message, code: 'unknown' })
    return info
  }
}

function codeDownloadProgress(
  total: number,
  transferred: number,
  delta: number,
  startedAt: number
) {
  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000)
  return {
    total,
    delta,
    transferred,
    percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
    bytesPerSecond: transferred / elapsedSeconds
  }
}

async function responseBufferWithProgress(
  response: Response,
  info: Extract<GuiUpdateInfo, { ok: true }>,
  expectedSize?: number
): Promise<Buffer> {
  const headerSize = Number(response.headers.get('content-length') ?? '')
  const total = Number.isFinite(headerSize) && headerSize > 0 ? headerSize : expectedSize ?? 0
  const startedAt = Date.now()
  emitGuiUpdateState({
    status: 'downloading',
    info,
    progress: codeDownloadProgress(total, 0, 0, startedAt)
  })

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    emitGuiUpdateState({
      status: 'downloading',
      info,
      progress: codeDownloadProgress(buffer.length, buffer.length, buffer.length, startedAt)
    })
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let transferred = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    const chunk = Buffer.from(result.value)
    chunks.push(chunk)
    transferred += chunk.length
    emitGuiUpdateState({
      status: 'downloading',
      info,
      progress: codeDownloadProgress(total, transferred, chunk.length, startedAt)
    })
  }
  return Buffer.concat(chunks)
}

async function downloadCodeUpdate(
  manifest: CodeUpdateManifest,
  info: Extract<GuiUpdateInfo, { ok: true }>
): Promise<string[]> {
  if (!insecureUpdatesAllowed() && !isTrustedUpdateUrl(manifest.package.url)) {
    throw new Error(insecureUpdateMessage(manifest.package.url))
  }

  const response = await fetch(manifest.package.url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000)
  })
  if (!response.ok) {
    throw new Error(`Code update download failed with HTTP ${response.status}`)
  }

  const buffer = await responseBufferWithProgress(response, info, manifest.package.size)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const expectedSha256 = manifest.package.sha256?.trim().toLowerCase()
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error('The downloaded code update did not match the expected checksum.')
  }

  const path = codeUpdatePackagePath(manifest.version, sha256)
  await mkdir(codeUpdateDownloadDir(), { recursive: true })
  await writeFile(path, buffer)
  downloadedCodePackage = { zipPath: path, sha256, manifest }
  downloaded = true
  const downloadedInfo: Extract<GuiUpdateInfo, { ok: true }> = {
    ...info,
    downloaded: true
  }
  lastInfo = downloadedInfo
  pendingVersionStateWrite = recordPendingUpdateVersion(manifest.version, manifest.releaseNotes)
    .catch((error) => {
      console.warn('[qwicks-gui updater] failed to save code update release notes:', error)
    })
    .finally(() => {
      pendingVersionStateWrite = null
    })
  emitGuiUpdateState({ status: 'downloaded', info: downloadedInfo })
  return [path]
}

export async function downloadGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateDownloadResult> {
  const selectedChannel = await resolveUpdateChannel(channel)
  await configureReachableUpdaterChannel(selectedChannel)
  const feedUrl = updateFeedUrl(selectedChannel)

  if (!insecureUpdatesAllowed() && !isTrustedUpdateUrl(feedUrl)) {
    const message = insecureUpdateMessage(feedUrl)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'insecure_update' })
    return {
      ok: false,
      currentVersion: currentGuiVersion(),
      code: 'insecure_update',
      message
    }
  }

  if (!macAutoUpdateAllowed()) {
    return {
      ok: false,
      currentVersion: currentGuiVersion(),
      code: 'unsupported',
      message: unsupportedMessage()
    }
  }

  try {
    if (!lastInfo?.hasUpdate || lastInfo.channel !== selectedChannel) {
      const checked = await checkGuiUpdate(selectedChannel)
      if (!checked.ok) return checked
      if (!checked.hasUpdate || checked.manualOnly) {
        return {
          ok: false,
          currentVersion: currentGuiVersion(),
          code: checked.manualOnly ? 'unsupported' : 'unknown',
          message: checked.manualOnly
            ? unsupportedMessage()
            : 'No downloadable GUI update is available.'
        }
      }
    }

    if (lastInfo?.kind === 'code') {
      const manifest =
        pendingCodeUpdate && pendingCodeUpdate.version === lastInfo.latestVersion
          ? pendingCodeUpdate
          : null
      if (!manifest) {
        return {
          ok: false,
          currentVersion: currentGuiVersion(),
          code: 'download_failed',
          message: 'The code update metadata is no longer available. Check for updates again.'
        }
      }
      if (downloadedCodePackage?.manifest.version === manifest.version) {
        return { ok: true, paths: [downloadedCodePackage.zipPath] }
      }
      return { ok: true, paths: await downloadCodeUpdate(manifest, lastInfo) }
    }

    if (!downloadPromise) {
      downloadPromise = autoUpdater.downloadUpdate().finally(() => {
        downloadPromise = null
      })
    }
    const paths = await downloadPromise
    return { ok: true, paths }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'download_failed' })
    return {
      ok: false,
      currentVersion: currentGuiVersion(),
      code: 'download_failed',
      message
    }
  }
}

export async function installGuiUpdate(): Promise<GuiUpdateInstallResult> {
  try {
    if (lastInfo?.kind === 'code') {
      if (!downloadedCodePackage || downloadedCodePackage.manifest.version !== lastInfo.latestVersion) {
        return {
          ok: false,
          currentVersion: currentGuiVersion(),
          code: 'install_failed',
          message: 'The code update has not finished downloading yet.'
        }
      }
      emitGuiUpdateState({ status: 'installing', info: lastInfo ?? undefined })
      await Promise.all([pendingVersionStateWrite, runBeforeInstallUpdate()])
      // 标记"为更新退出"（index.ts 的 before-quit 据此放行，runtime 已停止）。
      ;(process as unknown as { qwicksUpdateInstall?: boolean }).qwicksUpdateInstall = true
      await installCodeUpdatePackage(downloadedCodePackage)
      app.relaunch()
      app.exit(0)
      return { ok: true }
    }

    if (!downloaded) {
      return {
        ok: false,
        currentVersion: currentGuiVersion(),
        code: 'install_failed',
        message: 'The update has not finished downloading yet.'
      }
    }
    emitGuiUpdateState({ status: 'installing', info: lastInfo ?? undefined })
    await Promise.all([pendingVersionStateWrite, runBeforeInstallUpdate()])
    // 标记"为更新退出"（index.ts 的 before-quit 据此放行，runtime 已停止），
    // 否则 before-quit 的 preventDefault 会阻止 app 真正退出，
    // electron-updater 的 will-quit 安装钩子不触发 → 安装器不启动。
    ;(process as unknown as { qwicksUpdateInstall?: boolean }).qwicksUpdateInstall = true
    // Bug fix:用静默模式安装(isSilent=true)避免 NSIS UI 弹出"软件已打开"对话框。
    // 非静默模式下 NSIS 会检测 app 进程,如果 runtime 关闭有竞态(file lock),
    // 就会卡在"请关闭软件"对话框 → 用户关闭软件 → 安装也停止 → 死锁。
    // 静默模式下 NSIS 直接安装+重启,体验类似 codex(一键更新→自动重启)。
    // isForceRunAfter=true 确保安装后自动启动新版本。
    autoUpdater.quitAndInstall(true, true)
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'install_failed' })
    return {
      ok: false,
      currentVersion: currentGuiVersion(),
      code: 'install_failed',
      message
    }
  }
}
