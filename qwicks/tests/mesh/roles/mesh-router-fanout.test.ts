import { describe, it, expect } from 'vitest'
import { selectFanOut, type WorkerCandidate, type RoutingInput } from '@qwicks/mesh/roles/mesh-router.js'
import { buildManifest, type ToolInput, type ModelInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function cand(
  deviceName: string,
  over: { models?: ModelInput[]; tools?: ToolInput[]; inflight?: number; maxConcurrent?: number }
): Promise<WorkerCandidate> {
  const id = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), `fo-${deviceName}-`)))
  const manifest = buildManifest({
    identity: id,
    deviceName,
    models: over.models ?? [],
    tools: over.tools ?? [],
    computeProfile: { canRunLocalModels: true }
  })
  return { deviceId: id.deviceId, manifest, inflightTasks: over.inflight ?? 0, maxConcurrent: over.maxConcurrent ?? 2 }
}

const qwen: ModelInput = { id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
const readTool: ToolInput = { name: 'fs.read', description: 'r', version: '1', riskLevel: 'none', readonly: true, discoverable: true, sides: ['worker'] }

describe('MeshRouter.selectFanOut (RFC 008 §4.2)', () => {
  it('falls back to local when no candidates exist', () => {
    const input: RoutingInput = { selfDeviceId: 'd-a', candidates: [] }
    const decision = selectFanOut(input)
    expect(decision.executor).toBe('local')
    expect(decision.workers).toHaveLength(0)
  })

  it('returns every eligible candidate for parallel dispatch', async () => {
    const a = await cand('a', { models: [qwen], inflight: 0, maxConcurrent: 2 })
    const b = await cand('b', { models: [qwen], inflight: 0, maxConcurrent: 2 })
    const c = await cand('c', { models: [qwen], inflight: 0, maxConcurrent: 2 })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [a, b, c] })
    expect(decision.executor).toBe('remote')
    expect(decision.workers).toHaveLength(3)
    expect(decision.reason).toContain('fan_out:3_workers')
  })

  it('filters out candidates missing the requested model', async () => {
    const withModel = await cand('wm', { models: [qwen] })
    const noModel = await cand('nm', { models: [] })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [withModel, noModel], model: 'qwen2.5-7b' })
    expect(decision.executor).toBe('remote')
    expect(decision.workers.map((w) => w.deviceId)).toEqual([withModel.deviceId])
  })

  it('falls back to local when no candidate has the requested model', async () => {
    const noModel = await cand('nm', { models: [] })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [noModel], model: 'gpt-4o' })
    expect(decision.executor).toBe('local')
  })

  it('filters out candidates missing a required tool', async () => {
    const withTool = await cand('wt', { models: [qwen], tools: [readTool] })
    const noTool = await cand('nt', { models: [qwen] })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [noTool, withTool], requiredTools: ['fs.read'] })
    expect(decision.workers.map((w) => w.deviceId)).toEqual([withTool.deviceId])
  })

  it('filters out candidates at capacity', async () => {
    const full = await cand('full', { models: [qwen], inflight: 2, maxConcurrent: 2 })
    const idle = await cand('idle', { models: [qwen], inflight: 0, maxConcurrent: 2 })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [full, idle] })
    expect(decision.workers.map((w) => w.deviceId)).toEqual([idle.deviceId])
  })

  it('falls back to local when all candidates are at capacity', async () => {
    const full = await cand('full', { models: [qwen], inflight: 2, maxConcurrent: 2 })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [full] })
    expect(decision.executor).toBe('local')
    expect(decision.reason).toContain('no_capacity')
  })

  it('sorts workers by load (least busy first)', async () => {
    const busy = await cand('busy', { models: [qwen], inflight: 3, maxConcurrent: 5 })
    const mid = await cand('mid', { models: [qwen], inflight: 1, maxConcurrent: 5 })
    const idle = await cand('idle', { models: [qwen], inflight: 0, maxConcurrent: 5 })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [busy, mid, idle] })
    expect(decision.workers.map((w) => w.deviceId)).toEqual([idle.deviceId, mid.deviceId, busy.deviceId])
  })

  it('propagates the requested model into worker entries', async () => {
    const a = await cand('a', { models: [qwen] })
    const decision = selectFanOut({ selfDeviceId: 'd-a', candidates: [a], model: 'qwen2.5-7b' })
    expect(decision.workers[0].model).toBe('qwen2.5-7b')
  })
})
