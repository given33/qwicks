#!/usr/bin/env node

const { readFileSync, statSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { basename, join, resolve } = require('node:path')

const DEFAULT_BASE_URL = 'http://8.138.40.16/qwicks'

function argValue(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '')
}

function readTextFileIfPresent(path) {
  if (!path) return ''
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function main() {
  const distDir = resolve(argValue('dist', 'dist/code-update'))
  const channel = trimSlashes(argValue('channel', process.env.QWICKS_UPDATE_CHANNEL || 'stable')) || 'stable'
  const baseUrl = normalizeBaseUrl(argValue('base-url', process.env.QWICKS_UPDATE_BASE_URL || DEFAULT_BASE_URL))
  const version = String(argValue('version', process.env.QWICKS_APP_VERSION || '')).trim()
  const packagePath = resolve(argValue('package', join(distDir, 'code.zip')))
  const minShellVersion = String(argValue('min-shell-version', process.env.QWICKS_MIN_SHELL_VERSION || '')).trim()
  const releaseNotes =
    String(argValue('release-notes', '')).trim() ||
    readTextFileIfPresent(argValue('release-notes-file', ''))

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Version must be x.y.z, got: ${version || '(empty)'}`)
  }
  if (minShellVersion && !/^\d+\.\d+\.\d+$/.test(minShellVersion)) {
    throw new Error(`Minimum shell version must be x.y.z, got: ${minShellVersion}`)
  }

  const name = basename(packagePath)
  const size = statSync(packagePath).size
  const sha256 = sha256File(packagePath)
  const publicBase = `${baseUrl}/channels/${channel}/latest`
  const manifest = {
    product: 'QWicks',
    kind: 'code',
    schemaVersion: 1,
    platform: 'win',
    channel,
    version,
    releaseDate: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    updateBaseUrl: `${publicBase}/`,
    ...(minShellVersion ? { minShellVersion } : {}),
    fullUpdateRequired: false,
    ...(releaseNotes ? { releaseNotes } : {}),
    package: {
      name,
      url: `${publicBase}/${name}`,
      size,
      sha256
    },
    files: [
      {
        name,
        url: `${publicBase}/${name}`,
        size,
        sha256
      }
    ]
  }

  const outPath = join(distDir, 'latest.json')
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${outPath}`)
}

try {
  main()
} catch (error) {
  console.error(`[write-code-update-json] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
