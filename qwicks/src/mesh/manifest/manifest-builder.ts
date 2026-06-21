import type { DeviceIdentity } from '../identity/device-identity.js'
import {
  Manifest,
  type Manifest as ManifestType,
  type ToolEntry,
  type ModelEntry,
  type ComputeProfile,
  type PermissionOffer
} from '../contracts.js'

/**
 * Manifest construction + peer caching (RFC 005 §3, §6).
 *
 * `buildManifest` assembles the public-layer capability list from the device
 * identity, available models, tools, and compute profile. Non-discoverable
 * tools are dropped before advertisement. `requiresUserConfirm` is derived
 * from `riskLevel` (high/critical forced true) so a tool cannot silently bypass
 * the local confirmation gate.
 *
 * In Phase 1 the tool/model/compute inputs are injected; the real integration
 * with the existing tool-host and model config happens in `bootMesh` (Task 14).
 */

export interface ToolInput {
  name: string
  description: string
  version: string
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'
  readonly: boolean
  discoverable: boolean
  sides: ('orchestrator' | 'worker')[]
  allowedPaths?: string[]
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface ModelInput {
  id: string
  provider: 'local' | 'remote'
  contextWindow: number
  maxOutput: number
  supportsTools: boolean
  supportsVision: boolean
  available: boolean
  version: string
}

const DEFAULT_PERMISSIONS: PermissionOffer = {
  memoryQuery: { allowed: false, maxTopK: 0, scopes: [] },
  toolCall: { allowedTools: [], deniedTools: [], maxRiskLevel: 'none' },
  resourceAccess: { allowedUris: [] },
  taskExecution: { maxConcurrent: 1, maxLeaseSeconds: 300 }
}

export function buildManifest(opts: {
  identity: DeviceIdentity
  deviceName: string
  models: ModelInput[]
  tools: ToolInput[]
  computeProfile: ComputeProfile
  manifestVersion?: number
  offeredPermissions?: PermissionOffer
}): ManifestType {
  const tools: ToolEntry[] = opts.tools
    .filter((t) => t.discoverable)
    .map((t) => ({
      name: t.name,
      description: t.description,
      version: t.version,
      ownerDevice: opts.identity.deviceId,
      inputSchema: t.inputSchema ?? { type: 'object' },
      outputSchema: t.outputSchema ?? { type: 'object' },
      riskLevel: t.riskLevel,
      requiresUserConfirm: t.riskLevel === 'high' || t.riskLevel === 'critical',
      ...(t.allowedPaths ? { allowedPaths: t.allowedPaths } : {}),
      readonly: t.readonly,
      discoverable: true,
      sides: t.sides
    }))

  const models: ModelEntry[] = opts.models.map((m) => ({
    id: m.id,
    provider: m.provider,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    supportsTools: m.supportsTools,
    supportsVision: m.supportsVision,
    available: m.available,
    version: m.version
  }))

  return Manifest.parse({
    deviceId: opts.identity.deviceId,
    deviceName: opts.deviceName,
    protocolVersion: '1',
    manifestVersion: opts.manifestVersion ?? 1,
    generatedAt: new Date().toISOString(),
    models,
    tools,
    prompts: [],
    resources: [],
    computeProfile: opts.computeProfile,
    offeredPermissions: opts.offeredPermissions ?? DEFAULT_PERMISSIONS
  })
}

interface CachedManifest {
  manifest: ManifestType
  receivedAt: string
}

export class ManifestStore {
  private readonly cache = new Map<string, CachedManifest>()

  set(manifest: ManifestType): void {
    this.cache.set(manifest.deviceId, { manifest, receivedAt: new Date().toISOString() })
  }

  get(deviceId: string): ManifestType | undefined {
    return this.cache.get(deviceId)?.manifest
  }

  invalidate(deviceId: string): void {
    this.cache.delete(deviceId)
  }

  list(): ManifestType[] {
    return [...this.cache.values()].map((c) => c.manifest)
  }
}
