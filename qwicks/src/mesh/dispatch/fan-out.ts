import { randomUUID } from 'node:crypto'
import type { ChildRunExecutor } from '../../delegation/delegation-runtime.js'
import type { TaskRunParams, ChildRunResult } from '../contracts.js'

/**
 * Fan-out dispatcher (RFC 008 §4.2).
 *
 * Dispatches the same task to multiple remote workers in parallel and
 * aggregates their results. Each worker receives identical parameters
 * (with a per-worker idempotency key) and runs independently.
 *
 * By default the first completed result is returned ("race" mode) — useful
 * for speculative execution. Callers can switch to "all" mode to collect
 * every result and merge them (e.g. for distributed search).
 */

export type FanOutMode = 'race' | 'all'

export interface FanOutDispatcherDeps {
  selfDeviceId: string
  /** Send task/run to a specific peer. */
  runRemote: (params: TaskRunParams, signal: AbortSignal) => Promise<ChildRunResult>
  /** Cancel a remote task. */
  cancelRemote?: (taskId: string, cancelToken: string) => Promise<void>
  lease?: { leaseTimeout: number; heartbeatInterval: number }
  maxRetries?: number
}

export interface FanOutParams {
  taskId: string
  parentThreadId: string
  parentTurnId: string
  prompt: string
  model?: string
  label?: string
  workspace?: string
  toolPolicy?: 'readOnly' | 'inherit'
  workers: { deviceId: string; model?: string }[]
  mode?: FanOutMode
  signal: AbortSignal
}

export interface FanOutResult {
  /** Aggregated results, one per worker that responded. */
  results: ChildRunResult[]
  /** Which mode was used. */
  mode: FanOutMode
  /** Whether all workers responded. */
  complete: boolean
}

const DEFAULT_LEASE = { leaseTimeout: 300, heartbeatInterval: 75 }

export function createFanOutDispatcher(deps: FanOutDispatcherDeps) {
  const lease = deps.lease ?? DEFAULT_LEASE
  const maxRetries = deps.maxRetries ?? 2

  return async function dispatchFanOut(params: FanOutParams): Promise<FanOutResult> {
    const mode = params.mode ?? 'race'
    const cancelToken = randomUUID()

    const workerTasks = params.workers.map((worker, index) => {
      const taskParams: TaskRunParams = {
        taskId: `${params.taskId}-fanout-${index}`,
        parentThreadId: params.parentThreadId,
        parentTurnId: params.parentTurnId,
        ...(params.label ? { label: params.label } : {}),
        prompt: params.prompt,
        ...(params.workspace ? { workspace: params.workspace } : {}),
        ...(worker.model ? { model: worker.model } : {}),
        ...(params.toolPolicy ? { toolPolicy: params.toolPolicy } : {}),
        lease,
        idempotencyKey: `${params.taskId}@fanout-${index}$${randomUUID()}`,
        retryCount: 0,
        maxRetries,
        cancelToken,
        provenance: [deps.selfDeviceId],
        disableUserInput: true
      }

      return deps.runRemote(taskParams, params.signal)
        .then((result) => ({ index, result, error: undefined }))
        .catch((error) => ({ index, result: undefined, error }))
    })

    if (mode === 'race') {
      // Return the first successful result; cancel remaining workers
      const winner = await Promise.race(
        workerTasks.map((p, i) =>
          p.then((r) => {
            if (r.result?.status === 'completed') {
              // Cancel other workers
              for (let j = 0; j < params.workers.length; j++) {
                if (j !== i) {
                  void deps.cancelRemote?.(`${params.taskId}-fanout-${j}`, cancelToken)
                }
              }
            }
            return r
          })
        )
      )

      if (winner.result && winner.result.status === 'completed') {
        return { results: [winner.result], mode: 'race', complete: false }
      }
      // First result was an error — wait for all and return what we have
    }

    // Fallback "all" mode or race-with-error case: collect all
    const settled = await Promise.all(workerTasks)
    const results: ChildRunResult[] = []
    for (const s of settled) {
      if (s.result) results.push(s.result)
    }
    return { results, mode: 'all', complete: results.length === params.workers.length }
  }
}
