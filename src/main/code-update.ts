import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { GuiUpdateChannel } from '../shared/gui-update'

const require = createRequire(import.meta.url)
const extractZip = require('extract-zip') as typeof import('extract-zip')

const HOT_CODE_DIR = 'hot-code'
const ACTIVE_CODE_FILE = 'active.json'
const DISABLED_CODE_FILE = 'last-disabled.json'
const HISTORY_FILE = 'history.json'
const MAX_HISTORY_ENTRIES = 10

export type CodeVersionHistoryEntry = {
  version: string
  root: string
  sha256?: string
  installedAt: string
  /** 被替换的原因：正常更新或撤包回退。 */
  replacedBy?: 'update' | 'rollback'
  replacedAt?: string
}

export type CodeVersionHistory = {
  entries: CodeVersionHistoryEntry[]
}

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
  /** 发布者设为 true 强制客户端回退到本版本（绕过版本比较，撤包用）。 */
  forceRollback?: boolean
  /** 配合 forceRollback：记录从哪个版本回退（用于历史/日志），客户端不强校验。 */
  rollbackFromVersion?: string
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

function historyPath(): string {
  return join(hotCodeRootDir(), HISTORY_FILE)
}

/** 读取热更新版本历史（回切点索引）。文件缺失/损坏返回空历史。 */
export function readCodeVersionHistory(): CodeVersionHistory {
  try {
    const raw = JSON.parse(readFileSync(historyPath(), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return { entries: [] }
    const entries = (raw as CodeVersionHistory).entries
    if (!Array.isArray(entries)) return { entries: [] }
    return {
      entries: entries.filter(
        (entry): entry is CodeVersionHistoryEntry =>
          entry && typeof entry === 'object' &&
          typeof entry.version === 'string' &&
          typeof entry.root === 'string'
      )
    }
  } catch {
    return { entries: [] }
  }
}

/**
 * 把被替换的旧 active 版本追加进历史（作为回切点）。超过 MAX_HISTORY_ENTRIES
 * 条时删最旧的，并清理对应 versions/<id> 目录释放空间。幂等。
 */
export async function appendCodeVersionHistory(
  previous: ActiveCodePackage,
  reason: 'update' | 'rollback'
): Promise<void> {
  const root = hotCodeRootDir()
  await mkdir(root, { recursive: true })
  const history = readCodeVersionHistory()
  const nowIso = new Date().toISOString()
  const entry: CodeVersionHistoryEntry = {
    version: previous.version,
    root: previous.root,
    ...(previous.sha256 ? { sha256: previous.sha256 } : {}),
    installedAt: previous.installedAt,
    replacedBy: reason,
    replacedAt: nowIso
  }
  // 去重：同 version+root 只保留最新一条。
  const deduped = history.entries.filter(
    (existing) => !(existing.version === entry.version && existing.root === entry.root)
  )
  const next = [entry, ...deduped].slice(0, MAX_HISTORY_ENTRIES)
  // 清理被裁掉的旧条目对应的目录（释放磁盘）。
  const removed = deduped.slice(MAX_HISTORY_ENTRIES - 1)
  for (const stale of removed) {
    await rm(stale.root, { recursive: true, force: true }).catch(() => {})
  }
  await writeFile(historyPath(), `${JSON.stringify({ entries: next }, null, 2)}\n`, 'utf8')
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

/**
 * The bundled app.asar.unpacked root for the *currently running* install.
 * Resolved at call time (not cached) so it is always correct for THIS machine —
 * critical because a hot update may have been installed on a different machine
 * (e.g. a dev build) and its recorded absolute paths would be wrong here.
 */
function bundledUnpackedRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

/**
 * Synchronously ensure the hot-code version root has working node_modules
 * junctions into the CURRENT install's app.asar.unpacked.
 *
 * The qwicks runtime is ESM ("type": "module"). ESM bare-specifier resolution
 * does NOT honor NODE_PATH — it only walks up from the importing file looking
 * for node_modules directories. So the hot-code version root must expose, via
 * real node_modules directories reachable by walking up from
 * `versions/<id>/qwicks/dist/cli/serve-entry.js`:
 *   - qwicks-scoped deps  -> versions/<id>/qwicks/node_modules
 *   - hoisted native addons (better-sqlite3, node-pty, @computer-use/*, ...)
 *     -> versions/<id>/node_modules
 *
 * These junctions are created at install time too, but an install recorded the
 * install machine's absolute path; on a different machine (or after the app was
 * moved) they point nowhere. Recreate them here from the live install path so
 * the runtime can always resolve native modules. Returns true on success.
 */
function ensureHotCodeNodeModulesLinks(activeRoot: string): boolean {
  const unpackedRoot = bundledUnpackedRoot()
  const scopedSource = join(unpackedRoot, 'qwicks', 'node_modules')
  const hoistedSource = join(unpackedRoot, 'node_modules')
  if (!directoryExists(scopedSource) && !directoryExists(hoistedSource)) return false

  const recreateJunction = (linkPath: string, source: string): void => {
    if (!directoryExists(source)) return
    // Remove a broken/stale link (rmSync follows the link target only for
    // 'file'/'dir' symlinks; junctions are removed, not their target).
    try {
      rmSync(linkPath, { force: true, recursive: true })
    } catch {
      /* may not exist */
    }
    try {
      symlinkSync(source, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      console.warn(
        '[qwicks-gui code-update] failed to recreate node_modules junction at',
        linkPath,
        '->',
        source,
        ':',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  // versions/<id>/qwicks/node_modules  -> app.asar.unpacked/qwicks/node_modules
  recreateJunction(join(activeRoot, 'qwicks', 'node_modules'), scopedSource)
  // versions/<id>/node_modules         -> app.asar.unpacked/node_modules (hoisted)
  recreateJunction(join(activeRoot, 'node_modules'), hoistedSource)
  return true
}

export function resolveHotCodeQWicksRoot(defaultRoot: string): string {
  const active = getActiveCodePackageSync()
  if (!active) return defaultRoot
  const serveEntry = join(active.root, 'qwicks', 'dist', 'cli', 'serve-entry.js')
  if (!fileExists(serveEntry)) return defaultRoot

  // The bundled install must actually carry the native addons the runtime
  // needs. If even the bundled install can't resolve better-sqlite3, the
  // hot-code version can't either — fall back to the bundled qwicks runtime.
  try {
    const unpackedRoot = bundledUnpackedRoot()
    const bundledRequire = createRequire(join(unpackedRoot, 'qwicks', 'package.json'))
    bundledRequire.resolve('better-sqlite3')
  } catch {
    console.warn(
      '[qwicks-gui code-update] bundled install cannot resolve better-sqlite3;',
      'falling back to bundled qwicks runtime'
    )
    return defaultRoot
  }

  // Recreate the node_modules junctions from the live install path. This fixes
  // links that were recorded with a different machine's absolute path (the
  // "restart-to-update installed, then runtime crashes on missing
  // better-sqlite3" bug) and is a no-op when they are already correct.
  ensureHotCodeNodeModulesLinks(active.root)

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
  // A hot code update only swaps the renderer + preload (+ qwicks runtime).
  // The main process (out/main/index.js) is NEVER part of a code.zip — it is
  // bundled in app.asar and only replaced by a full installer — so requiring
  // main/app-main.js here would reject every real code package and make
  // "restart to update" silently do nothing (installCodeUpdatePackage throws).
  // Require exactly the two artifacts the hot-code loaders actually consume:
  //   resolveHotCodeRendererIndexPath -> renderer/index.html
  //   resolveHotCodePreloadPath       -> preload/index.cjs | preload/index.mjs
  return (
    directoryExists(root) &&
    fileExists(join(root, 'renderer', 'index.html')) &&
    (fileExists(join(root, 'preload', 'index.cjs')) || fileExists(join(root, 'preload', 'index.mjs')))
  )
}

async function linkBundledQWicksNodeModules(targetRoot: string): Promise<void> {
  const runtimeRoot = join(targetRoot, 'qwicks')
  const scopedTarget = join(runtimeRoot, 'node_modules')
  if (!directoryExists(runtimeRoot) || directoryExists(scopedTarget)) return

  const unpackedRoot = bundledUnpackedRoot()
  const linkInto = async (linkPath: string, source: string): Promise<void> => {
    if (!directoryExists(source) || directoryExists(linkPath)) return
    try {
      await symlink(source, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      console.warn(
        '[qwicks-gui code-update] failed to link bundled node_modules:',
        error instanceof Error ? error.message : String(error)
      )
      console.warn('[qwicks-gui code-update] source:', source)
      console.warn('[qwicks-gui code-update] target:', linkPath)
    }
  }
  // Two junctions so ESM bare-specifier resolution (which walks up from the
  // importing file and ignores NODE_PATH) finds both the qwicks-scoped deps
  // and the hoisted native addons (better-sqlite3, node-pty, ...). These record
  // THIS machine's path; resolveHotCodeQWicksRoot re-points them at runtime if
  // the app later runs from a different install location.
  await linkInto(scopedTarget, join(unpackedRoot, 'qwicks', 'node_modules'))
  await linkInto(join(targetRoot, 'node_modules'), join(unpackedRoot, 'node_modules'))
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
    throw new Error(
      'The downloaded code package is missing renderer/index.html or preload/index.cjs (or preload/index.mjs).'
    )
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
  // 撤包支持：覆盖 active.json 前，把当前 active 快照追加进版本历史，作为回切点。
  // 这样发布者 forceRollback 回退后，磁盘上仍留有被替换版本的索引可再切回。
  const previousActive = readActiveCodePackageFromDisk()
  if (previousActive) {
    await appendCodeVersionHistory(
      previousActive,
      downloaded.manifest.forceRollback === true ? 'rollback' : 'update'
    ).catch((error) => {
      // 历史记录失败不应阻塞安装（回切点是辅助能力，非关键路径）。
      console.warn('[qwicks-gui code-update] failed to record version history:', error)
    })
  }
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
