import { describe, it, expect } from 'vitest'
import { MeshConfig } from '../../src/mesh/config.js'

describe('MeshConfig', () => {
  it('defaults to disabled (opt-in first principle, RFC 000 §4.1)', () => {
    const cfg = MeshConfig.parse({})
    expect(cfg.enabled).toBe(false)
    expect(cfg.discovery.enabled).toBe(true)
    expect(cfg.listenPort).toBe(0)
    expect(cfg.autoAcceptKnownPeers).toBe(false)
    expect(cfg.task.defaultLeaseTimeout).toBe(300)
    expect(cfg.task.defaultHeartbeatInterval).toBe(75)
    expect(cfg.task.maxRetries).toBe(2)
    expect(cfg.task.provenanceMaxDepth).toBe(5)
    expect(cfg.memory.maxTopK).toBe(10)
    expect(cfg.memory.cacheTtlSeconds).toBe(600)
  })

  it('accepts an explicit enabled config with overrides', () => {
    const cfg = MeshConfig.parse({
      enabled: true,
      deviceName: 'gpu-host',
      listenPort: 47131,
      discovery: { enabled: false },
      autoAcceptKnownPeers: true,
      task: { defaultLeaseTimeout: 600, maxRetries: 4 }
    })
    expect(cfg.enabled).toBe(true)
    expect(cfg.deviceName).toBe('gpu-host')
    expect(cfg.listenPort).toBe(47131)
    expect(cfg.discovery.enabled).toBe(false)
    expect(cfg.autoAcceptKnownPeers).toBe(true)
    expect(cfg.task.defaultLeaseTimeout).toBe(600)
    expect(cfg.task.maxRetries).toBe(4)
    // Heartbeat defaults relative to the (overridden) lease are not recomputed;
    // it keeps its own default unless set.
    expect(cfg.task.defaultHeartbeatInterval).toBe(75)
  })

  it('rejects a negative listenPort', () => {
    expect(() => MeshConfig.parse({ enabled: true, listenPort: -1 })).toThrow()
  })

  it('rejects a non-positive lease timeout', () => {
    expect(() => MeshConfig.parse({ task: { defaultLeaseTimeout: 0 } })).toThrow()
  })

  it('rejects unknown top-level keys (strict)', () => {
    expect(() => MeshConfig.parse({ bogusField: true })).toThrow()
  })
})
