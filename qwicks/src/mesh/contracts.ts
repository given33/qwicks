import { z } from 'zod'
import { SubagentToolPolicy } from '../contracts/capabilities.js'

/**
 * Mesh wire contracts (RFC 000 §8, 005 §3, 002 §4, 001 §6, 006 §4).
 *
 * These are the on-the-wire zod schemas shared by every mesh subsystem. They
 * are intentionally strict (reject unknown keys) so protocol drift surfaces as
 * a parse failure rather than silent field drops.
 */

/* ------------------------------------------------------------------ *
 * Envelope (RFC 000 §8.2, 006 §4.1)
 * ------------------------------------------------------------------ */

export const EnvelopeAuth = z
  .object({
    alg: z.enum(['hmac']),
    /** Session MAC over (payload || messageId || nonce || timestamp || taskId). */
    sig: z.string().min(1),
    /** Sender Ed25519 signature over the same fields; survives re-keying. */
    deviceSig: z.string().min(1)
  })
  .strict()

export const Envelope = z
  .object({
    version: z.literal('1'),
    from: z.string().min(1),
    to: z.string().min(1),
    messageId: z.string().min(1),
    correlationId: z.string().optional(),
    taskId: z.string().optional(),
    traceId: z.string().min(1),
    timestamp: z.string().min(1),
    nonce: z.string().min(1),
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    auth: EnvelopeAuth
  })
  .strict()
export type Envelope = z.infer<typeof Envelope>

/* ------------------------------------------------------------------ *
 * Manifest (RFC 005 §3)
 * ------------------------------------------------------------------ */

export const ModelEntry = z
  .object({
    id: z.string().min(1),
    provider: z.enum(['local', 'remote']),
    contextWindow: z.number().int().positive(),
    maxOutput: z.number().int().positive(),
    supportsTools: z.boolean(),
    supportsVision: z.boolean(),
    capabilities: z.array(z.string().min(1)).optional(),
    costPer1kInputUsd: z.number().nonnegative().optional(),
    costPer1kOutputUsd: z.number().nonnegative().optional(),
    available: z.boolean(),
    version: z.string().min(1)
  })
  .strict()
export type ModelEntry = z.infer<typeof ModelEntry>

export const RiskLevel = z.enum(['none', 'low', 'medium', 'high', 'critical'])
export type RiskLevel = z.infer<typeof RiskLevel>

export const ToolEntry = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    ownerDevice: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    riskLevel: RiskLevel,
    requiresUserConfirm: z.boolean(),
    allowedPaths: z.array(z.string().min(1)).optional(),
    rateLimit: z
      .object({ maxCalls: z.number().int().positive(), windowSeconds: z.number().int().positive() })
      .strict()
      .optional(),
    readonly: z.boolean(),
    discoverable: z.boolean(),
    sides: z.array(z.enum(['orchestrator', 'worker']))
  })
  .strict()
export type ToolEntry = z.infer<typeof ToolEntry>

export const PromptTemplate = z
  .object({
    id: z.string().min(1),
    layer: z.enum(['globalBase', 'task', 'device', 'tool']),
    version: z.string().min(1),
    scope: z.enum(['public', 'collaboration', 'private']),
    parameters: z.array(
      z.object({ name: z.string().min(1), required: z.boolean(), default: z.string().optional() }).strict()
    ),
    template: z.string().min(1)
  })
  .strict()
export type PromptTemplate = z.infer<typeof PromptTemplate>

export const ResourceEntry = z
  .object({
    uri: z.string().min(1),
    type: z.enum(['fileIndex', 'image', 'doc', 'memoryRef']),
    scope: z.enum(['public', 'collaboration', 'private']),
    size: z.number().int().nonnegative().optional(),
    mutable: z.boolean()
  })
  .strict()
export type ResourceEntry = z.infer<typeof ResourceEntry>

export const ComputeProfile = z
  .object({
    cpuCores: z.number().int().positive().optional(),
    ramGb: z.number().int().positive().optional(),
    gpu: z
      .object({ name: z.string(), vramGb: z.number().int().positive(), computeCapability: z.string() })
      .strict()
      .optional(),
    canRunLocalModels: z.boolean(),
    maxModelParamsB: z.number().int().positive().optional()
  })
  .strict()
export type ComputeProfile = z.infer<typeof ComputeProfile>

export const PermissionOffer = z
  .object({
    memoryQuery: z.object({ allowed: z.boolean(), maxTopK: z.number().int().nonnegative(), scopes: z.array(z.string()) }).strict(),
    toolCall: z.object({ allowedTools: z.array(z.string()), deniedTools: z.array(z.string()), maxRiskLevel: RiskLevel }).strict(),
    resourceAccess: z.object({ allowedUris: z.array(z.string()) }).strict(),
    taskExecution: z.object({ maxConcurrent: z.number().int().positive(), maxLeaseSeconds: z.number().int().positive() }).strict()
  })
  .strict()
