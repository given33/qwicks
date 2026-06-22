import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendManagedLogLine, configureLogger, logError } from './logger'

let logDir = ''

async function readManagedLogs(): Promise<string> {
  const files = await readdir(logDir)
  const texts = await Promise.all(
    files.map((file) => readFile(join(logDir, file), 'utf8'))
  )
  return texts.join('\n')
}

beforeEach(async () => {
  logDir = await mkdtemp(join(tmpdir(), 'qwicks-logger-test-'))
  configureLogger({ dir: logDir, enabled: true, retentionDays: 30 })
})

afterEach(async () => {
  configureLogger({ dir: '', enabled: false, retentionDays: 30 })
  if (logDir) {
    await rm(logDir, { recursive: true, force: true })
    logDir = ''
  }
})

describe('managed logger redaction', () => {
  it('redacts labeled secrets before writing managed log lines', async () => {
    await appendManagedLogLine(
      'qwicks',
      'Authorization: Bearer runtime-token {"apiKey":"sk-json","safe":"visible"}'
    )

    const text = await readManagedLogs()
    expect(text).toContain('Authorization: Bearer <redacted>')
    expect(text).toContain('"apiKey":"<redacted>"')
    expect(text).toContain('"safe":"visible"')
    expect(text).not.toContain('runtime-token')
    expect(text).not.toContain('sk-json')
  })

  it('redacts object details written through logError', async () => {
    logError('security', 'provider failed token=runtime-token', {
      apiKey: 'sk-detail',
      nested: { Authorization: 'Bearer nested-token' },
      visible: 'keep-me'
    })

    await vi.waitFor(async () => {
      const text = await readManagedLogs()
      expect(text).toContain('token=<redacted>')
      expect(text).toContain('"apiKey": "<redacted>"')
      expect(text).toContain('"Authorization": "<redacted>"')
      expect(text).toContain('"visible": "keep-me"')
      expect(text).not.toContain('runtime-token')
      expect(text).not.toContain('sk-detail')
      expect(text).not.toContain('nested-token')
    })
  })
})
