import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

// These tests guard the hot-update (code update) install path against the
// regression that broke "restart to update". The CI-packed code.zip only ever
// contains renderer/, preload/, and qwicks/ — the main process is intentionally
// NOT part of a hot update (it cannot be swapped without a full installer). The
// installer must therefore accept a package that has renderer+preload but no
// main/, otherwise installCodeUpdatePackage always throws and clicking the
// restart button appears to do nothing.

let userData: string
let unpackedRoot: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'qwicks-code-update-'))
  unpackedRoot = mkdtempSync(join(tmpdir(), 'qwicks-code-update-app-'))
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      // getAppPath is used to resolve the bundled app.asar.unpacked qwicks
      // node_modules; point it at a throwaway dir so the symlink step no-ops.
      getAppPath: () => unpackedRoot,
      getPath: () => userData
    }
  }))
})

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
  rmSync(userData, { recursive: true, force: true })
  rmSync(unpackedRoot, { recursive: true, force: true })
})

/** Build a code.zip mirroring what release-code-update.yml packages. */
async function buildCodeZip(opts: {
  includeMain?: boolean
  includeQwicks?: boolean
  includeRenderer?: boolean
  includePreload?: boolean
} = {}): Promise<{ zipPath: string }> {
  const opts2 = {
    includeMain: false,
    includeQwicks: true,
    includeRenderer: true,
    includePreload: true,
    ...opts
  }
  const zip = new JSZip()
  if (opts2.includeRenderer) {
    zip.file('renderer/index.html', '<!doctype html><html><body>renderer</body></html>')
  }
  if (opts2.includePreload) {
    zip.file('preload/index.cjs', "require('electron')")
  }
  if (opts2.includeMain) {
    zip.file('main/app-main.js', "console.log('main')")
  }
  if (opts2.includeQwicks) {
    zip.file('qwicks/package.json', JSON.stringify({ name: 'qwicks' }))
    zip.file('qwicks/dist/cli/serve-entry.js', "console.log('serve')")
  }
  const zipPath = join(userData, 'code.zip')
  writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))
  return { zipPath }
}

function manifest(version: string): import('./code-update').CodeUpdateManifest {
  return {
    kind: 'code',
    version,
    package: { name: 'code.zip', url: 'code.zip', sha256: 'deadbeef' }
  }
}

describe('installCodeUpdatePackage (hot-update install path)', () => {
  it('installs a renderer+preload code package WITHOUT main/ (the CI-packed shape)', async () => {
    // The real code.zip from release-code-update.yml contains renderer/,
    // preload/, and qwicks/ — but NEVER main/. A valid hot update must install.
    const { zipPath } = await buildCodeZip()
    const mod = await import('./code-update')

    const active = await mod.installCodeUpdatePackage({
      zipPath,
      sha256: 'deadbeef',
      manifest: manifest('0.2.99')
    })

    expect(active.version).toBe('0.2.99')
    // active.json must be written pointing at the extracted version root.
    const activeJson = JSON.parse(
      readFileSync(join(userData, 'hot-code', 'active.json'), 'utf8')
    ) as Record<string, unknown>
    expect(activeJson.version).toBe('0.2.99')
    expect(existsSync(join(String(activeJson.root), 'renderer', 'index.html'))).toBe(true)
    expect(existsSync(join(String(activeJson.root), 'preload', 'index.cjs'))).toBe(true)
  })

  it('rejects a package missing renderer/index.html (genuinely broken zip)', async () => {
    const { zipPath } = await buildCodeZip({ includeRenderer: false })
    const mod = await import('./code-update')

    await expect(
      mod.installCodeUpdatePackage({ zipPath, sha256: 'deadbeef', manifest: manifest('0.2.99') })
    ).rejects.toThrow(/missing renderer\/index.html/)
  })

  it('rejects a package missing preload/ (genuinely broken zip)', async () => {
    const { zipPath } = await buildCodeZip({ includePreload: false })
    const mod = await import('./code-update')

    await expect(
      mod.installCodeUpdatePackage({ zipPath, sha256: 'deadbeef', manifest: manifest('0.2.99') })
    ).rejects.toThrow(/preload\/index\.(cjs|mjs)/)
  })

  it('installs a package that also happens to ship main/ (forward-compatible)', async () => {
    // If a future build ever ships main/ in the code package, it must still
    // install — the validator must not flip to *requiring* main/ absence.
    const { zipPath } = await buildCodeZip({ includeMain: true })
    const mod = await import('./code-update')

    await expect(
      mod.installCodeUpdatePackage({ zipPath, sha256: 'deadbeef', manifest: manifest('0.2.100') })
    ).resolves.toBeDefined()
  })

  it('after install, resolveHotCodePreloadPath/RendererIndexPath resolve into the new root', async () => {
    const { zipPath } = await buildCodeZip()
    const mod = await import('./code-update')
    await mod.installCodeUpdatePackage({
      zipPath,
      sha256: 'deadbeef',
      manifest: manifest('0.2.101')
    })

    const preloadPath = mod.resolveHotCodePreloadPath()
    const rendererPath = mod.resolveHotCodeRendererIndexPath()
    expect(preloadPath).toBeTruthy()
    expect(rendererPath).toBeTruthy()
    expect(existsSync(preloadPath!)).toBe(true)
    expect(existsSync(rendererPath!)).toBe(true)
  })

  it('links bundled qwicks/node_modules when the package ships qwicks/', async () => {
    // installCodeUpdatePackage links the bundled qwicks/node_modules into the
    // new root when qwicks/ is present. Seed the app.asar.unpacked tree.
    const bundledModules = join(unpackedRoot, 'qwicks', 'node_modules')
    mkdirSync(join(bundledModules, 'better-sqlite3'), { recursive: true })

    const { zipPath } = await buildCodeZip()
    const mod = await import('./code-update')
    const active = await mod.installCodeUpdatePackage({
      zipPath,
      sha256: 'deadbeef',
      manifest: manifest('0.2.102')
    })
    expect(existsSync(join(active.root, 'qwicks', 'node_modules'))).toBe(true)
  })
})
