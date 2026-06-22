import type { ManifestStore, ModelInput } from '../manifest/manifest-builder.js'
import type { Manifest } from '../contracts.js'

/**
 * Peer model registry (RFC 008 §5).
 *
 * Collects model availability from peer manifests and exposes a queryable
 * list that the UI layer can consume for model selection. Models are
 * deduplicated by id and enriched with the owning device's metadata so
 * the UI can show which peer hosts which model.
 *
 * The registry is refreshed each time manifests are updated (via the
 * manifest refresh timer or discovery events).
 */

export interface PeerModel {
  /** Model identifier (e.g. 'qwen2.5-7b'). */
  id: string
  /** Human-readable provider label. */
  provider: string
  /** Maximum context length in tokens. */
  contextWindow: number
  /** Maximum output tokens per response. */
  maxOutput: number
  /** Whether this model supports tool/function calling. */
  supportsTools: boolean
  /** Whether this model supports image inputs. */
  supportsVision: boolean
  /** Whether the model is currently available (not loaded / offline). */
  available: boolean
  /** Semantic version or release tag. */
  version?: string
  /** The device that hosts this model. */
  hostDeviceId: string
  /** Human-readable device name. */
  hostDeviceName: string
  /** Load on the hosting device (0 = idle). */
  hostInflightTasks: number
}

export interface PeerModelRegistry {
  /** List all models available across peers, sorted by availability then load. */
  listModels(): PeerModel[]
  /** List models filtered by a specific provider or device. */
  findModels(filter: { provider?: string; deviceId?: string; supportsTools?: boolean }): PeerModel[]
}

export interface PeerModelRegistryDeps {
  manifestStore: ManifestStore
  /** Get the current inflight task count for a device. */
  getLoad: (deviceId: string) => number
  selfDeviceId: string
}

export function createPeerModelRegistry(deps: PeerModelRegistryDeps): PeerModelRegistry {
  function collectModels(): PeerModel[] {
    const manifests = deps.manifestStore.list()
    const models: PeerModel[] = []

    for (const manifest of manifests) {
      // Skip self — local models are handled by the local model registry
      if (manifest.deviceId === deps.selfDeviceId) continue

      for (const m of manifest.models) {
        models.push({
          id: m.id,
          provider: m.provider,
          contextWindow: m.contextWindow,
          maxOutput: m.maxOutput,
          supportsTools: m.supportsTools,
          supportsVision: m.supportsVision,
          available: m.available,
          version: m.version,
          hostDeviceId: manifest.deviceId,
          hostDeviceName: manifest.deviceName,
          hostInflightTasks: deps.getLoad(manifest.deviceId)
        })
      }
    }

    // Sort: available first, then by lowest load
    models.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1
      return a.hostInflightTasks - b.hostInflightTasks
    })

    // Deduplicate by id — keep the first (best) entry per model id
    const seen = new Set<string>()
    return models.filter((m) => {
      const key = `${m.hostDeviceId}:${m.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  return {
    listModels() {
      return collectModels()
    },

    findModels(filter) {
      let models = collectModels()
      if (filter.provider) {
        models = models.filter((m) => m.provider === filter.provider)
      }
      if (filter.deviceId) {
        models = models.filter((m) => m.hostDeviceId === filter.deviceId)
      }
      if (filter.supportsTools != null) {
        models = models.filter((m) => m.supportsTools === filter.supportsTools)
      }
      return models
    }
  }
}
