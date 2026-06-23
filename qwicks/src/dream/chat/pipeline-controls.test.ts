import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from './pipeline.js'
import { MemoryType } from '../types.js'

describe('DreamMemorySystem — Phase 3 user control surfaces', () => {
  let dir: string
  let sys: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-p3-'))
    sys = new DreamMemorySystem({ dataDir: dir, userId: 'alice' })
  })
  afterEach(async () => {
    sys.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('exposes a MemoryControls instance (list/get/edit/delete/suppress/opt-out/export/purge/versions)', () => {
    expect(sys.controls2).toBeDefined()
    expect(typeof sys.controls2.listMemories).toBe('function')
    expect(typeof sys.controls2.suppressMemory).toBe('function')
    expect(typeof sys.controls2.versionHistory).toBe('function')
  })

  it('buildMemorySummary produces a 7-section summary from current memories', async () => {
    await sys.chat('alice', '偏好简洁直接的回答风格')
    await sys.chat('alice', '我的项目是 teamflow')
    const summary = sys.buildSummary('alice')
    expect(summary.userId).toBe('alice')
    expect(summary.preferences.length + summary.projects.length + summary.work.length).toBeGreaterThan(0)
  })

  it('suppressMemory makes a memory Don\'t-mention-again (excluded from later retrieve by default)', async () => {
    const r = await sys.chat('alice', 'I prefer concise and direct answers without any fluff.')
    const id = r.newMemories[0]?.id
    expect(id).toBeTruthy()
    sys.controls2.suppressMemory(id!)
    // the suppressed memory should not surface in a normal retrieve
    const r2 = await sys.chat('alice', 'what are my preferences')
    expect(r2.hits.some((h) => h.item.id === id)).toBe(false)
  })

  it('editMemory updates content and records a version snapshot, restorable', async () => {
    const r = await sys.chat('alice', 'I prefer dark mode')
    const id = r.newMemories[0]!.id
    sys.controls2.editMemory(id, { content: 'I prefer light mode' })
    expect(sys.controls2.getMemory(id)!.content).toBe('I prefer light mode')
    const history = sys.controls2.versionHistory(id)
    expect(history.length).toBeGreaterThan(0)
    const restored = sys.controls2.restoreVersion(id, history[history.length - 1]!.versionId)!
    expect(restored.content).toBe('I prefer dark mode')
  })

  it('buildMemoryLedger partitions a turn into used/downranked/suppressed/skipped sources', async () => {
    await sys.chat('alice', '我的项目用 rust 写')
    const r2 = await sys.chat('alice', 'remind me about my rust project')
    expect(r2.gateReport).toBeTruthy()
    const ledger = sys.buildLedger({
      userId: 'alice',
      queryText: 'remind me about my rust project',
      hits: r2.routedHits,
      decisions: r2.gateReport!.decisions
    })
    expect(ledger.userId).toBe('alice')
    // at least the used set should be populated (memory was relevant)
    expect(ledger.used.length + ledger.downranked.length + ledger.suppressed.length).toBeGreaterThan(0)
  })

  it('opt-out then opt-in via controls', async () => {
    sys.controls2.optOut('alice')
    expect(sys.controls2.isOptedOut('alice')).toBe(true)
    // chat should reflect opt-out (no read/write side-effects)
    const r = await sys.chat('alice', 'hi')
    expect(r.extractorBackend).toBe('opt_out')
    expect(r.newMemories).toEqual([])
    sys.controls2.optIn('alice')
    expect(sys.controls2.isOptedOut('alice')).toBe(false)
  })

  it('export returns memories + chats', async () => {
    await sys.chat('alice', 'I like rust')
    const exported = sys.controls2.export('alice')
    expect(exported.memories.length).toBeGreaterThan(0)
    expect(exported.chats.length).toBeGreaterThan(0)
  })
})
