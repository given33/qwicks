/**
 * Batch E(spec §5.1):Connector 控制层。
 *
 * revokeConnector:撤销某 connector(gmail/drive)的授权 ——
 *   preview=true  → 只统计会受影响的活跃记忆数,不修改
 *   preview=false → 执行 tombstone(受影响记忆 SUPPRESSED + 标 CONNECTOR_REVOKED)
 * 受影响 = provenance.source === provider 且状态 ACTIVE/CONFIRMED 的记忆。
 */
import type { MemoryRepository } from '../storage/repository.js'
import { MemoryLifecycleStatus, nowIso } from '../types.js'

export interface RevokeResult {
  /** 是否为预览(未真正执行)。 */
  preview: boolean
  /** 受影响的活跃记忆数。 */
  affectedCount: number
}

export class ConnectorControls {
  constructor(private readonly repository: MemoryRepository) {}

  revokeConnector(
    userId: string,
    provider: string,
    account: string,
    opts: { preview: boolean }
  ): RevokeResult {
    const items = this.repository.list(userId, {})
    const activeStatuses = new Set([MemoryLifecycleStatus.ACTIVE, MemoryLifecycleStatus.CONFIRMED])
    const affected = items.filter(
      (it) => String(it.provenance?.source ?? '') === provider && activeStatuses.has(it.status)
    )

    if (opts.preview) {
      return { preview: true, affectedCount: affected.length }
    }

    for (const it of affected) {
      it.transitionStatus(MemoryLifecycleStatus.SUPPRESSED, {
        actor: `connector_revoke:${provider}:${account}`,
        reason: 'CONNECTOR_REVOKED'
      })
      it.metadata.connector_revoked_at = nowIso()
      it.metadata.connector_revoked_provider = provider
      this.repository.upsert(it)
    }
    return { preview: false, affectedCount: affected.length }
  }
}
