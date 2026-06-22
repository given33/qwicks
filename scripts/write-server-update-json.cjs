#!/usr/bin/env node

const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')

const DEFAULT_BASE_URL = 'http://8.138.40.16/qwicks'

function argValue(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}

function readTextFileIfPresent(path) {
  if (!path) return ''
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function quoteJson(value) {
  return JSON.stringify(value, null, 2)
}

function yamlScalar(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`^${escaped}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'))
  return match?.[1]?.trim() || ''
}

function newestFile(files) {
  return files
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file
}

function main() {
  const distDir = resolve(argValue('dist', 'dist'))
  const platform = argValue('platform', 'win')
  const channel = trimSlashes(argValue('channel', process.env.QWICKS_UPDATE_CHANNEL || 'stable')) || 'stable'
  const baseUrl = normalizeBaseUrl(argValue('base-url', process.env.QWICKS_UPDATE_BASE_URL || DEFAULT_BASE_URL))
  const releaseNotes =
    String(argValue('release-notes', '')).trim() ||
    readTextFileIfPresent(argValue('release-notes-file', ''))
  const updateFile = platform === 'mac' ? 'latest-mac.yml' : platform === 'linux' ? 'latest-linux.yml' : 'latest.yml'
  const updatePath = join(distDir, updateFile)
  const updateYaml = readFileSync(updatePath, 'utf8')
  const version = yamlScalar(updateYaml, 'version')
  if (!version) throw new Error(`${updateFile} is missing version`)

  const names = readdirSync(distDir)
  const installerCandidates = names
    .filter((name) => /^QWicks-.*-win-x64\.exe$/.test(name))
    .map((name) => join(distDir, name))
  const installerPath = newestFile(installerCandidates)
  if (!installerPath) throw new Error('Missing Windows installer in dist')

  const installerName = basename(installerPath)
  const blockmapName = `${installerName}.blockmap`
  const publicBase = `${baseUrl}/channels/${channel}/latest`
  const manifest = {
    product: 'QWicks',
    kind: 'installer',
    platform,
    channel,
    version,
    releaseDate: yamlScalar(updateYaml, 'releaseDate') || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    updateBaseUrl: `${publicBase}/`,
    electronUpdaterManifest: `${publicBase}/${updateFile}`,
    ...(releaseNotes ? { releaseNotes } : {}),
    installer: {
      name: installerName,
      url: `${publicBase}/${installerName}`
    },
    files: [
      {
        name: updateFile,
        url: `${publicBase}/${updateFile}`
      },
      {
        name: installerName,
        url: `${publicBase}/${installerName}`
      },
      ...(names.includes(blockmapName)
        ? [{
            name: blockmapName,
            url: `${publicBase}/${blockmapName}`
          }]
        : [])
    ]
  }

  const outPath = join(distDir, 'latest.json')
  writeFileSync(outPath, `${quoteJson(manifest)}\n`, 'utf8')
  console.log(`Wrote ${outPath}`)
}

try {
  main()
} catch (error) {
  console.error(`[write-server-update-json] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
