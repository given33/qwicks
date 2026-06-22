import type { Manifest } from '../contracts.js'

/**
 * Orchestrator-side executor selection (RFC 008 §4).
 *
 * Given the set of reachable worker candidates (their manifests + live load) and
 * the task's model/tool/capability requirements, decide whether to run locally or
 * dispatch to a specific remote worker. The rules, in priority order:
 *   1. Forced model preference → only candidates that host it.
 *   2. Capability match → drop candidates lacking a required tool or with no
 *      spare concurrency.
 *   3. Compute preference → planning/reflection tags prefer higher maxModelParamsB
 *      or a GPU.
 *   4. Load balancing → pick the least-busy eligible worker; tiebreak by deviceId.
 *   5. Local fallback → run on this device if nothing qualifies.
 *
 * Pure function so the routing decision is unit-testable and auditable.
 */

export interface WorkerCandidate {
  deviceId: string
  manifest: Manifest
  inflightTasks: number
  maxConcurrent: number
}

export interface RoutingInput {
  selfDeviceId: string
  candidates: WorkerCandidate[]
  model?: string
  requiredTools?: string[]
  taskCapabilityTags?: string[]
}

export interface RoutingDecision {
  executor: 'local' | 'remote'
  workerDeviceId?: string
  model?: string
  reason: string
}

export interface FanOutDecision {
  executor: 'local' | 'remote'
  workers: { deviceId: string; model?: string }[]
  reason: string
}

const COMPUTE_TAGS = new Set(['planning', 'reflection'])

export function selectExecutor(input: RoutingInput): RoutingDecision {
  let eligible = input.candidates.slice()

  if (input.model) {
    eligible = eligible.filter((c) => c.manifest.models.some((m) => m.id === input.model && m.available))
    if (eligible.length === 0) return { executor: 'local', model: input.model, reason: 'local_fallback:no_model' }
  }

  if (input.requiredTools && input.requiredTools.length > 0) {
    eligible = eligible.filter((c) => {
      const names = new Set(c.manifest.tools.filter((t) => t.discoverable).map((t) => t.name))
      return input.requiredTools!.every((rt) => names.has(rt))
    })
    if (eligible.length === 0) return { executor: 'local', reason: 'local_fallback:no_tool' }
  }

  // Capacity: must have a spare slot.
  eligible = eligible.filter((c) => c.inflightTasks < c.maxConcurrent)
  if (eligible.length === 0) return { executor: 'local', reason: 'local_fallback:no_capacity' }

  const wantsCompute = (input.taskCapabilityTags ?? []).some((t) => COMPUTE_TAGS.has(t))
  if (wantsCompute) {
    const ranked = eligible.slice().sort((a, b) => computeScore(b.manifest) - computeScore(a.manifest))
    const best = ranked[0]
    if (computeScore(best.manifest) > 0) {
      return { executor: 'remote', workerDeviceId: best.deviceId, model: input.model, reason: 'compute_preferred' }
    }
  }

  // Load balance: fewest in-flight, stable deviceId tiebreak.
  const sorted = eligible.slice().sort((a, b) => {
    const byLoad = a.inflightTasks - b.inflightTasks
    if (byLoad !== 0) return byLoad
    return a.deviceId < b.deviceId ? -1 : 1
  })
  const chosen = sorted[0]
  return { executor: 'remote', workerDeviceId: chosen.deviceId, model: input.model, reason: 'load_balanced' }
}

function computeScore(manifest: Manifest): number {
  const profile = manifest.computeProfile
  let score = 0
  if (profile.maxModelParamsB) score += profile.maxModelParamsB
  if (profile.gpu) score += 32
  return score
}

/**
 * Fan-out selector (RFC 008 §4.2): returns all eligible candidates for parallel
 * dispatch. Useful for broadcast-style queries, speculative execution, or
 * aggregating results from multiple workers. Follows the same filtering rules
 * as `selectExecutor` (model, tools, capacity) but returns every qualifying
 * worker sorted by load instead of just the best one.
 */
export function selectFanOut(input: RoutingInput): FanOutDecision {
  let eligible = input.candidates.slice()

  if (input.model) {
    eligible = eligible.filter((c) => c.manifest.models.some((m) => m.id === input.model && m.available))
    if (eligible.length === 0) return { executor: 'local', workers: [], reason: 'local_fallback:no_model' }
  }

  if (input.requiredTools && input.requiredTools.length > 0) {
    eligible = eligible.filter((c) => {
      const names = new Set(c.manifest.tools.filter((t) => t.discoverable).map((t) => t.name))
      return input.requiredTools!.every((rt) => names.has(rt))
    })
    if (eligible.length === 0) return { executor: 'local', workers: [], reason: 'local_fallback:no_tool' }
  }

  // Capacity: must have at least one spare slot.
  eligible = eligible.filter((c) => c.inflightTasks < c.maxConcurrent)
  if (eligible.length === 0) return { executor: 'local', workers: [], reason: 'local_fallback:no_capacity' }

  // Sort by load (fewest inflight first), stable deviceId tiebreak
  const sorted = eligible.slice().sort((a, b) => {
    const byLoad = a.inflightTasks - b.inflightTasks
    if (byLoad !== 0) return byLoad
    return a.deviceId < b.deviceId ? -1 : 1
  })

  return {
    executor: 'remote',
    workers: sorted.map((w) => ({ deviceId: w.deviceId, model: input.model })),
    reason: `fan_out:${sorted.length}_workers`
  }
}
