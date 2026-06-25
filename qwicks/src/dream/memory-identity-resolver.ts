/**
 * Batch G(spec §7):记忆身份解析 + dream/mesh scope 映射。
 *
 * resolveMemoryUserId:稳定的记忆身份 —— workspace 用户 > 设备身份 > 'default'。
 *   单用户本地应用兜底 'default'(现状不退化);多账号/多设备由调用方注入更细身份。
 *
 * dreamScopeToMeshScope:把 dream 记忆 scope 映射到 mesh 同步 scope(用于将来的跨设备同步):
 *   user     → private        (个人记忆,无 grant 不外发)
 *   workspace→ public         (工作区共享)
 *   project  → collaboration  (项目协作)
 * 注:实际 mesh 同步管道是未来工作,这里只提供确定的映射 + 测试。
 */

export interface IdentityContext {
  /** workspace 当前登录用户(若适用)。 */
  workspaceUser?: string | null
  /** 设备配对身份(mesh 场景)。 */
  deviceUser?: string | null
}

/**
 * 解析稳定的记忆 userId。优先级:workspace > device > 'default'。
 * 绝不在生产里把多用户记忆串到同一 'default' 桶 —— 由调用方在拿到真实身份后传入。
 */
export function resolveMemoryUserId(ctx: IdentityContext = {}): string {
  if (ctx.workspaceUser && ctx.workspaceUser.trim()) return ctx.workspaceUser.trim()
  if (ctx.deviceUser && ctx.deviceUser.trim()) return ctx.deviceUser.trim()
  return 'default'
}

export type DreamScope = 'user' | 'workspace' | 'project'
export type MeshScope = 'public' | 'collaboration' | 'private'

/** dream 记忆 scope → mesh 同步 scope(无 grant 的 private 记忆不跨设备外发)。 */
export function dreamScopeToMeshScope(scope: DreamScope): MeshScope {
  if (scope === 'user') return 'private'
  if (scope === 'project') return 'collaboration'
  return 'public'
}
