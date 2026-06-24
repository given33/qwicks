import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { GuiUpdateChannel } from '../shared/gui-update'

const require = createRequire(import.meta.url)
const extractZip = require('extract-zip') as typeof import('extract-zip')

const HOT_CODE_DIR = 'hot-code'
const ACTIVE_CODE_FILE = 'active.json'
const DISABLED_CODE_FILE = 'last-disabled.json'

export type CodeUpdatePackageFile = {
  name: string
  url: string
  sha256?: string
  size?: number
}

export type CodeUpdateManifest = {
  kind: 'code'
  product?: string
  platform?: string
  channel?: GuiUpdateChannel
  version: string
  releaseDate?: string
  releaseNotes?: string
  minShellVersion?: string
  fullUpdateRequired?: boolean
  package: CodeUpdatePackageFile
}

export type ActiveCodePackage = {
  version: string
  channel?: GuiUpdateChannel
  root: string
  installedAt: string
  releaseDate?: string
  releaseNotes?: string
  sha256?: string
}

export type DownloadedCodeUpdatePackage = {
  zipPath: string
  sha256: string
  manifest: CodeUpdateManifest
}

function hotCodeRootDir(): string {
  return join(app.getPath('userData'), HOT_CODE_DIR)
}

function activeCodePath(): string {
  return join(hotCodeRootDir(), ACTIVE_CODE_FILE)
}

function disabledCodePath(): string {
  return join(hotCodeRootDir(), DISABLED_CODE_FILE)
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'code'
}

function parseActiveCodePackage(raw: unknown): ActiveCodePackage | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<ActiveCodePackage>
  if (typeof data.version !== 'string' || !data.version.trim()) return null
  if (typeof data.root !== 'string' || !isAbsolute(data.root)) return null
  if (!isPathInside(hotCodeRootDir(), data.root)) return null
  const active: ActiveCodePackage = {
    version: data.version.trim(),
    root: data.root,
    installedAt: typeof data.installedAt === 'string' ? data.installedAt : '',
    ...(data.channel === 'stable' || data.channel === 'frontier' ? { channel: data.channel } : {}),
    ...(typeof data.releaseDate === 'string' && data.releaseDate.trim() ? { releaseDate: data.releaseDate.trim() } : {}),
    ...(typeof data.releaseNotes === 'string' && data.releaseNotes.trim() ? { releaseNotes: data.releaseNotes.trim() } : {}),
    ...(typeof data.sha256 === 'string' && data.sha256.trim() ? { sha256: data.sha256.trim() } : {})
  }
  return validateInstalledCodeRoot(active.root) ? active : null
}

function readActiveCodePackageFromDisk(): ActiveCodePackage | null {
  if (!app.isPackaged) return null
  try {
    return parseActiveCodePackage(JSON.parse(readFileSync(activeCodePath(), 'utf8')) as unknown)
  } catch {
    return null
  }
}

export function getActiveCodePackageSync(): ActiveCodePackage | null {
  return readActiveCodePackageFromDisk()
}

export function currentCodeOrShellVersion(): string {
  return getActiveCodePackageSync()?.version ?? app.getVersion()
}

export function resolveHotCodePreloadPath(): string | null {
  const active = getActiveCodePackageSync()
  if (!active) return null
  const cjsPath = join(active.root, 'preload', 'index.cjs')
  if (fileExists(cjsPath)) return cjsPath
  const mjsPath = join(active.root, 'preload', 'index.mjs')
  return fileExists(mjsPath) ? mjsPath : null
}

export function resolveHotCodeRendererIndexPath(): string | null {
  const active = getActiveCodePackageSync()
  if (!active) return null
  const indexPath = join(active.root, 'renderer', 'index.html')
  return fileExists(indexPath) ? indexPath : null
}

export function resolveHotCodeMainPath(): string | null {
  const active = getActiveCodePackageSync()
  if (!active) return null
  const mainPath = join(active.root, 'main', 'app-main.js')
  return fileExists(mainPath) ? mainPath : null
}

export function resolveHotCodeQWicksRoot(defaultRoot: string): string {
  const active = getActiveCodePackageSync()
  if (!active) return defaultRoot
  const serveEntry = join(active.root, 'qwicks', 'dist', 'cli', 'serve-entry.js')
  const nodeModules = join(active.root, 'qwicks', 'node_modules')
  if (!fileExists(serveEntry) || !directoryExists(nodeModules)) return defaultRoot

  // The node_modules in the hot-code root is a symlink to the bundled
  // installation. On Windows the junction can silently break (permission
  // issues, moved install dir, etc.). Verify that a key native module
  // is accessible through the symlink before trusting it.
  //
  // createRequire resolves relative to the importing file's physical
  // directory tree, so it won't walk into symlinked directories above
  // the junction point. Instead, probe the bundled app.asar.unpacked
  // directly — it must contain every native module the qwicks runtime
  // needs (better-sqlite3, node-pty, etc.).
  try {
    const unpackedRoot = app.isPackaged
      ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
      : app.getAppPath()
    const bundledRequire = createRequire(join(unpackedRoot, 'qwicks', 'package.json'))
    bundledRequire.resolve('better-sqlite3')
  } catch {
    console.warn(
      '[qwicks-gui code-update] hot-code node_modules symlink appears broken;',
      'falling back to bundled qwicks runtime'
    )
    return defaultRoot
  }

  return active.root
}