export type PermissionOffer = z.infer<typeof PermissionOffer>

export const Manifest = z
  .object({
    deviceId: z.string().min(1),
    deviceName: z.string().min(1),
    protocolVersion: z.literal('1'),
    manifestVersion: z.number().int().nonnegative(),
    generatedAt: z.string().min(1),
    models: z.array(ModelEntry),
    tools: z.array(ToolEntry),
    prompts: z.array(PromptTemplate),
    resources: z.array(ResourceEntry),
    computeProfile: ComputeProfile,
    offeredPermissions: PermissionOffer
  })
  .strict()
export type Manifest = z.infer<typeof Manifest>

/* ------------------------------------------------------------------ *
 * Task dispatch (RFC 002 §4)
 * ------------------------------------------------------------------ */

export const LeaseSpec = z
  .object({ leaseTimeout: z.number().int().positive(), heartbeatInterval: z.number().int().positive() })
  .strict()

export const TaskRunParams = z
  .object({
    taskId: z.string().min(1),
    parentTaskId: z.string().optional(),
    parentThreadId: z.string().min(1),
    parentTurnId: z.string().min(1),
    label: z.string().optional(),
    prompt: z.string().min(1),
    promptPreamble: z.string().optional(),
    workspace: z.string().optional(),
    model: z.string().optional(),
    profile: z.string().optional(),
    toolPolicy: SubagentToolPolicy.optional(),
    systemPromptLayers: z
      .array(
        z
          .object({
            layer: z.enum(['globalBase', 'task', 'device', 'tool']),
            templateId: z.string().min(1),
            templateVersion: z.string().min(1),
            params: z.record(z.string(), z.string())
          })
          .strict()
      )
      .optional(),
    historyDelta: z
      .object({ prefixHash: z.string(), seedItems: z.array(z.record(z.string(), z.unknown())), compactionHint: z.string().optional() })
      .strict()
      .optional(),
    lease: LeaseSpec,
    idempotencyKey: z.string().min(1),
    retryCount: z.number().int().nonnegative(),
    maxRetries: z.number().int().nonnegative(),
    cancelToken: z.string().min(1),
    provenance: z.array(z.string().min(1)).min(1),
    allowedTools: z.array(z.string().min(1)).optional(),
    disableUserInput: z.boolean()
  })
  .strict()
export type TaskRunParams = z.infer<typeof TaskRunParams>

export const ChildRunResult = z
  .object({
    summary: z.string(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().default(0),
        completionTokens: z.number().int().nonnegative().default(0),
        totalTokens: z.number().int().nonnegative().default(0)
      })
      .strict(),
    toolInvocations: z.number().int().nonnegative().optional(),
    prefixReused: z.boolean().optional(),
    inheritedHistoryItems: z.number().int().nonnegative().optional(),
    status: z.enum(['completed', 'failed', 'aborted']),
    error: z.string().optional()
  })
  .strict()
export type ChildRunResult = z.infer<typeof ChildRunResult>

export const ProgressEvent = z
  .object({
    kind: z.enum([
      'turn_started',
      'assistant_text',
      'tool_call',
      'tool_result',
      'error',
      'heartbeat',
      'turn_completed'
    ])
  })
  .strict()
export type ProgressEvent = z.infer<typeof ProgressEvent>

/* ------------------------------------------------------------------ *
 * Peer trust (RFC 001 §6)
 * ------------------------------------------------------------------ */

export const PeerRecord = z
  .object({
    peerDeviceId: z.string().min(1),
    peerDeviceName: z.string().min(1),
    peerPublicKey: z.string().min(1),
    peerFingerprint: z.string().min(1),
    pairedAt: z.string().min(1),
    lastSeenAt: z.string().min(1),
    trustLevel: z.enum(['standard', 'elevated']),
    permissions: z.record(z.string(), z.unknown()),
    revokedAt: z.string().optional()
  })
  .strict()
export type PeerRecord = z.infer<typeof PeerRecord>

/* ------------------------------------------------------------------ *
 * Remote tool calling (RFC 003 §6)
 * ------------------------------------------------------------------ */

export const ToolCallRequest = z
  .object({
    callId: z.string().min(1),
    ownerDeviceId: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    arguments: z.record(z.string(), z.unknown()),
    taskId: z.string().optional(),
    idempotencyKey: z.string().min(1),
    deadline: z.string().optional()
  })
  .strict()
export type ToolCallRequest = z.infer<typeof ToolCallRequest>

export const ToolResult = z
  .object({
    callId: z.string().min(1),
    status: z.enum(['success', 'error', 'denied', 'timeout', 'truncated']),
    output: z.unknown(),
    truncated: z.boolean().optional(),
    error: z.string().optional()
  })
  .strict()
export type ToolResult = z.infer<typeof ToolResult>
