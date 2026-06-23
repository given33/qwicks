import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from './pipeline.js'

describe('DreamMemorySystem — Phase 4 query rewrite + Pulse', () => {
  let dir: string
  let sys: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-p4pipe-'))
    sys = new DreamMemorySystem({ dataDir: dir, userId: 'alice' })
  })
  afterEach(async () => {
    sys.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('rewrites a food+location query with the user\'s diet/location memories', async () => {
    await sys.chat('alice', 'I live in San Francisco and I am a vegan.')
    const r = await sys.chat('alice', 'recommend good restaurants nearby')
    expect(r.rewrittenQuery).not.toBeNull()
    const low = r.rewrittenQuery!.rewritten.toLowerCase()
    expect(low).toContain('san francisco')
    expect(low).toContain('vegan')
    expect(r.rewrittenQuery!.appliedMemories.length).toBeGreaterThan(0)
  })

  it('does NOT rewrite a generic factual query', async () => {
    await sys.chat('alice', 'I live in Tokyo')
    const r = await sys.chat('alice', 'how does a neural network work')
    // generic factual → no rewrite
    expect(r.rewrittenQuery!.appliedMemories).toEqual([])
    expect(r.rewrittenQuery!.rewritten).toBe('how does a neural network work')
  })

  it('runPulse derives topics from the user\'s goals and produces a digest', async () => {
    await sys.chat('alice', 'My goal is to ship the dream memory system this quarter')
    const digest = await sys.runPulse('alice', {
      research: async (query) => ({
        query,
        summary: `Research on ${query}`,
        sources: [{ title: 'Ref', url: 'https://example.com' }],
        followUps: ['what about X?']
      })
    })
    expect(digest.userId).toBe('alice')
    expect(digest.results.length).toBeGreaterThan(0)
    expect(digest.results[0]!.summary).toContain('Research on')
    expect(digest.results[0]!.sources.length).toBeGreaterThan(0)
  })

  it('runPulse with no goals produces an empty digest', async () => {
    await sys.chat('alice', 'the weather is sunny today')
    const digest = await sys.runPulse('alice')
    expect(digest.results).toEqual([])
  })
})
