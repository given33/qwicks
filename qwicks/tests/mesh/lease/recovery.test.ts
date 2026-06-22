import { describe, it, expect } from 'vitest'
import { decideRecovery, type RecoveryInput } from '@qwicks/mesh/lease/recovery.js'

const base = (over: Partial<RecoveryInput> = {}): RecoveryInput => ({
  retryCount: 1,
  maxRetries: 3,
  originalWorkerReachable: true,
  alternativeWorkersAvailable: true,
  retryable: true,
  ...over
})

describe('decideRecovery (RFC 007 §6.3)', () => {
  it('retries on the same worker when retries remain and it is reachable', () => {
    const decision = decideRecovery(base({ retryCount: 1, maxRetries: 3, originalWorkerReachable: true }))
    expect(decision.action).toBe('retry_same_worker')
  })

  it('reassigns to a different worker when the original is unreachable but alternates exist', () => {
    const decision = decideRecovery(base({ retryCount: 1, maxRetries: 3, originalWorkerReachable: false, alternativeWorkersAvailable: true }))
    expect(decision.action).toBe('reassign')
  })

  it('takes over locally when retries are exhausted', () => {
    const decision = decideRecovery(base({ retryCount: 3, maxRetries: 3 }))
    expect(decision.action).toBe('take_over_locally')
  })

  it('takes over locally when retries remain but no worker is available', () => {
    const decision = decideRecovery(base({ retryCount: 1, maxRetries: 3, originalWorkerReachable: false, alternativeWorkersAvailable: false }))
    expect(decision.action).toBe('take_over_locally')
  })

  it('marks the task failed when the error is non-retryable', () => {
    const decision = decideRecovery(base({ retryable: false }))
    expect(decision.action).toBe('fail')
  })
})
