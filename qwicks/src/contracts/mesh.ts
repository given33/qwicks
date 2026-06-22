import { z } from 'zod'

/**
 * HTTP request/response contracts for the `/v1/mesh/*` routes (RFC 000 §10).
 *
 * These are the wire shapes the GUI (or curl) sends/receives when driving mesh
 * status, peer discovery, model listing, and pairing. They live here alongside
 * the other `/v1/*` contracts so the route layer can Zod-validate inputs the
 * same way it does for threads, approvals, etc.
 */

/* ------------------------------------------------------------------ *
 * Pairing
 * ------------------------------------------------------------------ */

export const MeshPairInitiateRequest = z
  .object({
    /** Responder's mesh transport host (IPv4 or hostname). */
    host: z.string().min(1),
    /** Responder's mesh transport port (the value advertised via mDNS). */
    port: z.number().int().min(1).max(65_535)
  })
  .strict()
export type MeshPairInitiateRequest = z.infer<typeof MeshPairInitiateRequest>

export const MeshPairVerifyRequest = z
  .object({
    /** The 6-digit code displayed on the responder side. */
    code: z.string().regex(/^\d{6}$/, 'code must be exactly 6 digits')
  })
  .strict()
export type MeshPairVerifyRequest = z.infer<typeof MeshPairVerifyRequest>
