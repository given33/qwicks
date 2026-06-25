import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  forceDevUpdateConfig: boolean
  logger: unknown
  setFeedURL: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

let updater: MockUpdater
let nativeUpdater: EventEmitter
let originalEnv: NodeJS.ProcessEnv
let appVersion: string
let mockedFiles: Map<string, string>
let showMessageBox: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

function createUpdater(): MockUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    forceDevUpdateConfig: false,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  })
}

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.QWICKS_ALLOW_INSECURE_UPDATES = '1'
  vi.useFakeTimers()
  vi.resetModules()
  updater = createUpdater()
  nativeUpdater = new EventEmitter()
  appVersion = '0.1.0'
  mockedFiles = new Map()
  showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  openExternal = vi.fn().mockResolvedValue(undefined)
  fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.doMock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    symlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(async (path: string) => {
      const value = mockedFiles.get(String(path))
      if (value === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      return value
    }),
    writeFile: vi.fn(async (path: string, value: string) => {
      mockedFiles.set(String(path), String(value))
    })
  }))
  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      getAppPath: () => '/tmp/deepseek-gui-updater-test-app',
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => appVersion,
      getLocale: () => 'en-US',
      relaunch: vi.fn(),
      exit: vi.fn()
    },
    autoUpdater: nativeUpdater,
    BrowserWindow: class {},
    dialog: { showMessageBox },
    shell: { openExternal }
  }))
  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: updater },
    autoUpdater: updater
  }))
})

afterEach(() => {
  process.env = originalEnv
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
})

describe('checkGuiUpdate feed URL', () => {
  it('uses the Aliyun server update feed for stable updates', async () => {
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'http://8.138.40.16/qwicks/channels/stable/latest/'
    })
  })

  it('uses the Aliyun server frontier update feed for frontier updates', async () => {
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'frontier')

    await expect(module.checkGuiUpdate('frontier')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(updater.allowPrerelease).toBe(true)
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'http://8.138.40.16/qwicks/channels/frontier/latest/'
    })
  })

  it('allows the server update base URL to be replaced by a future domain', async () => {
    process.env.QWICKS_UPDATE_BASE_URL = 'https://update.haoyongai.xyz/qwicks/'
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://update.haoyongai.xyz/qwicks/channels/stable/latest/'
    })
  })

  it('adds installer release notes from the server latest.json to the app update notice', async () => {
    const manifest = {
      kind: 'installer',
      version: '0.2.0',
      releaseDate: '2026-06-06T00:00:00.000Z',
      releaseNotes: 'Update content is shown directly in QWicks.'
    }
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      kind: 'installer',
      latestVersion: '0.2.0',
      hasUpdate: true,
      releaseNotes: 'Update content is shown directly in QWicks.'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('downloads code update packages from public HTTP feeds by default', async () => {
    delete process.env.QWICKS_ALLOW_INSECURE_UPDATES
    delete process.env.QWICKS_ALLOW_INSECURE_CODE_UPDATES
    const packageBody = Buffer.from('qwicks code package')
    const sha256 = createHash('sha256').update(packageBody).digest('hex')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      kind: 'code',
      version: '0.2.0',
      releaseDate: '2026-06-06T00:00:00.000Z',
      releaseNotes: 'Update button now shows release notes on hover.',
      package: {
        name: 'code.zip',
        url: 'code.zip',
        size: packageBody.length,
        sha256
      }
    }), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(packageBody, {
      status: 200,
      headers: { 'content-length': String(packageBody.length) }
    }))

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      kind: 'code',
      latestVersion: '0.2.0',
      hasUpdate: true,
      manualOnly: false,
      releaseNotes: 'Update button now shows release notes on hover.'
    })
    await expect(module.downloadGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      paths: [expect.stringContaining('0.2.0')]
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('blocks automatic installer updates from public HTTP feeds when explicitly disabled', async () => {
    delete process.env.QWICKS_ALLOW_INSECURE_UPDATES
    delete process.env.QWICKS_ALLOW_INSECURE_CODE_UPDATES
    process.env.QWICKS_BLOCK_INSECURE_UPDATES = '1'

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: false,
      code: 'insecure_update',
      message: expect.stringContaining('insecure HTTP')
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('uses code-package update metadata before falling back to the installer feed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      kind: 'code',
      version: '0.2.0',
      releaseDate: '2026-06-06T00:00:00.000Z',
      releaseNotes: 'Update button now shows release notes on hover.',
      package: {
        name: 'code.zip',
        url: 'code.zip',
        size: 12345,
        sha256: 'abc123'
      }
    }), { status: 200 }))

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      kind: 'code',
      latestVersion: '0.2.0',
      hasUpdate: true,
      releaseNotes: 'Update button now shows release notes on hover.',
      packageSize: 12345
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('treats a forceRollback manifest as an update even when the version is lower (撤包)', async () => {
    // Simulate a published rollback: server points code-latest.json at an OLDER
    // version (0.2.5) than the client's current hot version (0.2.10), but sets
    // forceRollback:true so the client installs it anyway (ignoring semver).
    mockedFiles.set(
      String(join('/tmp/deepseek-gui-updater-test-user-data', 'hot-code', 'active.json')),
      JSON.stringify({
        version: '0.2.10',
        root: '/tmp/deepseek-gui-updater-test-user-data/hot-code/versions/0.2.10-abcdef',
        installedAt: '2026-06-20T00:00:00.000Z',
        sha256: 'currentsha'
      })
    )
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      kind: 'code',
      version: '0.2.5',
      forceRollback: true,
      rollbackFromVersion: '0.2.10',
      releaseNotes: '紧急撤包：回退到稳定版本。',
      package: {
        name: 'code.zip',
        url: 'code.zip',
        size: 12345,
        sha256: 'rollbacksha'
      }
    }), { status: 200 }))

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    const result = await module.checkGuiUpdate('stable')
    expect(result).toMatchObject({
      ok: true,
      kind: 'code',
      latestVersion: '0.2.5',
      hasUpdate: true
    })
  })
})

