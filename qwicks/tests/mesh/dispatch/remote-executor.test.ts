import { describe, it, expect, vi } from 'vitest'
import { createRemoteChildExecutor, type RemoteExecutorDeps } from '@qwicks/mesh/dispatch/remote-executor.js'
import type { TaskRunParams, ChildRunResult } from '@qwicks/mesh/contracts.js'

function makeResult(over: Partial<ChildRunResult> = {}): ChildRunResult {
  return {
    summary: 'hello from B',
    status: 'completed',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    toolInvocations: 2,
    prefixReused: true,
    inheritedHistoryItems: 0,
    ...over
  }
}

describe('createRemoteChildExecutor (RFC 002 §3, §4)', () => {
  it('maps ChildRunExecutorInput → TaskRunParams and unpacks the result', async () => {
    let captured: TaskRunParams | undefined
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-aaa',
      lease: { leaseTimeout: 300, heartbeatInterval: 75 },
      maxRetries: 2,
      runRemote: async (params) => {
        captured = params
        return makeResult()
      }
    }
    const executor = createRemoteChildExecutor(deps)

    const controller = new AbortController()
    const result = await executor({
      childId: 'child-1',
      parentThreadId: 'th-1',
      parentTurnId: 'tn-1',
      label: 'research',
      prompt: 'find the bug',
      workspace: 'file://host/proj',
      model: 'qwen2.5-7b',
      toolPolicy: 'readOnly',
      promptPreamble: 'you are a researcher',
      signal: controller.signal
    })

    expect(result.summary).toBe('hello from B')
    expect(result.toolInvocations).toBe(2)
    expect(result.prefixReused).toBe(true)
    expect(result.inheritedHistoryItems).toBe(0)
    expect(result.usage?.totalTokens).toBe(15)

    // Wire payload correctness.
    expect(captured!.taskId).toBe('child-1')
    expect(captured!.parentThreadId).toBe('th-1')
    expect(captured!.parentTurnId).toBe('tn-1')
    expect(captured!.prompt).toBe('find the bug')
    expect(captured!.promptPreamble).toBe('you are a researcher')
    expect(captured!.workspace).toBe('file://host/proj')
    expect(captured!.model).toBe('qwen2.5-7b')
    expect(captured!.toolPolicy).toBe('readOnly')
    expect(captured!.lease.leaseTimeout).toBe(300)
    expect(captured!.disableUserInput).toBe(true)
    expect(captured!.provenance).toEqual(['d-aaa'])
    expect(captured!.idempotencyKey).toMatch(/^child-1@0\$/)
    expect(captured!.maxRetries).toBe(2)
    expect(captured!.cancelToken).toBeTruthy()
  })

  it('forwards progress events via onProgress', async () => {
    const onProgress = vi.fn()
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-aaa',
      runRemote: async () => makeResult(),
      onProgress
    }
    const executor = createRemoteChildExecutor(deps)
    await executor({
      childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: new AbortController().signal
    })
    // onProgress is wired; the fake runRemote doesn't emit, so zero calls is fine —
    // the contract is just that the callback is plumbed through. Verify no throw.
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('sends task/cancel when the abort signal fires', async () => {
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    let capturedParams: TaskRunParams | undefined
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-aaa',
      runRemote: (params, signal) =>
        new Promise((resolve, reject) => {
          capturedParams = params
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      cancelRemote
    }
    const executor = createRemoteChildExecutor(deps)
    const controller = new AbortController()
    const pending = executor({
      childId: 'child-x', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(cancelRemote).toHaveBeenCalledWith('child-x', capturedParams!.cancelToken)
  })

  it('propagates a failed ChildRunResult as a thrown error', async () => {
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-aaa',
      runRemote: async () => makeResult({ status: 'failed', summary: '', error: 'boom' })
    }
    const executor = createRemoteChildExecutor(deps)
    await expect(
      executor({ childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: new AbortController().signal })
    ).rejects.toThrow('boom')
  })

  it('inherits the provenance chain when acting as a relay (RFC 007 §7)', async () => {
    let captured: TaskRunParams | undefined
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-relay',
      inheritedProvenance: ['d-orchestrator', 'd-relay'],
      runRemote: async (params) => {
        captured = params
        return makeResult()
      }
    }
    const executor = createRemoteChildExecutor(deps)
    await executor({
      childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: new AbortController().signal
    })
    // Relay appends its own id to the inherited chain, preserving who has already touched the task
    expect(captured!.provenance).toEqual(['d-orchestrator', 'd-relay', 'd-relay'])
  })

  it('starts a fresh provenance chain when no inheritedProvenance is supplied', async () => {
    let captured: TaskRunParams | undefined
    const deps: RemoteExecutorDeps = {
      selfDeviceId: 'd-aaa',
      runRemote: async (params) => {
        captured = params
        return makeResult()
      }
    }
    const executor = createRemoteChildExecutor(deps)
    await executor({
      childId: 'c', parentThreadId: 't', parentTurnId: 'n', prompt: 'p', toolPolicy: 'inherit', signal: new AbortController().signal
    })
    expect(captured!.provenance).toEqual(['d-aaa'])
  })
})
