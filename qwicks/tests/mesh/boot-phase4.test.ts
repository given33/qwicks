import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootMesh, type BootDeps } from '@qwicks/mesh/index.js'
import { MeshConfig } from '@qwicks/mesh/config.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { MeshTransportClient } from '@qwicks/mesh/transport/transport.js'
import { ManifestStore, buildManifest, type ModelInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'
import type { ChildRunResult } from '@qwicks/mesh/contracts.js'

const qwen: ModelInput = { id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
const deepseek: ModelInput = { id: 'deepseek-r1-14b', provider: 'local', contextWindow: 65536, maxOutput: 16384, supportsTools: true, supportsVision: false, available: true, version: '14b' }

const fakeLocal: ChildRunExecutor = async () => ({
  summary: 'ran locally',
  toolInvocations: 0,
  prefixReused: true,
  inheritedHistoryItems: 0
})
const fakeRunRemote = async (): Promise<ChildRunResult> => ({
  summary: 'ran on peer',
  status: 'completed',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
})

describe('bootMesh Phase 4 — fan-out, model registry, partial invalidation', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-p4-'))
  })
  afterEach(async () => {
    // Give Windows a tick to release sqlite file handles before rmSync
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(dir, { recursive: true, force: true })
  })

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
        models: [qwen],
        tools: [],
        computeProfile: { canRunLocalModels: true }
      }
    }
  }

  /** Build a manifest for a synthetic peer and inject it into the store. */
  async function injectPeer(store: ManifestStore, deviceName: string, models: ModelInput[]) {
    const peerDir = mkdtempSync(join(tmpdir(), `peer-${deviceName}-`))
    const id = await loadOrCreateDeviceIdentity(peerDir)
    store.set(buildManifest({ identity: id, deviceName, models, tools: [], computeProfile: { canRunLocalModels: true } }))
    rmSync(peerDir, { recursive: true, force: true })
    return id
  }

  it('exposes peerModelRegistry, fanOutDecide and fanOutDispatch on the handle', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    expect(handle).not.toBeNull()
    expect(handle!.peerModelRegistry).toBeDefined()
    expect(typeof handle!.fanOutDecide).toBe('function')
    expect(typeof handle!.fanOutDispatch).toBe('function')
    await handle!.shutdown()
  })

  it('peerModelRegistry returns an empty list when no peers are known', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    expect(handle!.peerModelRegistry.listModels()).toHaveLength(0)
    await handle!.shutdown()
  })

  it('peerModelRegistry lists models from injected peer manifests', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    await injectPeer(handle!.manifestStore, 'gpu-host', [deepseek])
    const models = handle!.peerModelRegistry.listModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('deepseek-r1-14b')
    expect(models[0].hostDeviceName).toBe('gpu-host')
    await handle!.shutdown()
  })

  it('fanOutDecide falls back to local when no peers are known', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    const decision = handle!.fanOutDecide({ childId: 'c', prompt: 'p' })
    expect(decision.executor).toBe('local')
    await handle!.shutdown()
  })

  it('fanOutDecide returns every eligible peer for parallel dispatch', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    await injectPeer(handle!.manifestStore, 'a', [qwen])
    await injectPeer(handle!.manifestStore, 'b', [qwen])
    const decision = handle!.fanOutDecide({ childId: 'c', prompt: 'p', model: 'qwen2.5-7b' })
    expect(decision.executor).toBe('remote')
    expect(decision.workers.length).toBe(2)
    expect(decision.reason).toContain('fan_out:2_workers')
    await handle!.shutdown()
  })

  it('fanOutDispatch fans out to multiple workers and returns a result', async () => {
    const config = MeshConfig.parse({ enabled: true })
    const handle = await bootMesh(config, await deps())
    await injectPeer(handle!.manifestStore, 'w1', [qwen])
    await injectPeer(handle!.manifestStore, 'w2', [qwen])
    const workers = handle!.fanOutDecide({ childId: 'c', prompt: 'p', model: 'qwen2.5-7b' }).workers
    expect(workers.length).toBe(2)

    const out = await handle!.fanOutDispatch({
      taskId: 't-fanout',
      parentThreadId: 'th',
      parentTurnId: 'tn',
      prompt: 'p',
      toolPolicy: 'inherit',
      workers,
      mode: 'all',
      signal: new AbortController().signal
    })
    expect(out.mode).toBe('all')
    expect(out.results).toHaveLength(2)
    expect(out.results.every((r) => r.summary === 'ran on peer')).toBe(true)
    await handle!.shutdown()
  })

  it('routes memory/invalidated notification to onMemoryInvalidated with chunkIds/scopes', async () => {
    const invalidated: Array<{ deviceId: string; chunkIds?: string[]; scopes?: string[] }> = []
    const config = MeshConfig.parse({ enabled: true })
    const d = await deps()
    d.onMemoryInvalidated = (deviceId, opts) => invalidated.push({ deviceId, ...opts })

    const handle = await bootMesh(config, d)
    const client = new MeshTransportClient()
    await client.connect(`ws://127.0.0.1:${handle!.transportPort}`)
    await new Promise((resolve) => setTimeout(resolve, 100))

    client.notify('memory/invalidated', {
      ownerDeviceId: 'd-peer',
      deviceId: 'd-peer',
      chunkIds: ['c1', 'c2'],
      scopes: ['public']
    })
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(invalidated).toHaveLength(1)
    expect(invalidated[0].deviceId).toBe('d-peer')
    expect(invalidated[0].chunkIds).toEqual(['c1', 'c2'])
    expect(invalidated[0].scopes).toEqual(['public'])

    await client.close()
    await handle!.shutdown()
  })

  it('routes memory/invalidated with whole-device fallback when no chunkIds/scopes', async () => {
    const invalidated: Array<{ deviceId: string; chunkIds?: string[]; scopes?: string[] }> = []
    const config = MeshConfig.parse({ enabled: true })
    const d = await deps()
    d.onMemoryInvalidated = (deviceId, opts) => invalidated.push({ deviceId, ...opts })

    const handle = await bootMesh(config, d)
    const client = new MeshTransportClient()
    await client.connect(`ws://127.0.0.1:${handle!.transportPort}`)
    await new Promise((resolve) => setTimeout(resolve, 100))

    client.notify('memory/invalidated', { deviceId: 'd-peer' })
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(invalidated).toHaveLength(1)
    expect(invalidated[0].deviceId).toBe('d-peer')
    expect(invalidated[0].chunkIds).toBeUndefined()
    expect(invalidated[0].scopes).toBeUndefined()

    await client.close()
    await handle!.shutdown()
  })
})
