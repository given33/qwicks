import { describe, it, expect, vi } from 'vitest'
import { RemoteToolHost } from '@qwicks/mesh/remote-tool/remote-tool-host.js'
import { ManifestStore, buildManifest } from '@qwicks/mesh/manifest/manifest-builder.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolResult } from '@qwicks/mesh/contracts.js'

async function peerManifest(deviceName: string, tools: { name: string; discoverable: boolean }[]) {
  const id = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), `m-${deviceName}-`)))
  const manifest = buildManifest({
    identity: id,
    deviceName,
    models: [],
    tools: tools.map((t) => ({ name: t.name, description: t.name, version: '1.0.0', riskLevel: 'none' as const, readonly: true, discoverable: t.discoverable, sides: ['worker'] as const })),
    computeProfile: { canRunLocalModels: false }
  })
  return { id, manifest }
}

describe('RemoteToolHost (RFC 003 §4.1, §5)', () => {
  it('routes a call to the peer that owns the tool', async () => {
    const store = new ManifestStore()
    const { id: bId, manifest: bManifest } = await peerManifest('gpu-host', [{ name: 'fs.read', discoverable: true }])
    store.set(bManifest)
    const call = vi.fn(async () => ({ callId: 'c', status: 'success', output: 'from-B' } satisfies ToolResult))
    const host = new RemoteToolHost(store, { call } as never)

    const result = await host.callPeerTool('fs.read', { path: '/x' })
    expect(result.status).toBe('success')
    expect(result.output).toBe('from-B')
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ ownerDeviceId: bId.deviceId, name: 'fs.read' }))
  })

  it('prefers an explicitly named owner when given', async () => {
    const store = new ManifestStore()
    const { id: bId, manifest: bManifest } = await peerManifest('b', [{ name: 'fs.read', discoverable: true }])
    const { manifest: cManifest } = await peerManifest('c', [{ name: 'fs.read', discoverable: true }])
    store.set(bManifest)
    store.set(cManifest)
    const call = vi.fn(async () => ({ callId: 'c', status: 'success', output: 'from-C' } satisfies ToolResult))
    const host = new RemoteToolHost(store, { call } as never)

    await host.callPeerTool('fs.read', {}, { ownerDeviceId: cManifest.deviceId })
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ ownerDeviceId: cManifest.deviceId }))
    expect(bId.deviceId).not.toBe(cManifest.deviceId)
  })

  it('lists discoverable tools across all known peers', async () => {
    const store = new ManifestStore()
    const { manifest: bManifest } = await peerManifest('b', [{ name: 'fs.read', discoverable: true }, { name: 'secret', discoverable: false }])
    const { manifest: cManifest } = await peerManifest('c', [{ name: 'fs.write', discoverable: true }])
    store.set(bManifest)
    store.set(cManifest)
    const host = new RemoteToolHost(store, { call: vi.fn() } as never)
    const names = host.listPeerTools().map((t) => t.name).sort()
    expect(names).toEqual(['fs.read', 'fs.write'])
  })

  it('rejects a call for a tool no peer exposes', async () => {
    const store = new ManifestStore()
    const host = new RemoteToolHost(store, { call: vi.fn() } as never)
    await expect(host.callPeerTool('nonexistent', {})).rejects.toThrow(/no peer exposes/)
  })
})
