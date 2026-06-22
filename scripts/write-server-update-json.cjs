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
  const linePattern = new RegExp(`^${escaped}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`)
  for (const line of String(source || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const match = line.match(linePattern)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function yamlBlockScalar(key, value) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text) return ''
  const body = text.split('\n').map((line) => `  ${line}`).join('\n')
  return `${key}: |-\n${body}\n`
}

function removeTopLevelYamlKey(source, key) {
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out = []
  for (let i = 0; i < lines.length;) {
    if (lines[i].startsWith(`${key}:`)) {
      i += 1
      while (
        i < lines.length &&
        (lines[i].startsWith(' ') || lines[i].startsWith('\t') || lines[i].trim() === '')
      ) {
        i += 1
      }
      continue
    }
    out.push(lines[i])
    i += 1
  }
  return `${out.join('\n').replace(/\n*$/g, '')}\n`
}

function writeYamlReleaseNotes(path, source, releaseNotes) {
  const block = yamlBlockScalar('releaseNotes', releaseNotes)
  if (!block) return source
  const updated = `${removeTopLevelYamlKey(source, 'releaseNotes')}${block}`
  writeFileSync(path, updated, 'utf8')
  return updated
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
  let updateYaml = readFileSync(updatePath, 'utf8')
  updateYaml = writeYamlReleaseNotes(updatePath, updateYaml, releaseNotes)
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
