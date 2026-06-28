#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const DEFAULT_MAJOR = 0
const DEFAULT_MINOR = 2
const SEMVER_VERSION = /^(\d+)\.(\d+)\.(\d+)$/

function argValue(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function parseOptionalInteger(value, name) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name} must be a non-negative integer, got: ${value}`)
  }
  return Number.parseInt(text, 10)
}

function parseSemverVersion(version, label = 'Version') {
  const value = String(version || '').trim()
  const match = value.match(SEMVER_VERSION)
  if (!match) {
    throw new Error(`${label} must be x.y.z, got: ${version || '(empty)'}`)
  }
  return {
    version: value,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  }
}

function gitCommitCount() {
  const output = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  const count = parseOptionalInteger(output, 'git commit count')
  if (count === null) {
    throw new Error('Could not compute a monotonic patch version from git history.')
  }
  return count
}

function computeUpdateVersion({
  manualVersion = '',
  commitCount,
  major = DEFAULT_MAJOR,
  minor = DEFAULT_MINOR
} = {}) {
  const manual = String(manualVersion || '').trim()
  if (manual) {
    const parsed = parseSemverVersion(manual, 'Version')
    return {
      version: parsed.version,
      source: 'manual'
    }
  }

  const parsedCommitCount = parseOptionalInteger(commitCount, 'commitCount')
  const patch = parsedCommitCount ?? gitCommitCount()
  const version = `${major}.${minor}.${patch}`
  parseSemverVersion(version, 'Computed version')
  return {
    version,
    source: 'commit_count'
  }
}

function writeGitHubOutputs(result) {
  const lines = [
    `version=${result.version}`,
    `source=${result.source}`
  ]

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8')
  }
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `QWICKS_APP_VERSION=${result.version}\n`, 'utf8')
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Version',
        '',
        `- Version: \`${result.version}\``,
        `- Source: \`${result.source}\``,
        ''
      ].join('\n'),
      'utf8'
    )
  }
}

function main() {
  const result = computeUpdateVersion({
    manualVersion: argValue('version', process.env.QWICKS_APP_VERSION || ''),
    commitCount: argValue('commit-count', '')
  })
  writeGitHubOutputs(result)
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[compute-update-version] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = {
  computeUpdateVersion,
  gitCommitCount,
  parseSemverVersion
}
