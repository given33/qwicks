import type { ChildRunExecutor } from '../../delegation/delegation-runtime.js'

/**
 * The DelegationRuntime seam (RFC 008 §9).
 *
 * `DelegationRuntime` consumes a single `options.executor`. To let remote Tasks
 * participate, this wrapper routes each call to the local or the remote executor
 * based on a router decision (built from peer manifests + load via
 * `MeshRouter.selectExecutor`). When the router picks local, behavior is
 * byte-for-byte the existing local path; when it picks remote, the call goes to
 * `createRemoteChildExecutor`. `mesh.enabled=false` simply never constructs
 * this wrapper, so the runtime keeps its original executor.
 */

export interface MeshAwareExecutorDeps {
  localExecutor: ChildRunExecutor
  remoteExecutor: ChildRunExecutor
  decide: (input: {
    childId: string
    prompt: string
    model?: string
    label?: string
    workspace?: string
  }) => { executor: 'local' | 'remote'; workerDeviceId?: string; reason?: string }
}

export function createMeshAwareExecutor(deps: MeshAwareExecutorDeps): ChildRunExecutor {
  return async (input) => {
    const decision = deps.decide({
      childId: input.childId,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {})
    })
    return decision.executor === 'remote' ? deps.remoteExecutor(input) : deps.localExecutor(input)
  }
}
