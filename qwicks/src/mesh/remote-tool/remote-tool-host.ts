import { randomUUID } from 'node:crypto'
import type { ManifestStore } from '../manifest/manifest-builder.js'
import type { ToolRpcClient } from './tool-rpc.js'
import type { ToolEntry, ToolResult } from '../contracts.js'

/**
 * Worker-side peer-tool resolver (RFC 003 §4.1, §5).
 *
 * The worker's AgentLoop sees remote tools (from peer manifests) alongside
 * local ones. `RemoteToolHost` resolves which peer owns a requested tool name
 * (from the cached manifests) and routes the call through `ToolRpcClient`.
 *
 * Note: this is the routing layer, not a full `ToolHost`-port implementation.
 * The deep integration (constructing a `ToolHostContext` so the AgentLoop treats
 * remote tools identically to local ones) is wired in `bootMesh` against the
 * real `ToolHost` port; that path needs the full app to exercise end-to-end.
 */
export class RemoteToolHost {
  constructor(
    private readonly manifests: ManifestStore,
    private readonly client: ToolRpcClient
  ) {}

  async callPeerTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { ownerDeviceId?: string; taskId?: string }
  ): Promise<ToolResult> {
    const owner = this.resolveOwner(name, opts?.ownerDeviceId)
    return this.client.call({
      callId: randomUUID(),
      ownerDeviceId: owner.ownerDevice,
      name,
      arguments: args,
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      idempotencyKey: randomUUID()
    })
  }

  listPeerTools(): ToolEntry[] {
    const all: ToolEntry[] = []
    for (const manifest of this.manifests.list()) {
      for (const tool of manifest.tools) {
        if (tool.discoverable) all.push(tool)
      }
    }
    return all
  }

  private resolveOwner(toolName: string, ownerDeviceId?: string): ToolEntry {
    const candidates = this.listPeerTools().filter((t) => t.name === toolName)
    if (candidates.length === 0) throw new Error(`no peer exposes tool '${toolName}'`)
    if (ownerDeviceId) {
      const named = candidates.find((c) => c.ownerDevice === ownerDeviceId)
      if (!named) throw new Error(`peer '${ownerDeviceId}' does not expose tool '${toolName}'`)
      return named
    }
    return candidates[0]
  }
}
