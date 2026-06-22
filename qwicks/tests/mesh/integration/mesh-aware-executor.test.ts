import { describe, it, expect, vi } from 'vitest'
import { createMeshAwareExecutor } from '@qwicks/mesh/integration/mesh-aware-executor.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'

const input = {
  childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit' as const, signal: new AbortController().signal
}

function mkExec(summary: string): ChildRunExecutor {
  return vi.fn(async () => ({ summary, toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 })) as unknown as ChildRunExecutor
}

describe('createMeshAwareExecutor (DelegationRuntime seam, RFC 008 §9)', () => {
  it('delegates to the local executor when the router says local', async () => {
    const local = mkExec('ran-local')
    const remote = mkExec('ran-remote')
    const exec = createMeshAwareExecutor({
      localExecutor: local,
      remoteExecutor: remote,
      decide: () => ({ executor: 'local' })
    })
    const result = await exec(input)
    expect(result.summary).toBe('ran-local')
    expect(local).toHaveBeenCalledTimes(1)
    expect(remote).not.toHaveBeenCalled()
  })

  it('delegates to the remote executor when the router says remote', async () => {
    const local = mkExec('ran-local')
    const remote = mkExec('ran-remote')
    const exec = createMeshAwareExecutor({
      localExecutor: local,
      remoteExecutor: remote,
      decide: () => ({ executor: 'remote', workerDeviceId: 'd-bbb' })
    })
    const result = await exec(input)
    expect(result.summary).toBe('ran-remote')
    expect(remote).toHaveBeenCalledTimes(1)
    expect(local).not.toHaveBeenCalled()
  })

  it('passes the full input through unchanged', async () => {
    const local = vi.fn(async () => ({ summary: 'ok', toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 })) as unknown as ChildRunExecutor
    const exec = createMeshAwareExecutor({
      localExecutor: local,
      remoteExecutor: mkExec('r'),
      decide: () => ({ executor: 'local' })
    })
    const withModel = { ...input, model: 'qwen2.5-7b', label: 'research' }
    await exec(withModel)
    expect(local).toHaveBeenCalledWith(expect.objectContaining({ childId: 'c', model: 'qwen2.5-7b', label: 'research' }))
  })
})
