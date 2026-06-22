import type { ChildRunExecutor } from '../../delegation/delegation-runtime.js'

/**
 * Async-boot-safe seam for wiring Mesh into `DelegationRuntime` (RFC 000 §5.1).
 *
 * `DelegationRuntime` takes its `executor` synchronously at construction, but
 * `bootMesh` is async (loads identity, opens sockets, starts mDNS). This slot
 * resolves the ordering problem: the runtime is given a mesh-aware executor
 * built from the slot *immediately*, and before `install()` runs it behaves as a
 * pure pass-through to the local executor — byte-identical to the pre-mesh path.
 *
 * Once the async mesh boot completes, `install()` supplies the remote executor
 * + router decide callback, and the same executor starts routing eligible tasks
 * to peers. `clear()` (called on `shutdownMesh`) reverts to pure-local.
 *
 * `mesh.enabled=false` simply never calls `install()`, so the runtime stays on
 * the local path for its entire lifetime.
 */

export interface InstalledMesh {
  remoteExecutor: ChildRunExecutor
  decide: (input: { childId: string; prompt: string; model?: string; label?: string; workspace?: string }) => { executor: 'local' | 'remote'; workerDeviceId?: string; reason?: string }
}

export interface MeshRuntimeSlot {
  install(mesh: InstalledMesh): void
  clear(): void
}

export function createMeshRuntimeSlot(localExecutor: ChildRunExecutor): {
  slot: MeshRuntimeSlot
  executor: ChildRunExecutor
} {
  let installed: InstalledMesh | undefined

  const slot: MeshRuntimeSlot = {
    install(mesh) {
      installed = mesh
    },
    clear() {
      installed = undefined
    }
  }

  const executor: ChildRunExecutor = async (input) => {
    const mesh = installed
    if (!mesh) return localExecutor(input)
    const decision = mesh.decide({
      childId: input.childId,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {})
    })
    return decision.executor === 'remote' ? mesh.remoteExecutor(input) : localExecutor(input)
  }

  return { slot, executor }
}
