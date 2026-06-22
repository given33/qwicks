import { selectExecutor, selectFanOut, type WorkerCandidate, type RoutingInput, type FanOutDecision } from '../roles/mesh-router.js'
import { canDispatchTo } from '../roles/provenance.js'
import type { ManifestStore } from '../manifest/manifest-builder.js'

/**
 * Bridges `MeshRouter.selectExecutor` to the `MeshAwareExecutor.decide` shape.
 *
 * Builds the routing input from the cached peer manifests + a live-load probe,
 * then returns the decision the mesh-aware executor uses to pick local vs
 * remote. When no peers are known, or none qualify, the decision is `local` —
 * identical to the pre-mesh path.
 *
 * Provenance enforcement (RFC 007 §7): candidates that would create a cycle
 * or exceed the configured max depth are excluded before routing.
 */

export interface RouterDecideDeps {
  manifestStore: ManifestStore
  getLoad: (deviceId: string) => number
  selfDeviceId: string
  maxDepth?: number
  /** Current task's provenance chain (absent for top-level dispatches). */
  provenance?: string[]
}

export function buildMeshAwareDecide(deps: RouterDecideDeps): (input: {
  childId: string
  prompt: string
  model?: string
  label?: string
  workspace?: string
}) => { executor: 'local' | 'remote'; workerDeviceId?: string; reason?: string } {
  const maxDepth = deps.maxDepth ?? 5
  const provenance = deps.provenance ?? []

  return (input) => {
    const manifests = deps.manifestStore.list()
    if (manifests.length === 0) return { executor: 'local', reason: 'no_peers' }

    const candidates: WorkerCandidate[] = manifests
      .filter((m) => canDispatchTo({ provenance, targetDeviceId: m.deviceId, maxDepth }))
      .map((m) => ({
        deviceId: m.deviceId,
        manifest: m,
        inflightTasks: deps.getLoad(m.deviceId),
        maxConcurrent: m.offeredPermissions.taskExecution.maxConcurrent
      }))

    if (candidates.length === 0) return { executor: 'local', reason: 'no_eligible_peers' }

    const routingInput: RoutingInput = {
      selfDeviceId: deps.selfDeviceId,
      candidates,
      ...(input.model ? { model: input.model } : {})
    }
    const decision = selectExecutor(routingInput)
    return {
      executor: decision.executor,
      ...(decision.workerDeviceId ? { workerDeviceId: decision.workerDeviceId } : {}),
      reason: decision.reason
    }
  }
}

/**
 * Fan-out bridge: builds routing input and calls `selectFanOut` to pick all
 * eligible workers for parallel dispatch. Candidates that would create cycles
 * or exceed the provenance depth are excluded.
 */
export function buildMeshAwareFanOut(deps: RouterDecideDeps): (input: {
  childId: string
  prompt: string
  model?: string
  label?: string
  workspace?: string
}) => FanOutDecision {
  const maxDepth = deps.maxDepth ?? 5
  const provenance = deps.provenance ?? []

  return (input) => {
    const manifests = deps.manifestStore.list()
    if (manifests.length === 0) return { executor: 'local', workers: [], reason: 'no_peers' }

    const candidates: WorkerCandidate[] = manifests
      .filter((m) => canDispatchTo({ provenance, targetDeviceId: m.deviceId, maxDepth }))
      .map((m) => ({
        deviceId: m.deviceId,
        manifest: m,
        inflightTasks: deps.getLoad(m.deviceId),
        maxConcurrent: m.offeredPermissions.taskExecution.maxConcurrent
      }))

    if (candidates.length === 0) return { executor: 'local', workers: [], reason: 'no_eligible_peers' }

    const routingInput: RoutingInput = {
      selfDeviceId: deps.selfDeviceId,
      candidates,
      ...(input.model ? { model: input.model } : {})
    }
    return selectFanOut(routingInput)
  }
}
