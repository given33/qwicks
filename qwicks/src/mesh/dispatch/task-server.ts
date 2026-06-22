import type { ChildRunExecutor } from '../../delegation/delegation-runtime.js'
import type { TaskRunParams, ChildRunResult } from '../contracts.js'
import type { AuditLog } from '../audit/audit-log.js'
import { exceedsDepth } from '../roles/provenance.js'

/**
 * Worker-side task handler (RFC 002 §11, §5; RFC 006 §3.2; RFC 007 §5, §7.1).
 *
 * Receives a `task/run` wire payload, authorizes the caller against the trust
 * store, checks provenance for cycles and depth, deduplicates by `idempotencyKey`,
 * then runs the task through the injected local executor (in production:
 * `createChildAgentExecutor`). The result is cached so a retried request with
 * the same key returns the prior outcome instead of re-executing.
 */

export interface TaskServerDeps {
  isPeerAuthorized: (peerDeviceId: string) => boolean
  localExecutor: ChildRunExecutor
  audit: AuditLog
  selfDeviceId?: string
  /** Idempotency cache TTL in ms (default 4 × lease). */
  idempotencyTtlMs?: number
  /** Maximum provenance chain depth before rejecting (RFC 007 §7.1). */
  maxDepth?: number
}

interface CachedResult {
  status: 'running' | 'completed' | 'failed'
  result?: ChildRunResult
  expiresAt: number
}

export interface MeshRpcError {
  code: number
  message: string
}

const ERR_UNAUTHORIZED = { code: -32002, message: 'unauthorized' }
const ERR_CYCLE = { code: -32008, message: 'cycle_detected' }
const ERR_DEPTH = { code: -32008, message: 'provenance_depth_exceeded' }

export class TaskServer {
  private readonly deps: TaskServerDeps
  private readonly cache = new Map<string, CachedResult>()
  /** taskId → AbortController for the in-flight local execution. Populated
   *  when a task starts running, used by `cancel()` to abort it promptly. */
  private readonly inflight = new Map<string, AbortController>()

  constructor(deps: TaskServerDeps) {
    this.deps = deps
  }

  /** Abort an in-flight task (called from the task/cancel handler or on lease
   *  expiry). Returns true if a running task was aborted, false if it had
   *  already completed or was never seen. */
  cancel(taskId: string): boolean {
    const controller = this.inflight.get(taskId)
    if (!controller) return false
    controller.abort()
    this.inflight.delete(taskId)
    return true
  }

  async handleTaskRun(params: TaskRunParams, callerDeviceId: string): Promise<ChildRunResult> {
    if (!this.deps.isPeerAuthorized(callerDeviceId)) throw ERR_UNAUTHORIZED
    if (this.deps.selfDeviceId && params.provenance.includes(this.deps.selfDeviceId)) throw ERR_CYCLE
    if (this.deps.maxDepth && exceedsDepth(params.provenance, this.deps.maxDepth)) throw ERR_DEPTH

    const cached = this.cache.get(params.idempotencyKey)
    if (cached?.result) {
      this.scrubExpired()
      return cached.result
    }
    if (cached && cached.status === 'running') {
      // A concurrent identical request is in flight; reject as a duplicate so
      // the caller retries after the first completes.
      throw { code: -32009, message: 'duplicate_in_flight' }
    }

    const ttl = this.idempotencyTtlMs(params)
    this.cache.set(params.idempotencyKey, { status: 'running', expiresAt: Date.now() + ttl })

    await this.deps.audit.record({
      kind: 'task_run_requested',
      from: callerDeviceId,
      to: this.deps.selfDeviceId ?? '?',
      outcome: 'success',
      traceId: params.taskId,
      taskId: params.taskId,
      timestamp: nowIso(),
      detail: { idempotencyKey: params.idempotencyKey, retryCount: params.retryCount }
    })

    const controller = new AbortController()
    this.inflight.set(params.taskId, controller)
    try {
      const execResult = await this.deps.localExecutor({
        childId: params.taskId,
        parentThreadId: params.parentThreadId,
        parentTurnId: params.parentTurnId,
        ...(params.label ? { label: params.label } : {}),
        prompt: params.prompt,
        ...(params.promptPreamble ? { promptPreamble: params.promptPreamble } : {}),
        ...(params.workspace ? { workspace: params.workspace } : {}),
        ...(params.model ? { model: params.model } : {}),
        toolPolicy: params.toolPolicy ?? 'inherit',
        signal: controller.signal
      })

      const result: ChildRunResult = {
        summary: execResult.summary,
        usage: {
          promptTokens: execResult.usage?.promptTokens ?? 0,
          completionTokens: execResult.usage?.completionTokens ?? 0,
          totalTokens: execResult.usage?.totalTokens ?? 0
        },
        ...(execResult.toolInvocations !== undefined ? { toolInvocations: execResult.toolInvocations } : {}),
        ...(execResult.prefixReused !== undefined ? { prefixReused: execResult.prefixReused } : {}),
        ...(execResult.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: execResult.inheritedHistoryItems } : {}),
        status: 'completed'
      }
      this.cache.set(params.idempotencyKey, { status: 'completed', result, expiresAt: Date.now() + ttl })
      await this.deps.audit.record({ kind: 'task_run_completed', from: callerDeviceId, to: this.deps.selfDeviceId ?? '?', outcome: 'success', traceId: params.taskId, taskId: params.taskId, timestamp: nowIso(), detail: {} })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: ChildRunResult = {
        summary: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        status: 'failed',
        error: message
      }
      this.cache.set(params.idempotencyKey, { status: 'failed', result, expiresAt: Date.now() + ttl })
      await this.deps.audit.record({ kind: 'task_run_failed', from: callerDeviceId, to: this.deps.selfDeviceId ?? '?', outcome: 'failure', traceId: params.taskId, taskId: params.taskId, timestamp: nowIso(), detail: { error: message } })
      // Re-throw as a structured result for the caller to inspect via status,
      // but the transport layer surfaces it as a JSON-RPC error response.
      if (isMeshError(error)) throw error
      return result
    } finally {
      this.inflight.delete(params.taskId)
    }
  }

  private idempotencyTtlMs(params: TaskRunParams): number {
    return this.deps.idempotencyTtlMs ?? params.lease.leaseTimeout * 4 * 1000
  }

  private scrubExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key)
    }
  }
}

function isMeshError(error: unknown): error is MeshRpcError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
}

function nowIso(): string {
  return new Date().toISOString()
}
