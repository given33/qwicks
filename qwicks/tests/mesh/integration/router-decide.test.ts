import { describe, it, expect } from 'vitest'
import { buildMeshAwareDecide } from '@qwicks/mesh/integration/router-decide.js'
import { ManifestStore, buildManifest, type ModelInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const qwen: ModelInput = { id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
const deepseek: ModelInput = { id: 'deepseek-r1-14b', provider: 'local', contextWindow: 65536, maxOutput: 16384, supportsTools: true, supportsVision: false, available: true, version: '14b' }

async function peerWith(deviceName: string, models: ModelInput[], store: ManifestStore) {
  const id = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), `rd-${deviceName}-`)))
  store.set(buildManifest({ identity: id, deviceName, models, tools: [], computeProfile: { canRunLocalModels: true, maxModelParamsB: 14 } }))
  return id
}

describe('buildMeshAwareDecide (RFC 008 §4.3 → seam)', () => {
  it('routes to the peer that hosts the requested model', async () => {
    const store = new ManifestStore()
    const gpu = await peerWith('gpu', [deepseek], store)
    await peerWith('lite', [qwen], store)
    const decide = buildMeshAwareDecide({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-a' })
    const d = decide({ childId: 'c', prompt: 'p', model: 'deepseek-r1-14b' })
    expect(d.executor).toBe('remote')
    expect(d.workerDeviceId).toBe(gpu.deviceId)
  })

  it('falls back to local when no peer has the model', async () => {
    const store = new ManifestStore()
    await peerWith('lite', [qwen], store)
    const decide = buildMeshAwareDecide({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-a' })
    const d = decide({ childId: 'c', prompt: 'p', model: 'gpt-4o' })
    expect(d.executor).toBe('local')
  })

  it('falls back to local when no peers are known', () => {
    const store = new ManifestStore()
    const decide = buildMeshAwareDecide({ manifestStore: store, getLoad: () => 0, selfDeviceId: 'd-a' })
    expect(decide({ childId: 'c', prompt: 'p' }).executor).toBe('local')
  })

  it('respects live load (picks the idle peer)', async () => {
    const store = new ManifestStore()
    const busy = await peerWith('busy', [qwen], store)
    const idle = await peerWith('idle', [qwen], store)
    const decide = buildMeshAwareDecide({
      manifestStore: store,
      getLoad: (deviceId) => (deviceId === busy.deviceId ? 2 : 0),
      selfDeviceId: 'd-a'
    })
    const d = decide({ childId: 'c', prompt: 'p' })
    expect(d.workerDeviceId).toBe(idle.deviceId)
  })
})
