import { describe, expect, it } from 'vitest'
import { resolveMemoryUserId, dreamScopeToMeshScope } from './memory-identity-resolver.js'

describe('resolveMemoryUserId (Batch G)', () => {
  it('prefers workspace user when present', () => {
    expect(resolveMemoryUserId({ workspaceUser: 'alice', deviceUser: 'device-1' })).toBe('alice')
  })
  it('falls back to device user when no workspace user', () => {
    expect(resolveMemoryUserId({ deviceUser: 'device-1' })).toBe('device-1')
  })
  it('falls back to default when neither present (single-user local)', () => {
    expect(resolveMemoryUserId({})).toBe('default')
    expect(resolveMemoryUserId({ workspaceUser: '   ', deviceUser: null })).toBe('default')
  })
})

describe('dreamScopeToMeshScope (Batch G)', () => {
  it('maps user → private (no grant → no exfil)', () => {
    expect(dreamScopeToMeshScope('user')).toBe('private')
  })
  it('maps workspace → public', () => {
    expect(dreamScopeToMeshScope('workspace')).toBe('public')
  })
  it('maps project → collaboration', () => {
    expect(dreamScopeToMeshScope('project')).toBe('collaboration')
  })
})
