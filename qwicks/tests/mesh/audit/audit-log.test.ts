import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'

describe('audit log (RFC 006 §8)', () => {
  let dir: string
  const opened: AuditLog[] = []
  const openLog = (): AuditLog => {
    const l = new AuditLog(join(dir, 'mesh-audit.db'))
    opened.push(l)
    return l
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'q-audit-'))
  })
  afterEach(() => {
    for (const l of opened.splice(0)) l.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends events and reads them back in order', async () => {
    const log = openLog()
    await log.record({ kind: 'task_run_requested', from: 'd-a', to: 'd-b', outcome: 'success', traceId: 't1', timestamp: '2026-06-22T00:00:00.000Z', detail: { taskId: 'tk1' } })
    await log.record({ kind: 'task_run_completed', from: 'd-a', to: 'd-b', outcome: 'success', traceId: 't1', timestamp: '2026-06-22T00:00:01.000Z', detail: { taskId: 'tk1' } })
    const rows = await log.list({ traceId: 't1' })
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('task_run_requested')
    expect(rows[1].kind).toBe('task_run_completed')
  })

  it('filters by taskId', async () => {
    const log = openLog()
    await log.record({ kind: 'tool_called', from: 'd-a', to: 'd-b', outcome: 'success', traceId: 't1', taskId: 'tk1', timestamp: '2026-06-22T00:00:00.000Z', detail: { tool: 'fs.read' } })
    await log.record({ kind: 'tool_called', from: 'd-a', to: 'd-b', outcome: 'denied', traceId: 't2', taskId: 'tk2', timestamp: '2026-06-22T00:00:01.000Z', detail: { tool: 'fs.write' } })
    const rows = await log.list({ taskId: 'tk1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].outcome).toBe('success')
  })

  it('persists across instances (same file)', async () => {
    const first = openLog()
    await first.record({ kind: 'pairing_completed', from: 'd-a', to: 'd-b', outcome: 'success', traceId: 't1', timestamp: '2026-06-22T00:00:00.000Z', detail: {} })
    first.close()
    const reopened = openLog()
    const rows = await reopened.list({})
    expect(rows).toHaveLength(1)
  })

  it('does not expose update or delete methods (append-only)', () => {
    const log = openLog()
    expect((log as unknown as Record<string, unknown>).update).toBeUndefined()
    expect((log as unknown as Record<string, unknown>).delete).toBeUndefined()
    expect((log as unknown as Record<string, unknown>).deleteWhere).toBeUndefined()
  })

  it('allocates a unique auditId per record', async () => {
    const log = openLog()
    await log.record({ kind: 'k', from: 'a', to: 'b', outcome: 'success', traceId: 't', timestamp: 'x', detail: {} })
    await log.record({ kind: 'k', from: 'a', to: 'b', outcome: 'success', traceId: 't', timestamp: 'y', detail: {} })
    const rows = await log.list({})
    expect(rows[0].auditId).not.toBe(rows[1].auditId)
  })
})
