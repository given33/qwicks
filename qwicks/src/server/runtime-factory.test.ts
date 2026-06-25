import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildMemoryStore } from './runtime-factory.js'

/**
 * Phase 3 回归:确保 buildMemoryStore 在 backend='dream' 时返回 dreamSystem,
 * 这样 /v1/dream/* 路由(runtime.dreamSystem)才能用(否则全部 503)。
 * 该回归曾因 dreamSystem 漏加进返回的 ServerRuntime 而发生。
 */
describe('buildMemoryStore dream wiring (regression: dreamSystem must be returned)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-wire-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns a dreamSystem for backend=dream', async () => {
    const result = await buildMemoryStore(
      { enabled: true, backend: 'dream', scopes: ['user'], maxInjectedRecords: 8 },
      dir
    )
    expect(result.dreamSystem).toBeDefined()
    expect(typeof result.dreamSystem?.buildSummary).toBe('function')
    expect(typeof result.dreamSystem?.controls2.suppressMemory).toBe('function')
    result.close()
  })

  it('returns NO dreamSystem for backend=file', async () => {
    const result = await buildMemoryStore(
      { enabled: true, backend: 'file', scopes: ['user'], maxInjectedRecords: 8 },
      dir
    )
    expect(result.dreamSystem).toBeUndefined()
    result.close()
  })
})
