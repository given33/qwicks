import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  DEFAULT_QWICKS_CAPABILITIES_CONFIG,
  QWicksCapabilitiesConfig,
  ModelInputModality,
  ModelMessagePartSupport,
  ModelReasoningCapabilityMetadata
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'
// `MeshConfig` is exported as both a zod schema (value) and an inferred type.
// Import the schema value under an alias so we can use it in `.optional()`
// below; the type is re-exported via `z.infer` at the bottom of this file.
import { MeshConfig as MeshConfigSchema } from '../mesh/config.js'

export const QWICKS_CONFIG_FILENAME = 'config.json'
export const DEFAULT_QWICKS_MODEL = 'deepseek-v4-pro'

const PositiveInt = z.number().int().positive()
const PositiveRatio = z.number().positive().max(1)

export const ModelContextCompactionProfileConfigSchema = z
  .object({
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softThreshold !== undefined &&
      profile.hardThreshold !== undefined &&
      profile.hardThreshold < profile.softThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelContextProfileConfigSchema = z
  .object({
    aliases: z.array(z.string().min(1)).optional(),
    contextWindowTokens: PositiveInt.optional(),
    contextCompaction: ModelContextCompactionProfileConfigSchema.optional(),
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional(),
    inputModalities: z.array(ModelInputModality).optional(),
    outputModalities: z.array(ModelInputModality).optional(),
    supportsToolCalling: z.boolean().optional(),
    messageParts: z.array(ModelMessagePartSupport).optional(),
    reasoning: ModelReasoningCapabilityMetadata.optional(),
    // Per-model wire-format override. Omitted means "inherit the
    // provider/runtime endpointFormat" — no default coercion here, otherwise
    // every model would be pinned to chat_completions.
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasRatio =
      profile.softRatio !== undefined ||
      profile.hardRatio !== undefined ||
      profile.contextCompaction?.softRatio !== undefined ||
      profile.contextCompaction?.hardRatio !== undefined
    if (hasRatio && profile.contextWindowTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'softRatio and hardRatio require contextWindowTokens'
      })
    }
    const softThreshold = profile.contextCompaction?.softThreshold ?? profile.softThreshold
    const hardThreshold = profile.contextCompaction?.hardThreshold ?? profile.hardThreshold
    if (softThreshold !== undefined && hardThreshold !== undefined && hardThreshold < softThreshold) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelConfigSchema = z
  .object({
    profiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()

export const ContextCompactionConfigSchema = z
  .object({
    defaultSoftThreshold: PositiveInt.optional(),
    defaultHardThreshold: PositiveInt.optional(),
    summaryMode: z.enum(['heuristic', 'model']).optional(),
    summaryTimeoutMs: PositiveInt.optional(),
    summaryMaxTokens: PositiveInt.optional(),
    summaryInputMaxBytes: PositiveInt.optional(),
    modelProfiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.defaultSoftThreshold !== undefined &&
      config.defaultHardThreshold !== undefined &&
      config.defaultHardThreshold < config.defaultSoftThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultHardThreshold must be greater than or equal to defaultSoftThreshold'
      })
    }
  })

export const RuntimeTuningConfigSchema = z
  .object({
    // Max idle gap (ms) between streaming chunks before a turn fails with
    // `stream_idle_timeout`. Local LLM servers prefilling a huge prompt can
    // stay silent well past the 45s default; `0` disables the guard entirely.
    streamIdleTimeoutMs: z.number().int().min(0).optional(),
    toolStorm: z
      .object({
        enabled: z.boolean().optional(),
        windowSize: PositiveInt.optional(),
        threshold: z.number().int().min(2).optional()
      })
      .strict()
      .optional(),
    toolArgumentRepair: z
      .object({
        maxStringBytes: PositiveInt.optional()
      })
      .strict()
      .optional()
  })
  .strict()

/** Detection aggressiveness for the design-quality linter. */
export const DESIGN_QUALITY_STRICTNESS = ['relaxed', 'standard', 'strict'] as const

/**
 * First-party design-quality linter. When enabled, a builtin PostToolUse
 * hook scans frontend files the agent writes/edits and folds findings back
 * into the tool result so the model self-corrects on the next turn.
 */
export const QualityConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    strictness: z.enum(DESIGN_QUALITY_STRICTNESS).default('standard'),
    /** Rule ids to suppress (see the quality detector registry). */
    ignoreRules: z.array(z.string().min(1)).default([]),
    /** Glob patterns (relative paths) to skip, e.g. `**\/vendor/**`. */
    ignoreFiles: z.array(z.string().min(1)).default([]),
    /** Hard cap on findings folded into a single tool result. */
    maxFindings: z.number().int().positive().max(100).default(12)
  })
  .strict()

