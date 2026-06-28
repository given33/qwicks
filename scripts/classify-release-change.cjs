#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')

const CODE_UPDATE_PREFIXES = [
  'src/renderer/',
  'src/renderer-mqpet/',
  'src/renderer-mqconsole/',
  'src/preload/',
  'src/asset/',
  'qwicks/src/'
]

const CODE_UPDATE_FILES = [
  'qwicks/package.json',
  'qwicks/tsconfig.json',
  'qwicks/tsconfig.build.json'
]

const INSTALLER_PREFIXES = [
  'src/main/',
  'src/shared/',
  'scripts/',
  'vendor/',
  'resources/',
  'build/',
  'native/',
  'public/'
]

const INSTALLER_FILES = [
  'package.json',
  'package-lock.json',
  'electron-builder.config.cjs',
  'electron.vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'qwicks/package-lock.json'
]

const IGNORED_PREFIXES = [
  '.github/',
  '.codex/',
  '.vscode/',
  'docs/'
]

const IGNORED_FILE_EXTENSIONS = [
  '.md',
  '.mdx'
]

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function unique(values) {
  return Array.from(new Set(values.map(normalizePath).filter(Boolean)))
}

function hasPrefix(file, prefixes) {
  return prefixes.some((prefix) => file.startsWith(prefix))
}

function hasIgnoredExtension(file) {
  const lower = file.toLowerCase()
  return IGNORED_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function isTestFile(file) {
  return (
    /(^|\/)(test|tests|__tests__)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  )
}

function isIgnoredFile(file) {
  return hasPrefix(file, IGNORED_PREFIXES) || hasIgnoredExtension(file) || isTestFile(file)
}

function isCodeUpdateFile(file) {
  return CODE_UPDATE_FILES.includes(file) || hasPrefix(file, CODE_UPDATE_PREFIXES)
}

function isInstallerFile(file) {
  return INSTALLER_FILES.includes(file) || hasPrefix(file, INSTALLER_PREFIXES)
}

function classifyFile(file) {
  const normalized = normalizePath(file)
  if (!normalized) return 'ignored'
  if (isIgnoredFile(normalized)) return 'ignored'
  if (isInstallerFile(normalized)) return 'installer'
  if (isCodeUpdateFile(normalized)) return 'code'
  return 'installer'
}

function classifyChangedFiles({ files = [] } = {}) {
  const changedFiles = unique(files)
  const codeFiles = []
  const installerFiles = []
  const ignoredFiles = []

  for (const file of changedFiles) {
    const kind = classifyFile(file)
    if (kind === 'code') codeFiles.push(file)
    else if (kind === 'installer') installerFiles.push(file)
    else ignoredFiles.push(file)
  }

  const fullInstallerNeeded = installerFiles.length > 0
  const codeUpdateNeeded = !fullInstallerNeeded && codeFiles.length > 0
  const releaseKind = fullInstallerNeeded ? 'installer' : codeUpdateNeeded ? 'code' : 'none'

  return {
    releaseKind,
    hotUpdateSafe: codeUpdateNeeded,
    codeUpdateNeeded,
    fullInstallerNeeded,
    changedFiles,
    codeFiles,
    installerFiles,
    ignoredFiles
  }
}

function gitChangedFiles(base, head = 'HEAD') {
  const normalizedBase = String(base || '').trim()
  const resolvedBase = normalizedBase && !/^0+$/.test(normalizedBase) ? normalizedBase : 'HEAD~1'
  const output = execFileSync('git', ['diff', '--name-only', resolvedBase, head], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

function quoteList(values) {
  return values.length ? values.map((value) => `  - \`${value}\``).join('\n') : '  - none'
}

function writeGitHubOutputs(result) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `release_kind=${result.releaseKind}`,
        `hot_update_safe=${result.hotUpdateSafe ? 'true' : 'false'}`,
        `code_update_needed=${result.codeUpdateNeeded ? 'true' : 'false'}`,
        `full_installer_needed=${result.fullInstallerNeeded ? 'true' : 'false'}`
      ].join('\n') + '\n',
      'utf8'
    )
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Release change classification',
        '',
        `- Release kind: \`${result.releaseKind}\``,
        `- Code update needed: \`${result.codeUpdateNeeded}\``,
        `- Full installer needed: \`${result.fullInstallerNeeded}\``,
        '',
        '**Code-update files**',
        quoteList(result.codeFiles),
        '',
        '**Installer files**',
        quoteList(result.installerFiles),
        '',
        '**Ignored files**',
        quoteList(result.ignoredFiles),
        ''
      ].join('\n'),
      'utf8'
    )
  }
}

function argValue(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function main() {
  const explicitFiles = argValue('files', '')
  const files = explicitFiles
    ? explicitFiles.split(',').map((file) => file.trim()).filter(Boolean)
    : gitChangedFiles(argValue('base', process.env.GITHUB_EVENT_BEFORE || ''), argValue('head', process.env.GITHUB_SHA || 'HEAD'))
  const result = classifyChangedFiles({ files })
  writeGitHubOutputs(result)
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[classify-release-change] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = {
  classifyChangedFiles,
  classifyFile,
  gitChangedFiles
}
