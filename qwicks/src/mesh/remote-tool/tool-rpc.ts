import type { ToolCallRequest, ToolResult, RiskLevel } from '../contracts.js'
import type { AuditLog } from '../audit/audit-log.js'

/**
 * Remote tool calling (RFC 003 §6, §7; RFC 006 §5).
 *
 * `ToolRpcServer` runs on the tool-owning device: it authorizes the caller,
 * looks up the tool's risk profile, routes high-risk calls through the approval
 * gate, deduplicates by `idempotencyKey`, then executes via the injected
 * `executeLocal` (which in production wraps `ToolHost.execute` with a
 * constructed context). `ToolRpcClient` is the worker-side caller.
 */

const ERR_UNAUTHORIZED = { code: -32002, message: 'unauthorized' }

type Send = (method: string, params: unknown) => Promise<unknown>

export interface ToolRpcServerDeps {
  isPeerAuthorized: (peerDeviceId: string) => boolean
  /** Risk profile for a tool name (from the manifest entry, RFC 005 §3.2). */
  toolRisk: (name: string) => { riskLevel: RiskLevel; requiresUserConfirm: boolean } | undefined
  /** Execute the tool locally; return its output. */
  executeLocal: (req: ToolCallRequest) => Promise<{ output: unknown; truncated?: boolean }>
  /** Approval gate for high/critical tools; required iff such tools exist. */
  approvalGate?: { request: (req: ToolCallRequest) => Promise<'allow' | 'deny'> }
  audit: AuditLog
  idempotencyTtlMs?: number
}

interface CachedToolResult {
  result: ToolResult
  expiresAt: number
}

export class ToolRpcServer {
  private readonly deps: ToolRpcServerDeps
  private readonly cache = new Map<string, CachedToolResult>()

  constructor(deps: ToolRpcServerDeps) {
    this.deps = deps
  }

  async handleToolCall(req: ToolCallRequest, callerDeviceId: string): Promise<ToolResult> {
    if (!this.deps.isPeerAuthorized(callerDeviceId)) throw ERR_UNAUTHORIZED

    const cached = this.cache.get(req.idempotencyKey)
    if (cached && Date.now() < cached.expiresAt) return cached.result

    const risk = this.deps.toolRisk(req.name)
    if (!risk) {
      return this.finish(req, callerDeviceId, { callId: req.callId, status: 'error', output: null, error: `unknown tool: ${req.name}` })
    }

    if (risk.requiresUserConfirm || risk.riskLevel === 'high' || risk.riskLevel === 'critical') {
      if (!this.deps.approvalGate) {
        return this.finish(req, callerDeviceId, { callId: req.callId, status: 'denied', output: null, error: 'no approval gate configured' })
      }
      const decision = await this.deps.approvalGate.request(req)
      if (decision !== 'allow') {
        return this.finish(req, callerDeviceId, { callId: req.callId, status: 'denied', output: null, error: 'user denied' })
      }
    }

    try {
      const { output, truncated } = await this.deps.executeLocal(req)
      return this.finish(req, callerDeviceId, {
        callId: req.callId,
        status: 'success',
        output,
        ...(truncated ? { truncated: true } : {})
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.finish(req, callerDeviceId, { callId: req.callId, status: 'error', output: null, error: message })
    }
  }

  private finish(req: ToolCallRequest, callerDeviceId: string, result: ToolResult): ToolResult {
    const ttl = this.deps.idempotencyTtlMs ?? 300_000
    this.cache.set(req.idempotencyKey, { result, expiresAt: Date.now() + ttl })
    void this.deps.audit.record({
      kind: 'tool_called',
      from: callerDeviceId,
      to: req.ownerDeviceId,
      outcome: result.status === 'success' ? 'success' : result.status === 'denied' ? 'denied' : 'failure',
      traceId: req.callId,
      taskId: req.taskId,
      timestamp: new Date().toISOString(),
      detail: { tool: req.name }
    })
    return result
  }
}

export class ToolRpcClient {
  private readonly send: Send
  constructor(send: Send) {
    this.send = send
  }
  async call(req: ToolCallRequest): Promise<ToolResult> {
    const result = (await this.send('tools/call', req)) as ToolResult
    return result
  }
}