export function isHotCodePath(path: string): boolean {
  const active = getActiveCodePackageSync()
  return Boolean(active && isPathInside(active.root, path))
}

export async function deactivateActiveCodePackage(reason: string): Promise<void> {
  const root = hotCodeRootDir()
  await mkdir(root, { recursive: true })
  const payload = {
    disabledAt: new Date().toISOString(),
    reason
  }
  await rm(activeCodePath(), { force: true })
  await writeFile(disabledCodePath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function validateInstalledCodeRoot(root: string): boolean {
  return (
    directoryExists(root) &&
    fileExists(join(root, 'main', 'app-main.js')) &&
    fileExists(join(root, 'renderer', 'index.html')) &&
    (fileExists(join(root, 'preload', 'index.cjs')) || fileExists(join(root, 'preload', 'index.mjs')))
  )
}

function bundledQWicksNodeModulesDir(): string {
  const root = app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
  return join(root, 'qwicks', 'node_modules')
}

async function linkBundledQWicksNodeModules(targetRoot: string): Promise<void> {
  const runtimeRoot = join(targetRoot, 'qwicks')
  const target = join(runtimeRoot, 'node_modules')
  if (!directoryExists(runtimeRoot) || directoryExists(target)) return

  const source = bundledQWicksNodeModulesDir()
  if (!directoryExists(source)) {
    console.warn('[qwicks-gui code-update] bundled qwicks/node_modules not found at', source)
    return
  }
  try {
    await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    console.warn(
      '[qwicks-gui code-update] failed to link bundled node_modules:',
      error instanceof Error ? error.message : String(error)
    )
    console.warn('[qwicks-gui code-update] source:', source)
    console.warn('[qwicks-gui code-update] target:', target)
    console.warn('[qwicks-gui code-update] hot-code qwicks runtime will use NODE_PATH fallback')
  }
}

function resolveExtractedPackageRoot(extractDir: string): string {
  if (validateInstalledCodeRoot(extractDir)) return extractDir

  let entries: string[] = []
  try {
    entries = readdirSync(extractDir)
  } catch {
    return extractDir
  }
  const directoryEntries = entries
    .map((entry) => join(extractDir, entry))
    .filter(directoryExists)
  if (directoryEntries.length === 1 && validateInstalledCodeRoot(directoryEntries[0])) {
    return directoryEntries[0]
  }
  return extractDir
}

export async function installCodeUpdatePackage(
  downloaded: DownloadedCodeUpdatePackage
): Promise<ActiveCodePackage> {
  const root = hotCodeRootDir()
  const id = sanitizePathSegment(`${downloaded.manifest.version}-${downloaded.sha256.slice(0, 12)}`)
  const stagingRoot = join(root, 'staging', id)
  const extractDir = join(stagingRoot, 'package')
  const targetRoot = join(root, 'versions', id)

  await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })
  await extractZip(downloaded.zipPath, { dir: extractDir })

  const packageRoot = resolveExtractedPackageRoot(extractDir)
  if (!validateInstalledCodeRoot(packageRoot)) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw new Error('The downloaded code package is missing renderer/index.html or preload/index.cjs.')
  }

  await mkdir(dirname(targetRoot), { recursive: true })
  await rm(targetRoot, { recursive: true, force: true })
  await rename(packageRoot, targetRoot)
  await rm(stagingRoot, { recursive: true, force: true })
  await linkBundledQWicksNodeModules(targetRoot)

  const active: ActiveCodePackage = {
    version: downloaded.manifest.version,
    ...(downloaded.manifest.channel ? { channel: downloaded.manifest.channel } : {}),
    root: targetRoot,
    installedAt: new Date().toISOString(),
    ...(downloaded.manifest.releaseDate ? { releaseDate: downloaded.manifest.releaseDate } : {}),
    ...(downloaded.manifest.releaseNotes ? { releaseNotes: downloaded.manifest.releaseNotes } : {}),
    sha256: downloaded.sha256
  }
  await mkdir(dirname(activeCodePath()), { recursive: true })
  await writeFile(activeCodePath(), `${JSON.stringify(active, null, 2)}\n`, 'utf8')
  return active
}

export function codeUpdateDownloadDir(): string {
  return join(hotCodeRootDir(), 'downloads')
}

export function codeUpdatePackagePath(version: string, sha256: string): string {
  const id = sanitizePathSegment(`${version}-${sha256.slice(0, 12)}`)
  return join(codeUpdateDownloadDir(), `${id}.zip`)
}

export function activeCodePackageExists(): boolean {
  return existsSync(activeCodePath())
}
