/**
 * Lease-expiry recovery decision (RFC 007 §6.3).
 *
 * When a remote task's lease elapses (or the worker disconnects), the
 * orchestrator decides what to do next. The rules:
 *   - non-retryable error (auth/protocol/prompt illegal)        → fail
 *   - retries remain + original worker reachable                 → retry same worker
 *   - retries remain + original unreachable + alternates exist   → reassign
 *   - retries remain + no worker available                      → take over locally
 *   - retries exhausted                                          → take over locally
 *
 * Pure function so the decision is auditable and testable.
 */

export interface RecoveryInput {
  retryCount: number
  maxRetries: number
  originalWorkerReachable: boolean
  alternativeWorkersAvailable: boolean
  retryable: boolean
}

export type RecoveryAction = 'retry_same_worker' | 'reassign' | 'take_over_locally' | 'fail'

export interface RecoveryDecision {
  action: RecoveryAction
  reason: string
}

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (!input.retryable) return { action: 'fail', reason: 'non_retryable' }

  if (input.retryCount >= input.maxRetries) return { action: 'take_over_locally', reason: 'retries_exhausted' }

  if (input.originalWorkerReachable) return { action: 'retry_same_worker', reason: 'worker_reachable' }

  if (input.alternativeWorkersAvailable) return { action: 'reassign', reason: 'original_unreachable_alternatives_exist' }

  return { action: 'take_over_locally', reason: 'no_worker_available' }
}
