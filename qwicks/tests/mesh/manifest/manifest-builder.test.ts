import { describe, it, expect } from 'vitest'
import { buildManifest, ManifestStore, type ToolInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import { Manifest } from '@qwicks/mesh/contracts.js'
import type { DeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tools: ToolInput[] = [
  { name: 'fs.read', description: 'read', version: '1.0.0', riskLevel: 'none', readonly: true, discoverable: true, sides: ['worker'] },
  { name: 'fs.write', description: 'write', version: '1.0.0', riskLevel: 'high', readonly: false, discoverable: true, sides: ['worker'] },
  { name: 'secret.local', description: 'secret', version: '1.0.0', riskLevel: 'critical', readonly: true, discoverable: false, sides: ['worker'] }
]
const models = [
  { id: 'qwen2.5-7b', provider: 'local' as const, contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
]

async function identity(): Promise<DeviceIdentity> {
  return loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), 'man-')))
}

describe('buildManifest (RFC 005 §3)', () => {
  it('produces a valid manifest carrying device identity and models', async () => {
    const id = await identity()
    const manifest = buildManifest({
      identity: id,
      deviceName: 'gpu-host',
      models,
      tools,
      computeProfile: { canRunLocalModels: true, cpuCores: 8, ramGb: 32, maxModelParamsB: 14 }
    })
    // Round-trips through the strict zod schema.
    expect(() => Manifest.parse(manifest)).not.toThrow()
    expect(manifest.deviceId).toBe(id.deviceId)
    expect(manifest.deviceName).toBe('gpu-host')
    expect(manifest.protocolVersion).toBe('1')
    expect(manifest.models).toHaveLength(1)
  })

  it('drops non-discoverable tools from the advertised set', async () => {
    const id = await identity()
    const manifest = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false } })
    const names = manifest.tools.map((t) => t.name)
    expect(names).toContain('fs.read')
    expect(names).toContain('fs.write')
    expect(names).not.toContain('secret.local')
  })

  it('assigns requiresUserConfirm from risk level (high/critical forced true)', async () => {
    const id = await identity()
    const manifest = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false } })
    const byName = Object.fromEntries(manifest.tools.map((t) => [t.name, t]))
    expect(byName['fs.read'].requiresUserConfirm).toBe(false)
    expect(byName['fs.write'].requiresUserConfirm).toBe(true)
  })

  it('bumps manifestVersion monotonically when provided', async () => {
    const id = await identity()
    const m1 = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false } })
    const m2 = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false }, manifestVersion: m1.manifestVersion + 1 })
    expect(m2.manifestVersion).toBe(m1.manifestVersion + 1)
  })
})

describe('ManifestStore (RFC 005 §6)', () => {
  it('caches, retrieves, and invalidates peer manifests', async () => {
    const id = await identity()
    const store = new ManifestStore()
    const manifest = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false } })
    store.set(manifest)
    expect(store.get(id.deviceId)?.manifestVersion).toBe(manifest.manifestVersion)
    store.invalidate(id.deviceId)
    expect(store.get(id.deviceId)).toBeUndefined()
  })

  it('replaces an older manifest with a newer version', async () => {
    const id = await identity()
    const store = new ManifestStore()
    const v1 = buildManifest({ identity: id, deviceName: 'h', models, tools, computeProfile: { canRunLocalModels: false }, manifestVersion: 1 })
    const v2 = buildManifest({ identity: id, deviceName: 'h-renamed', models, tools, computeProfile: { canRunLocalModels: false }, manifestVersion: 2 })
    store.set(v1)
    store.set(v2)
    expect(store.get(id.deviceId)?.deviceName).toBe('h-renamed')
    expect(store.get(id.deviceId)?.manifestVersion).toBe(2)
  })
})