describe('installGuiUpdate', () => {
  it('waits for managed runtime cleanup before asking the updater to quit and install', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    // isSilent=true avoids the NSIS "app still running" dialog deadlock.
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('marks process.qwicksUpdateInstall so before-quit lets the NSIS installer run', async () => {
    // The full-package installer branch must set this flag: app-main's
    // before-quit handler checks it to decide whether to block the quit. If
    // the flag is never set, preventDefault keeps the app alive and the
    // silent NSIS installer never launches — the "downloaded but won't
    // install/restart" symptom. (build/installer.nsh then re-kill-alls in
    // customInit as a backstop for any lingering process holding app.asar.)
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable', () => undefined)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    const flagKey = 'qwicksUpdateInstall'
    delete (process as unknown as Record<string, unknown>)[flagKey]
    await expect(module.installGuiUpdate()).resolves.toEqual({ ok: true })
    expect((process as unknown as { qwicksUpdateInstall?: boolean }).qwicksUpdateInstall).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('reuses the same cleanup when the native updater emits before-quit-for-update', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    nativeUpdater.emit('before-quit-for-update')
    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})

describe('showPostUpdateReleaseNotes', () => {
  const versionStatePath = join(
    '/tmp/deepseek-gui-updater-test-user-data',
    'gui-version-state.json'
  )

  it('records the first launched version without showing a notice', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.1.0'
    })
  })

  it('shows downloaded release notes once after the version changes', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(
      versionStatePath,
      JSON.stringify({
        lastSeenVersion: '0.1.0',
        pendingUpdate: {
          version: '0.2.0',
          releaseNotes: '修复更新流程并改进启动体验。'
        }
      })
    )
    showMessageBox.mockResolvedValue({ response: 0 })
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable', undefined, () => 'zh')

    await module.showPostUpdateReleaseNotes()
    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'QWicks 已更新',
        message: '已更新到 QWicks 0.2.0',
        detail: '修复更新流程并改进启动体验。',
        buttons: ['知道了']
      })
    )
    expect(openExternal).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.2.0'
    })
  })
})
