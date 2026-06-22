import { describe, it, expect } from 'vitest'
import { selectExecutor, type WorkerCandidate, type RoutingInput } from '@qwicks/mesh/roles/mesh-router.js'
import { buildManifest, type ToolInput, type ModelInput } from '@qwicks/mesh/manifest/manifest-builder.js'
import { loadOrCreateDeviceIdentity } from '@qwicks/mesh/identity/device-identity.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function cand(
  deviceName: string,
  over: { models?: ModelInput[]; tools?: ToolInput[]; inflight?: number; maxConcurrent?: number; maxModelParamsB?: number; gpu?: boolean }
): Promise<WorkerCandidate> {
  const id = await loadOrCreateDeviceIdentity(mkdtempSync(join(tmpdir(), `r-${deviceName}-`)))
  const manifest = buildManifest({
    identity: id,
    deviceName,
    models: over.models ?? [],
    tools: over.tools ?? [],
    computeProfile: {
      canRunLocalModels: true,
      ...(over.maxModelParamsB ? { maxModelParamsB: over.maxModelParamsB } : {}),
      ...(over.gpu ? { gpu: { name: 'x', vramGb: 24, computeCapability: '8.9' } } : {})
    }
  })
  return { deviceId: id.deviceId, manifest, inflightTasks: over.inflight ?? 0, maxConcurrent: over.maxConcurrent ?? 2 }
}

const qwen: ModelInput = { id: 'qwen2.5-7b', provider: 'local', contextWindow: 32768, maxOutput: 8192, supportsTools: true, supportsVision: false, available: true, version: '7b' }
const deepseek: ModelInput = { id: 'deepseek-r1-14b', provider: 'local', contextWindow: 65536, maxOutput: 16384, supportsTools: true, supportsVision: false, available: true, version: '14b' }
const readTool: ToolInput = { name: 'fs.read', description: 'r', version: '1', riskLevel: 'none', readonly: true, discoverable: true, sides: ['worker'] }

describe('MeshRouter.selectExecutor (RFC 008 §4)', () => {
  it('falls back to local when no remote candidates exist', () => {
    const input: RoutingInput = { selfDeviceId: 'd-a', candidates: [] }
    const decision = selectExecutor(input)
    expect(decision.executor).toBe('local')
    expect(decision.reason).toContain('fallback')
  })

  it('selects the only candidate with the requested model', async () => {
    const gpu = await cand('gpu', { models: [deepseek], maxModelParamsB: 14, gpu: true })
    const lite = await cand('lite', { models: [qwen], maxModelParamsB: 7 })
    const decision = selectExecutor({ selfDeviceId: 'd-a', candidates: [gpu, lite], model: 'deepseek-r1-14b' })
    expect(decision.executor).toBe('remote')
    expect(decision.workerDeviceId).toBe(gpu.deviceId)
    expect(decision.model).toBe('deepseek-r1-14b')
  })

  it('falls back to local when no candidate has the requested model', async () => {
    const lite = await cand('lite', { models: [qwen] })
    const decision = selectExecutor({ selfDeviceId: 'd-a', candidates: [lite], model: 'gpt-4o' })
    expect(decision.executor).toBe('local')
  })

  it('filters out candidates missing a required tool', async () => {
    const withTool = await cand('b', { models: [qwen], tools: [readTool] })
    const noTool = await cand('c', { models: [qwen] })
    const decision = selectExecutor({ selfDeviceId: 'd-a', candidates: [noTool, withTool], requiredTools: ['fs.read'] })
    expect(decision.workerDeviceId).toBe(withTool.deviceId)
  })

  it('load-balances to the least-busy eligible candidate', async () => {
    const busy = await cand('busy', { models: [qwen], inflight: 2, maxConcurrent: 3 })
    const idle = await cand('idle', { models: [qwen], inflight: 0, maxConcurrent: 3 })
    const decision = selectExecutor({ selfDeviceId: 'd-a', candidates: [busy, idle] })
    expect(decision.workerDeviceId).toBe(idle.deviceId)
    expect(decision.reason).toContain('load_balanced')
  })

  it('prefers a higher-compute worker for planning tasks', async () => {
    const lite = await cand('lite', { models: [qwen], maxModelParamsB: 7 })
    const gpu = await cand('gpu', { models: [qwen], maxModelParamsB: 14, gpu: true })
    const decision = selectExecutor({ selfDeviceId: 'd-a', candidates: [lite, gpu], taskCapabilityTags: ['planning'] })
    expect(decision.workerDeviceId).toBe(gpu.deviceId)
    expect(decision.reason).toContain('compute_preferred')
  })
})
