import type { ApprovalGate } from '../../ports/approval-gate.js'
import { createApprovalRequest } from '../../domain/approval.js'
import type { ToolCallRequest } from '../contracts.js'

/**
 * Bridges the mesh `ToolRpcServer` approval hook to the existing `ApprovalGate`
 * port (RFC 003 §7; RFC 006 §5).
 *
 * A remote high-risk tool call arrives with no local thread/turn, so the adapter
 * synthesizes a mesh-scoped `threadId`/`turnId` from the call/task ids and asks
 * the real gate to decide. The gate's UI confirmation path is reused unchanged.
 */

export function createApprovalGateAdapter(gate: ApprovalGate): {
  request: (req: ToolCallRequest) => Promise<'allow' | 'deny'>
} {
  return {
    request: async (req) => {
      const approval = createApprovalRequest({
        id: req.callId,
        threadId: req.taskId ? `mesh:${req.taskId}` : `mesh:${req.callId}`,
        turnId: `mesh:${req.callId}`,
        toolName: req.name,
        summary: `remote tool call from peer (${req.ownerDeviceId})`
      })
      return gate.request(approval)
    }
  }
}
