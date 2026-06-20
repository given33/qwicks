import { z } from 'zod'

/**
 * Structured API error codes returned by every QWicks HTTP/SSE endpoint.
 *
 * The error contract mirrors what QWicks diagnostics can render:
 * the renderer needs a stable `code` to drive UI state and a human-readable
 * `message` to surface in toasts. `details` carries optional, JSON-encodable
 * per-endpoint information (for example a Zod issue list).
 */
export const QWicksErrorCode = z.enum([
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
export type QWicksErrorCode = z.infer<typeof QWicksErrorCode>

export const RuntimeErrorSeverity = z.enum(['info', 'warning', 'error'])
export type RuntimeErrorSeverity = z.infer<typeof RuntimeErrorSeverity>

export const QWicksErrorBody = z.object({
  code: QWicksErrorCode,
  message: z.string(),
  details: z.unknown().optional()
})
export type QWicksErrorBody = z.infer<typeof QWicksErrorBody>