export const RequestHistoryHygieneConfigSchema = z
  .object({
    maxToolResultLines: PositiveInt.optional(),
    maxToolResultBytes: PositiveInt.optional(),
    maxToolResultTokens: PositiveInt.optional(),
    maxToolArgumentStringBytes: PositiveInt.optional(),
    maxToolArgumentStringTokens: PositiveInt.optional(),
    maxArrayItems: PositiveInt.optional()
  })
  .strict()

export const TokenEconomyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: RequestHistoryHygieneConfigSchema.optional()
  })
  .strict()

export const StorageConfigSchema = z
  .object({
    backend: z.enum(['hybrid', 'file']).default('hybrid'),
    sqlitePath: z.string().min(1).optional()
  })
  .strict()

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: 'hybrid'
}

/**
 * Per-`providerId` HTTP credentials. Lets the runtime route a thread's turns
 * to a non-default provider without restart — the workflow / scheduled task
 * UI picks a provider per request, the loop puts the id on `ModelRequest`,
 * and `MultiProviderModelClient` resolves it against this map.
 */
export const ServeProviderConfigSchema = z
  .object({
    apiKey: z.string().default(''),
    baseUrl: z.string().min(1),
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .default(DEFAULT_MODEL_ENDPOINT_FORMAT)
      .optional(),
    modelProxyUrl: z.string().optional()
  })
  .strict()
export type ServeProviderConfig = z.infer<typeof ServeProviderConfigSchema>

export const QWicksServeConfigSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    dataDir: z.string().min(1).optional(),
    runtimeToken: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    modelProxyUrl: z.string().optional(),
    endpointFormat: z.preprocess(
      normalizeModelEndpointFormat,
      z.enum(MODEL_ENDPOINT_FORMATS)
    ).default(DEFAULT_MODEL_ENDPOINT_FORMAT).optional(),
    model: z.string().min(1).optional(),
    approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY).optional(),
    sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE).optional(),
    tokenEconomyMode: z.boolean().optional(),
    tokenEconomy: TokenEconomyConfigSchema.optional(),
    insecure: z.boolean().optional(),
    storage: StorageConfigSchema.optional(),
    /**
     * Extra providers the runtime can route to per request. Keys are
     * provider ids (matched against `ModelRequest.providerId`); values
     * hold the same HTTP credentials shape as the runtime defaults. When
     * empty/absent, the runtime stays single-provider.
     */
    providers: z.record(z.string().min(1), ServeProviderConfigSchema).optional()
  })
  .strict()

export const QWicksConfigSchema = z
  .object({
    serve: QWicksServeConfigSchema.optional(),
    models: ModelConfigSchema.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    capabilities: QWicksCapabilitiesConfig.default(DEFAULT_QWICKS_CAPABILITIES_CONFIG),
    hooks: HooksConfigSchema.optional(),
    quality: QualityConfigSchema.optional(),
    /** LAN-distributed agent collaboration (RFC 000). Disabled by default; when
     *  enabled the runtime boots the mesh subsystem (transport, mDNS, pairing,
     *  task dispatch). See `src/mesh/config.ts` for the full nested schema. */
    mesh: MeshConfigSchema.optional()
  })
  .strict()

export type QWicksConfig = z.infer<typeof QWicksConfigSchema>
export type QualityConfig = z.infer<typeof QualityConfigSchema>
export const DEFAULT_QUALITY_CONFIG: QualityConfig = QualityConfigSchema.parse({})
export type QWicksServeConfig = z.infer<typeof QWicksServeConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ContextCompactionConfig = z.infer<typeof ContextCompactionConfigSchema>
export type RuntimeTuningConfig = z.infer<typeof RuntimeTuningConfigSchema>
export type TokenEconomyConfig = z.infer<typeof TokenEconomyConfigSchema>
export type StorageConfig = z.infer<typeof StorageConfigSchema>
export type MeshConfig = z.infer<typeof MeshConfigSchema>

export type LoadedQWicksConfig = {
  path: string
  config: QWicksConfig
}

export function readQWicksConfigFile(path: string): LoadedQWicksConfig {
  const resolvedPath = expandHomePath(path)
  const text = readFileSync(resolvedPath, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse QWicks config JSON at ${resolvedPath}: ${message}`)
  }
  const parsed = QWicksConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid QWicks config at ${resolvedPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  return { path: resolvedPath, config: parsed.data }
}

export function readOptionalQWicksConfigFile(path: string | undefined): LoadedQWicksConfig | null {
  if (!path) return null
  const resolvedPath = expandHomePath(path)
  if (!existsSync(resolvedPath)) return null
  return readQWicksConfigFile(resolvedPath)
}

export function qwicksConfigPathForDataDir(dataDir: string | undefined): string | undefined {
  const trimmed = dataDir?.trim()
  if (!trimmed) return undefined
  return join(expandHomePath(trimmed), QWICKS_CONFIG_FILENAME)
}

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}
