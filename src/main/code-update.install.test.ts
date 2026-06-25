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

// Regression guard for the "hot update installed, then runtime crashes on
// missing better-sqlite3" bug. A code update is installed while getAppPath()
// points at install-machine A; the app then runs from install-machine B (a
// different path — e.g. dev build vs. real install, or the app was moved). The
// junctions recorded A's absolute path, so on B they are dangling and ESM
// bare-specifier resolution (which ignores NODE_PATH) cannot find the hoisted
// native addons. resolveHotCodeQWicksRoot must re-point them at the live path.
describe('resolveHotCodeQWicksRoot native-module linking across install locations', () => {
  let userData: string
  let installMachineRoot: string
  let runMachineRoot: string
  let getAppPath: () => string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'qwicks-xmachine-userdata-'))
    installMachineRoot = mkdtempSync(join(tmpdir(), 'qwicks-install-machine-'))
    runMachineRoot = mkdtempSync(join(tmpdir(), 'qwicks-run-machine-'))
    // Start pointing at the install machine.
    let current = installMachineRoot
    getAppPath = () => current
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: {
        isPackaged: true,
        getAppPath,
        getPath: () => userData
      }
    }))
    // Expose a setter to flip the "machine" mid-test.
    ;(getAppPath as unknown as { set: (v: string) => void }).set = (v: string) => {
      current = v
    }
  })

  afterEach(() => {
    vi.doUnmock('electron')
    vi.resetModules()
    for (const d of [userData, installMachineRoot, runMachineRoot]) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  /** Seed an app.asar.unpacked-style tree with the hoisted native addon.
   * `tag` is written into the resolved module so the test can tell which
   * machine's tree a junction ultimately points at. */
  function seedUnpackedTree(root: string, tag: string): void {
    // qwicks-scoped deps (whatever ships under qwicks/node_modules)
    mkdirSync(join(root, 'qwicks', 'node_modules', '@scoped', 'dep'), { recursive: true })
    // hoisted native addon that ESM resolution must find via versions/<id>/node_modules.
    // createRequire.resolve('better-sqlite3') follows package.json "main", so the
    // target file must exist for the probe to pass.
    mkdirSync(join(root, 'node_modules', 'better-sqlite3', 'lib'), { recursive: true })
    writeFileSync(
      join(root, 'node_modules', 'better-sqlite3', 'lib', 'index.js'),
      `module.exports = ${JSON.stringify({ tag })}`
    )
    writeFileSync(
      join(root, 'node_modules', 'better-sqlite3', 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', main: 'lib/index.js' })
    )
    // createRequire probe in resolveHotCodeQWicksRoot resolves relative to this
    writeFileSync(join(root, 'qwicks', 'package.json'), JSON.stringify({ name: 'qwicks' }))
  }

  /** Read the `tag` baked into a resolved better-sqlite3 module (which machine). */
  function tagAt(p: string): string | undefined {
    try {
      return require('node:fs').readFileSync(p, 'utf8').match(/"tag":"([^"]*)"/)?.[1]
    } catch {
      return undefined
    }
  }

  it('re-points dangling junctions at the live install path so better-sqlite3 resolves', async () => {
    // 1. Seed BOTH machines with the native module tree, tagged so we can tell
    //    which machine a junction ultimately points at.
    seedUnpackedTree(installMachineRoot, 'install-machine')
    seedUnpackedTree(runMachineRoot, 'run-machine')

    // 2. Install the hot update while getAppPath() == install machine (A).
    const zipPath = join(userData, 'code.zip')
    const zip = new JSZip()
    zip.file('renderer/index.html', '<!doctype html>')
    zip.file('preload/index.cjs', "require('electron')")
    zip.file('qwicks/package.json', JSON.stringify({ name: 'qwicks' }))
    zip.file('qwicks/dist/cli/serve-entry.js', 'export {}')
    writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const installMod = await import('./code-update')
    const active = await installMod.installCodeUpdatePackage({
      zipPath,
      sha256: 'deadbeef',
      manifest: manifest('0.2.200')
    })

    // Junctions recorded the install machine's absolute path. While still on
    // the install machine, better-sqlite3 resolves to the install-machine tree.
    const hoistedLink = join(active.root, 'node_modules')
    expect(existsSync(hoistedLink)).toBe(true)
    expect(
      tagAt(join(active.root, 'node_modules', 'better-sqlite3', 'lib', 'index.js'))
    ).toBe('install-machine')

    // 3. Now "move" to the run machine (B) — different absolute path. The old
    //    junctions still point at A; on a real cross-machine install A does not
    //    exist here, so the hoisted native addon would be unresolvable.
    ;(getAppPath as unknown as { set: (v: string) => void }).set(runMachineRoot)

    // 4. resolveHotCodeQWicksRoot must re-create the junctions at the live path
    //    and return the hot-code root (NOT fall back to defaultRoot).
    const root = installMod.resolveHotCodeQWicksRoot('<default>')
    expect(root).toBe(active.root)

    // 5. The hoisted junction must now resolve better-sqlite3 from the RUN
    //    machine, proving it was re-pointed (not left dangling at the install
    //    machine's path). Without the fix this still reads 'install-machine'
    //    — or, on a true cross-machine deploy, the path is dead and resolution
    //    fails entirely (the original crash).
    expect(
      tagAt(join(active.root, 'node_modules', 'better-sqlite3', 'lib', 'index.js'))
    ).toBe('run-machine')
  })

  it('falls back to the bundled runtime when no install carries better-sqlite3', async () => {
    // Neither machine has the native module tree — must not use hot-code root.
    const zipPath = join(userData, 'code.zip')
    const zip = new JSZip()
    zip.file('renderer/index.html', '<!doctype html>')
    zip.file('preload/index.cjs', "require('electron')")
    zip.file('qwicks/package.json', JSON.stringify({ name: 'qwicks' }))
    zip.file('qwicks/dist/cli/serve-entry.js', 'export {}')
    writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))

    const installMod = await import('./code-update')
    await installMod.installCodeUpdatePackage({
      zipPath,
      sha256: 'deadbeef',
      manifest: manifest('0.2.201')
    })

    expect(installMod.resolveHotCodeQWicksRoot('<default>')).toBe('<default>')
  })
})
