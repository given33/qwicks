import { describe, it, expect } from 'vitest'
import { createPeerModelRegistry } from '@qwicks/mesh/roles/peer-model-registry.js'
import { ManifestStore, buildManifest, type ModelInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const qwen: ModelInput = { id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
const vision: ModelInput = { id: 'llava-13b', provider: 'local', contextWindow: 4096, maxOutput: 2048, supportsTools: false, supportsVision: true, available: true, version: '13b' }
const offline: ModelInput = { id: 'gpt-oss-120b', provider: 'local', contextWindow: 8192, maxOutput: 4096, supportsTools: true, supportsVision: false, available: false, version: '120b' }

async function addPeer(store: ManifestStore, deviceName: string, models: ModelInput[]) {
  const id = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), `pmr-${deviceName}-`)))
  store.set(buildManifest({ identity: id, deviceName, models, tools: [], computeProfile: { canRunLocalModels: true } }))
  return id
}

describe('PeerModelRegistry (RFC 008 §5)', () => {
  it('returns an empty list when no peers are known', () => {
    const store = new ManifestStore()
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    expect(registry.listModels()).toHaveLength(0)
  })

  it('collects models from all peers', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'gpu-a', [qwen])
    await addPeer(store, 'gpu-b', [vision])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    const models = registry.listModels()
    expect(models).toHaveLength(2)
    const ids = models.map((m) => m.id).sort()
    expect(ids).toEqual(['llava-13b', 'qwen2.5-7b'])
  })

  it('excludes the local device (self) from the registry', async () => {
    const store = new ManifestStore()
    const self = await addPeer(store, 'self', [qwen])
    await addPeer(store, 'peer', [vision])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: self.deviceId })
    const models = registry.listModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('llava-13b')
  })

  it('sorts available models before unavailable ones', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'a', [offline])
    await addPeer(store, 'b', [qwen])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    const models = registry.listModels()
    expect(models[0].available).toBe(true)
    expect(models[0].id).toBe('qwen2.5-7b')
    expect(models[1].available).toBe(false)
  })

  it('sorts by lowest host load when availability is equal', async () => {
    const store = new ManifestStore()
    const busy = await addPeer(store, 'busy', [qwen])
    const idle = await addPeer(store, 'idle', [qwen])
    const loads: Record<string, number> = { [busy.deviceId]: 5, [idle.deviceId]: 0 }
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: (d) => loads[d] ?? 0, selfDeviceId: 'd-self' })
    const models = registry.listModels()
    expect(models[0].hostDeviceName).toBe('idle')
    expect(models[1].hostDeviceName).toBe('busy')
  })

  it('annotates each model with host metadata', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'gpu-host', [qwen])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 3, selfDeviceId: 'd-self' })
    const m = registry.listModels()[0]
    expect(m.hostDeviceName).toBe('gpu-host')
    expect(m.hostInflightTasks).toBe(3)
    expect(m.contextWindow).toBe(32768)
    expect(m.supportsTools).toBe(true)
    expect(m.version).toBe('7b')
  })

  it('deduplicates models hosted on the same device', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'multi', [qwen, qwen, qwen])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    expect(registry.listModels()).toHaveLength(1)
  })

  it('findModels filters by provider', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'a', [qwen])
    await addPeer(store, 'b', [vision])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    const local = registry.findModels({ provider: 'local' })
    expect(local).toHaveLength(2)
  })

  it('findModels filters by device', async () => {
    const store = new ManifestStore()
    const a = await addPeer(store, 'hostA', [qwen])
    await addPeer(store, 'hostB', [vision])
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    const onA = registry.findModels({ deviceId: a.deviceId })
    expect(onA).toHaveLength(1)
    expect(onA[0].id).toBe('qwen2.5-7b')
  })

  it('findModels filters by tool support', async () => {
    const store = new ManifestStore()
    await addPeer(store, 'a', [qwen]) // supportsTools true
    await addPeer(store, 'b', [vision]) // supportsTools false
    const registry = createPeerModelRegistry({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-self' })
    const withTools = registry.findModels({ supportsTools: true })
    expect(withTools).toHaveLength(1)
    expect(withTools[0].id).toBe('qwen2.5-7b')
  })
})
