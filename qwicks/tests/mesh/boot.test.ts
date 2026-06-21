import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootMesh, type BootDeps } from '@qwicks/mesh/index.js'
import { MeshConfig } from '@qwicks/mesh/config.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'
import type { ChildRunResult } from '@qwicks/mesh/contracts.js'

const fakeLocal: ChildRunExecutor = async () => ({
  summary: 'ran locally on worker',
  toolInvocations: 0,
  prefixReused: true,
  inheritedHistoryItems: 0
})
const fakeRunRemote = async (): Promise<ChildRunResult> => ({
  summary: 'ran on peer',
  status: 'completed',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
})

describe('bootMesh (RFC 000 §4, §5)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function deps(): Promise<BootDeps> {
    const identity = await loadOrCreateDeviceIdentity(dir)
    return {
      identity,
      dataDir: dir,
      localExecutor: fakeLocal,
      runRemote: fakeRunRemote,
      isPeerAuthorized: () => true,
      discovery: { publish: () => ({ stop: () => {} }), find: () => ({ stop: () => {} }) } as never,
      deviceName: 'test-host',
      manifest: {
        models: [{ id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }],
        tools: [],
        computeProfile: { canRunLocalModels: true }
      }
    }
  }

  it('returns null and starts nothing when mesh is disabled (opt-in first principle)', async () => {
    const config = MeshConfig.parse({ enabled: false })
    const handle = await bootMesh(config, await deps())
    expect(handle).toBeNull()
  })

  it('assembles a handle exposing a remoteExecutor + stores when enabled', async () => {
    const config = MeshConfig.parse({ enabled: true, deviceName: 'test-host' })
    const handle = await bootMesh(config, await deps())
    expect(handle).not.toBeNull()
    expect(typeof handle!.remoteExecutor).toBe('function')
    expect(handle!.manifestStore).toBeDefined()
    expect(handle!.taskServer).toBeDefined()
    expect(handle!.responder).toBeDefined()
    await handle!.shutdown()
  })

  it('the remoteExecutor round-trips through the injected runRemote', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    const result = await handle!.remoteExecutor({
      childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: new AbortController().signal
    })
    expect(result.summary).toBe('ran on peer')
    await handle!.shutdown()
  })

  it('shutdown is idempotent', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    await handle!.shutdown()
    await expect(handle!.shutdown()).resolves.not.toThrow()
  })
})
