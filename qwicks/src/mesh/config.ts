import { z } from 'zod'

/**
 * Mesh configuration (RFC 000 §4).
 *
 * The `enabled` flag is the opt-in gate: when `false` (the default) the Mesh
 * subsystem never boots, opens no sockets, advertises nothing on mDNS, and
 * injects no executor into `DelegationRuntime`. Existing QWicks behavior is
 * byte-for-byte unchanged.
 *
 * Nested objects use the function-default form (`.default(() => Schema.parse({}))`)
 * so their inner field defaults are filled — matching the convention in
 * `contracts/capabilities.ts`.
 */
const DiscoveryConfig = z
  .object({
    enabled: z.boolean().default(true)
  })
  .strict()

const TaskConfig = z
  .object({
    defaultLeaseTimeout: z.number().int().positive().default(300),
    defaultHeartbeatInterval: z.number().int().positive().default(75),
    maxRetries: z.number().int().nonnegative().default(2),
    provenanceMaxDepth: z.number().int().positive().default(5),
    idempotencyTtlMultiplier: z.number().int().positive().default(4)
  })
  .strict()

const MemoryConfig = z
  .object({
    maxTopK: z.number().int().positive().default(10),
    cacheTtlSeconds: z.number().int().positive().default(600),
    queryDeadlineSeconds: z.number().int().positive().default(15),
    allowPrivateGrants: z.boolean().default(true)
  })
  .strict()

export const MeshConfig = z
  .object({
    /** Master opt-in switch. Default false — Mesh is off until explicitly enabled. */
    enabled: z.boolean().default(false),
    /** Human-readable name shown to peers during discovery/pairing. */
    deviceName: z.string().min(1).optional(),
    /** Mesh listen port; 0 = OS-assigned, advertised via mDNS TXT. */
    listenPort: z.number().int().nonnegative().default(0),
    discovery: DiscoveryConfig.default(() => DiscoveryConfig.parse({})),
    /** Reconnect already-trusted peers without re-entering the pairing code. */
    autoAcceptKnownPeers: z.boolean().default(false),
    task: TaskConfig.default(() => TaskConfig.parse({})),
    memory: MemoryConfig.default(() => MemoryConfig.parse({}))
  })
  .strict()

export type MeshConfig = z.infer<typeof MeshConfig>
