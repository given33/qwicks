import { describe, it, expect, vi } from 'vitest'
import { createApprovalGateAdapter } from '@qwicks/mesh/integration/approval-gate-adapter.js'
import type { ApprovalGate } from '@qwicks/ports/approval-gate.js'
import type { ToolCallRequest } from '@qwicks/mesh/contracts.js'

const req = (over: Partial<ToolCallRequest> = {}): ToolCallRequest => ({
  callId: 'c1', ownerDeviceId: 'd-bbb', name: 'fs.write', arguments: { path: '/a' }, idempotencyKey: 'k1', ...over
})

function fakeGate(decision: 'allow' | 'deny'): { gate: ApprovalGate; captured: () => unknown } {
  let captured: unknown
  return {
    gate: { request: vi.fn(async (approval) => { captured = approval; return decision }) } as unknown as ApprovalGate,
    captured: () => captured
  }
}

describe('createApprovalGateAdapter (RFC 003 §7 → real ApprovalGate)', () => {
  it('forwards allow', async () => {
    const { gate } = fakeGate('allow')
    const adapter = createApprovalGateAdapter(gate)
    expect(await adapter.request(req())).toBe('allow')
  })

  it('forwards deny', async () => {
    const { gate } = fakeGate('deny')
    const adapter = createApprovalGateAdapter(gate)
    expect(await adapter.request(req())).toBe('deny')
  })

  it('builds an ApprovalRequest with the tool name + a mesh-scoped threadId', async () => {
    const { gate, captured } = fakeGate('allow')
    const adapter = createApprovalGateAdapter(gate)
    await adapter.request(req({ taskId: 'task-9' }))
    const approval = captured() as { toolName: string; threadId: string; turnId: string; status: string; summary: string }
    expect(approval.toolName).toBe('fs.write')
    expect(approval.threadId).toBe('mesh:task-9')
    expect(approval.turnId).toBe('mesh:c1')
    expect(approval.status).toBe('pending')
    expect(approval.summary).toContain('d-bbb')
  })
})
