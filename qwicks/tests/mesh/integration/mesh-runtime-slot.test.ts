import { describe, it, expect, vi } from 'vitest'
import { createMeshRuntimeSlot } from '@qwicks/mesh/integration/mesh-runtime-slot.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'

const input = { childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit' as const, signal: new AbortController().signal }
type Result = Awaited<ReturnType<ChildRunExecutor>>
const makeLocal = () => vi.fn(async (): Promise<Result> => ({ summary: 'local', toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 })) as unknown as ChildRunExecutor
const makeRemote = () => vi.fn(async (): Promise<Result> => ({ summary: 'remote', toolInvocations: 0, prefixReused: true, inheritedHistoryItems: 0 })) as unknown as ChildRunExecutor

describe('createMeshRuntimeSlot (async-boot-safe DelegationRuntime seam)', () => {
  it('acts as pure-local before mesh is installed (byte-identical to the original executor)', async () => {
    const local = makeLocal()
    const { executor } = createMeshRuntimeSlot(local)
    const r = await executor(input)
    expect(r.summary).toBe('local')
    expect(local).toHaveBeenCalledTimes(1)
  })

  it('routes to remote once install() provides a remote executor + decide=remote', async () => {
    const local = makeLocal()
    const remote = makeRemote()
    const { executor, slot } = createMeshRuntimeSlot(local)
    slot.install({ remoteExecutor: remote, decide: () => ({ executor: 'remote', workerDeviceId: 'd-bbb' }) })
    const r = await executor(input)
    expect(r.summary).toBe('remote')
    expect(remote).toHaveBeenCalledTimes(1)
    expect(local).not.toHaveBeenCalled()
  })

  it('still routes to local when decide says local after install', async () => {
    const local = makeLocal()
    const remote = makeRemote()
    const { executor, slot } = createMeshRuntimeSlot(local)
    slot.install({ remoteExecutor: remote, decide: () => ({ executor: 'local' }) })
    const r = await executor(input)
    expect(r.summary).toBe('local')
    expect(remote).not.toHaveBeenCalled()
  })

  it('reverts to pure-local after clear()', async () => {
    const local = makeLocal()
    const remote = makeRemote()
    const { executor, slot } = createMeshRuntimeSlot(local)
    slot.install({ remoteExecutor: remote, decide: () => ({ executor: 'remote' }) })
    await executor(input)         // routes to remote — local not called yet
    slot.clear()
    await executor(input)         // cleared → pure-local passthrough
    expect(local).toHaveBeenCalledTimes(1)  // only the post-clear call
  })
})
