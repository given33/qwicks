import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildQWicksServeArgs,
  resolveQWicksExecutable,
  type QWicksBinaryResolution
} from './resolve-qwicks-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'qwicks-resolver-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveQWicksExecutable', () => {
  it('resolves the built QWicks entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'qwicks/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveQWicksExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'qwicks/src/cli/serve-entry.ts'))

    const resolution = resolveQWicksExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'qwicks/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a QWicks package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveQWicksExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveQWicksExecutable('/app', '/usr/local/bin/qwicks')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/qwicks',
      args: [],
      dataDir: ''
    })
  })
})

describe('buildQWicksServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: QWicksBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/qwicks/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildQWicksServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 8899,
      dataDir: '/tmp/qwicks',
      baseUrl: 'https://api.deepseek.com/beta',
      endpointFormat: 'responses',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(args).not.toContain('--api-key')
    expect(args).not.toContain('--runtime-token')
    expect(args).toContain('--endpoint-format')
    expect(args).toContain('responses')
    expect(args).toContain('--token-economy-mode')
    expect(args).toContain('false')
  })
})
