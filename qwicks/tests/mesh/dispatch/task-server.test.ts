import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskServer } from '@qwicks/mesh/dispatch/task-server.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import type { ChildRunExecutor } from '@qwicks/delegation/delegation-runtime.js'

const baseParams = {
  taskId: 'child-1',
  parentThreadId: 'th-1',
  parentTurnId: 'tn-1',
  prompt: 'do thing',
  lease: { leaseTimeout: 300, heartbeatInterval: 75 },
  idempotencyKey: 'key-1',
  retryCount: 0,
  maxRetries: 2,
  cancelToken: 'tok-1',
  provenance: ['d-aaa'],
  disableUserInput: true
}

function fakeExecutor(over: Partial<Awaited<ReturnType<ChildRunExecutor>>> = {}): ChildRunExecutor {
  return vi.fn(async () => ({
    summary: 'done on worker',
    toolInvocations: 1,
    prefixReused: true,
    inheritedHistoryItems: 0,
    ...over
  })) as unknown as ChildRunExecutor
}

describe('TaskServer (RFC 002 §11, §5)', () => {
  let dir: string
  const audits: AuditLog[] = []
  const openAudit = () => {
    const a = new AuditLog(join(dir, 'audit.db'))
    audits.push(a)
    return a
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'task-srv-'))
  })
  afterEach(() => {
    for (const a of audits.splice(0)) a.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs an authorized task through the local executor and returns a completed result', async () => {
    const exec = fakeExecutor()
    const server = new TaskServer({
      isPeerAuthorized: () => true,
      localExecutor: exec,
      audit: openAudit()
    })
    const result = await server.handleTaskRun(baseParams, 'd-aaa')
    expect(result.status).toBe('completed')
    expect(result.summary).toBe('done on worker')
    expect(result.toolInvocations).toBe(1)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('rejects an unauthorized caller', async () => {
    const exec = fakeExecutor()
    const server = new TaskServer({
      isPeerAuthorized: (id) => id === 'd-aaa',
      localExecutor: exec,
      audit: openAudit()
    })
    await expect(server.handleTaskRun(baseParams, 'd-evil')).rejects.toMatchObject({ code: -32002 })
    expect(exec).not.toHaveBeenCalled()
  })

  it('deduplicates by idempotencyKey — executor runs once, second call returns cached result', async () => {
    const exec = fakeExecutor()
    const server = new TaskServer({
      isPeerAuthorized: () => true,
      localExecutor: exec,
      audit: openAudit()
    })
    const first = await server.handleTaskRun(baseParams, 'd-aaa')
    const second = await server.handleTaskRun({ ...baseParams, retryCount: 1 }, 'd-aaa')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(second.summary).toBe(first.summary)
    expect(second.status).toBe('completed')
  })

  it('maps a thrown executor error to a failed ChildRunResult', async () => {
    const exec = vi.fn(async () => {
      throw new Error('worker exploded')
    }) as unknown as ChildRunExecutor
    const server = new TaskServer({
      isPeerAuthorized: () => true,
      localExecutor: exec,
      audit: openAudit()
    })
    const result = await server.handleTaskRun(baseParams, 'd-aaa')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('worker exploded')
  })

  it('rejects a task whose provenance already contains the worker (cycle, RFC 007 §7.1)', async () => {
    const exec = fakeExecutor()
    const server = new TaskServer({
      isPeerAuthorized: () => true,
      localExecutor: exec,
      audit: openAudit(),
      selfDeviceId: 'd-bbb'
    })
    await expect(
      server.handleTaskRun({ ...baseParams, provenance: ['d-aaa', 'd-bbb'] }, 'd-aaa')
    ).rejects.toMatchObject({ code: -32008 })
    expect(exec).not.toHaveBeenCalled()
  })
})
