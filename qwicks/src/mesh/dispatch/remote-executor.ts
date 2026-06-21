import { randomUUID } from 'node:crypto'
import type { ChildRunExecutor } from '../../delegation/delegation-runtime.js'
import type { TaskRunParams, ChildRunResult, ProgressEvent } from '../contracts.js'

/**
 * Remote executor — the seam that makes a cross-device Task look like a local
 * `DelegationRuntime` child (RFC 002 §3).
 *
 * `DelegationRuntime.runChild` calls `this.options.executor(input)`. The local
 * executor runs an AgentLoop in-process; this one marshals the same input into a
 * `TaskRunParams` wire payload, ships it to a peer via the injected `runRemote`,
 * and unpacks the returned `ChildRunResult` back into the executor-result
 * shape `DelegationRuntime` expects. The runtime's budgets, state machine and
 * telemetry are unchanged.
 *
 * On abort, the remote run is cancelled via `cancelRemote` so the worker stops
 * promptly instead of running to lease expiry.
 */

export interface RemoteExecutorDeps {
  selfDeviceId: string
  /** Send task/run to the chosen peer; resolve with the peer's result. */
  runRemote: (params: TaskRunParams, signal: AbortSignal) => Promise<ChildRunResult>
  /** Send task/cancel to the peer when the local abort signal fires. */
  cancelRemote?: (taskId: string, cancelToken: string) => Promise<void>
  /** Live progress notifications from the peer (turned into local runtime events). */
  onProgress?: (event: ProgressEvent) => void
  lease?: { leaseTimeout: number; heartbeatInterval: number }
  maxRetries?: number
  provenanceMaxDepth?: number
}

const DEFAULT_LEASE = { leaseTimeout: 300, heartbeatInterval: 75 }

export function createRemoteChildExecutor(deps: RemoteExecutorDeps): ChildRunExecutor {
  return async (input) => {
    const lease = deps.lease ?? DEFAULT_LEASE
    const maxRetries = deps.maxRetries ?? 2
    const params: TaskRunParams = {
      taskId: input.childId,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      ...(input.label ? { label: input.label } : {}),
      prompt: input.prompt,
      ...(input.promptPreamble ? { promptPreamble: input.promptPreamble } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.model ? { model: input.model } : {}),
      toolPolicy: input.toolPolicy,
      lease,
      idempotencyKey: `${input.childId}@0$${randomUUID()}`,
      retryCount: 0,
      maxRetries,
      cancelToken: randomUUID(),
      provenance: [deps.selfDeviceId],
      disableUserInput: true
    }

    const onAbort = () => {
      void deps.cancelRemote?.(params.taskId, params.cancelToken)
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })

    let result: ChildRunResult
    try {
      result = await deps.runRemote(params, input.signal)
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }

    // Surface any progress the peer stashed on the result (Phase 1 hook).
    // (The transport layer streams progress separately; this is a fallback.)

    if (result.status !== 'completed') {
      throw new Error(result.error ?? `remote task ${result.status}`)
    }

    return {
      summary: result.summary,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.toolInvocations !== undefined ? { toolInvocations: result.toolInvocations } : {}),
      ...(result.prefixReused !== undefined ? { prefixReused: result.prefixReused } : {}),
      ...(result.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: result.inheritedHistoryItems } : {})
    }
  }
}

// onProgress is wired through deps; keep the import live for the type even when
// the transport layer isn't pushing events yet in Phase 1.
export type { ProgressEvent } from '../contracts.js'
