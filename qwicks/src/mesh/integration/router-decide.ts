import { selectExecutor, type WorkerCandidate, type RoutingInput } from '../roles/mesh-router.js'
import type { ManifestStore } from '../manifest/manifest-builder.js'

/**
 * Bridges `MeshRouter.selectExecutor` to the `MeshAwareExecutor.decide` shape.
 *
 * Builds the routing input from the cached peer manifests + a live-load probe,
 * then returns the decision the mesh-aware executor uses to pick local vs
 * remote. When no peers are known, or none qualify, the decision is `local` —
 * identical to the pre-mesh path.
 */

export interface RouterDecideDeps {
  manifestStore: ManifestStore
  getLoad: (deviceId: string) => number
  selfDeviceId: string
  maxDepth?: number
}

export function buildMeshAwareDecide(deps: RouterDecideDeps): (input: {
  childId: string
  prompt: string
  model?: string
  label?: string
  workspace?: string
}) => { executor: 'local' | 'remote'; workerDeviceId?: string; reason?: string } {
  return (input) => {
    const manifests = deps.manifestStore.list()
    if (manifests.length === 0) return { executor: 'local', reason: 'no_peers' }

    const candidates: WorkerCandidate[] = manifests.map((m) => ({
      deviceId: m.deviceId,
      manifest: m,
      inflightTasks: deps.getLoad(m.deviceId),
      maxConcurrent: m.offeredPermissions.taskExecution.maxConcurrent
    }))

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
