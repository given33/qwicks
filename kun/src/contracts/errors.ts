import { z } from 'zod'

/**
 * Structured API error codes returned by every Teamflow Agent HTTP/SSE endpoint.
 *
 * The error contract mirrors what diagnostics can render:
 * the renderer needs a stable `code` to drive UI state and a human-readable
 * `message` to surface in toasts. `details` carries optional, JSON-encodable
 * per-endpoint information (for example a Zod issue list).
 */
export const TeamflowAgentErrorCode = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'turn_in_progress',
  'turn_not_running',
  'approval_not_pending',
  'capability_unavailable',
  'provider_unavailable',
  'policy_blocked',
  'model_modality_unsupported',
  'attachment_validation_failed',
  'internal_error',
  'not_implemented',
  'aborted'
])
export type TeamflowAgentErrorCode = z.infer<typeof TeamflowAgentErrorCode>

export const RuntimeErrorSeverity = z.enum(['info', 'warning', 'error'])
export type RuntimeErrorSeverity = z.infer<typeof RuntimeErrorSeverity>

export const TeamflowAgentErrorBody = z.object({
  code: TeamflowAgentErrorCode,
  message: z.string(),
  details: z.unknown().optional()
})
export type TeamflowAgentErrorBody = z.infer<typeof TeamflowAgentErrorBody>
