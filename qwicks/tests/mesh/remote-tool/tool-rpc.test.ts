import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolRpcServer, ToolRpcClient, type ToolRpcServerDeps } from '@qwicks/mesh/remote-tool/tool-rpc.js'
import { AuditLog } from '@qwicks/mesh/audit/audit-log.js'
import type { ToolCallRequest, ToolResult } from '@qwicks/mesh/contracts.js'

const req = (over: Partial<ToolCallRequest> = {}): ToolCallRequest => ({
  callId: 'c1',
  ownerDeviceId: 'd-bbb',
  name: 'fs.read',
  arguments: { path: '/a' },
  idempotencyKey: 'k1',
  ...over
})

function deps(over: Partial<ToolRpcServerDeps> = {}): ToolRpcServerDeps {
  return {
    isPeerAuthorized: () => true,
    toolRisk: (name) => ({ riskLevel: name === 'fs.write' ? 'high' : 'none', requiresUserConfirm: name === 'fs.write' }),
    executeLocal: vi.fn(async () => ({ output: 'file-contents' })),
    approvalGate: { request: vi.fn(async () => 'allow' as const) },
    audit: new AuditLog(join(mkdtempSync(join(tmpdir(), 'rpc-')), 'audit.db')),
    ...over
  }
}

describe('ToolRpcServer (RFC 003 §6, §7, 006 §5)', () => {
  let dir: string
  const audits: AuditLog[] = []
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rpc-'))
  })
  afterEach(() => {
    for (const a of audits.splice(0)) a.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a low-risk tool and returns success', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new ToolRpcServer(d)
    const result = await server.handleToolCall(req(), 'd-aaa')
    expect(result.status).toBe('success')
    expect(result.output).toBe('file-contents')
    expect(d.executeLocal).toHaveBeenCalledTimes(1)
  })

  it('routes high-risk tools through the approval gate; deny blocks execution', async () => {
    const d = deps({
      approvalGate: { request: vi.fn(async () => 'deny' as const) }
    })
    audits.push(d.audit)
    const server = new ToolRpcServer(d)
    const result = await server.handleToolCall(req({ name: 'fs.write' }), 'd-aaa')
    expect(result.status).toBe('denied')
    expect(d.executeLocal).not.toHaveBeenCalled()
  })

  it('runs a high-risk tool after the user allows it', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new ToolRpcServer(d)
    const result = await server.handleToolCall(req({ name: 'fs.write' }), 'd-aaa')
    expect(result.status).toBe('success')
    expect(d.approvalGate!.request).toHaveBeenCalledTimes(1)
  })

  it('rejects an unauthorized caller', async () => {
    const d = deps({ isPeerAuthorized: (id) => id === 'd-aaa' })
    audits.push(d.audit)
    const server = new ToolRpcServer(d)
    await expect(server.handleToolCall(req(), 'd-evil')).rejects.toMatchObject({ code: -32002 })
    expect(d.executeLocal).not.toHaveBeenCalled()
  })

  it('deduplicates by idempotencyKey', async () => {
    const d = deps()
    audits.push(d.audit)
    const server = new ToolRpcServer(d)
    const first = await server.handleToolCall(req(), 'd-aaa')
    const second = await server.handleToolCall(req({ callId: 'c2' }), 'd-aaa')
    expect(d.executeLocal).toHaveBeenCalledTimes(1)
    expect(second.output).toBe(first.output)
  })
})

describe('ToolRpcClient (RFC 003 §6)', () => {
  it('sends tools/call and unwraps the ToolResult', async () => {
    const send = vi.fn(async () => ({ callId: 'c1', status: 'success', output: 'ok' } satisfies ToolResult))
    const client = new ToolRpcClient(send as never)
    const result = await client.call(req())
    expect(result.status).toBe('success')
    expect(result.output).toBe('ok')
    expect(send).toHaveBeenCalledWith('tools/call', expect.objectContaining({ name: 'fs.read' }))
  })
})
