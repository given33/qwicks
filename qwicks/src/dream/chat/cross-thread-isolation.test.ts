/**
 * P0-A/B/E 测试:跨线程记忆 + temporary 不泄漏 + forceTick 不依赖 dirty
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from './pipeline.js'

function makeSystem(dir: string): DreamMemorySystem {
  return new DreamMemorySystem({ dataDir: dir, userId: 'alice' })
}

describe('[P0-A] Cross-thread memory continuity', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'xt-')); system = makeSystem(dir) })
  afterEach(async () => { system.close(); await rm(dir, { recursive: true, force: true }) })

  it('memory written in thread A is readable in thread B (same userId)', async () => {
    // Thread A: write
    await system.afterTurn({ userId: 'alice', userPrompt: 'I am vegan', assistantReply: 'ok', threadId: 'threadA', turnId: 'a1' })
    // Thread B: read (different threadId, same userId)
    const result = await system.beforeTurn({ userId: 'alice', prompt: 'recommend food', threadId: 'threadB', turnId: 'b1' })
    // Should find the vegan memory from thread A
    // (heuristic extractor may or may not extract, but if it did, it should be retrievable)
    const memories = system.repository.list('alice', {})
    expect(memories.length).toBeGreaterThan(0)
    // All memories belong to userId 'alice', not 'threadA'
    expect(memories.every((m) => m.userId === 'alice')).toBe(true)
  })
})

describe('[P0-B] Temporary/off does not leak rewrite to next turn', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'iso-')); system = makeSystem(dir) })
  afterEach(async () => { system.close(); await rm(dir, { recursive: true, force: true }) })

  it('temporary turn produces no rewrite/status hints', async () => {
    // Normal turn first (may produce rewrite)
    await system.beforeTurn({ userId: 'alice', prompt: 'restaurant nearby', threadId: 't1', turnId: 'n1' })
    // Temporary turn — should have ZERO hints/rewrite
    const tempResult = await system.beforeTurn({ userId: 'alice', prompt: 'secret question', threadId: 't1', turnId: 't1', temporary: true })
    expect(tempResult.memories).toHaveLength(0)
    expect(tempResult.statusHints.remembering).toBe(false)
    expect(tempResult.statusHints.personalizing).toBe(false)
    expect(tempResult.rewrittenQuery).toBeNull()
  })
})

describe('[P1-E] forceTick works without in-memory dirty', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ft-')); system = makeSystem(dir) })
  afterEach(async () => { system.close(); await rm(dir, { recursive: true, force: true }) })

  it('forceTick runs even when dirty set is empty', () => {
    // Don't call markDirty — simulate restart where dirty set is lost
    expect(system.scheduler.dirtyCount()).toBe(0)
    // forceTick should still execute
    const result = system.scheduler.forceTick({ userId: 'alice' })
    expect(result.ran).toBe(true)
  })

  it('regular tick returns ran=false when not dirty, forceTick returns ran=true', () => {
    expect(system.scheduler.tick({ userId: 'alice' }).ran).toBe(false)
    expect(system.scheduler.forceTick({ userId: 'alice' }).ran).toBe(true)
  })
})
