import { describe, expect, it } from 'vitest'
import { HeuristicExtractor } from './heuristic-extractor.js'
import { LlmExtractor } from './llm-extractor.js'
import { ExtractionRouter } from './router.js'
import { MemoryType } from '../types.js'

describe('HeuristicExtractor', () => {
  const ext = new HeuristicExtractor()

  it('names itself dream.heuristic.v1', () => {
    expect(ext.name()).toBe('dream.heuristic.v1')
  })

  it('classifies an explicit preference', () => {
    const drafts = ext.extract({ user: 'I prefer concise answers without fluff.' })
    const pref = drafts.find((d) => d.type === MemoryType.PREFERENCE)
    expect(pref).toBeTruthy()
    expect(pref!.confidence).toBeCloseTo(0.65, 5)
    expect(pref!.provenance.source).toBe('model')
  })

  it('classifies a goal statement', () => {
    const drafts = ext.extract({ user: 'My goal is to ship the memory system this month.' })
    expect(drafts.some((d) => d.type === MemoryType.GOAL)).toBe(true)
  })

  it('classifies a skill statement', () => {
    const drafts = ext.extract({ user: 'I am familiar with Rust and systems programming.' })
    expect(drafts.some((d) => d.type === MemoryType.SKILL)).toBe(true)
  })

  it('classifies a constraint', () => {
    const drafts = ext.extract({ user: 'Responses must never mention the internal codename.' })
    expect(drafts.some((d) => d.type === MemoryType.CONSTRAINT)).toBe(true)
  })

  it('classifies a project statement', () => {
    const drafts = ext.extract({ user: "I'm building a desktop pet app called QWicks." })
    expect(drafts.some((d) => d.type === MemoryType.PROJECT)).toBe(true)
  })

  it('falls back to FACT for generic statements', () => {
    const drafts = ext.extract({ user: 'The release is scheduled for next Tuesday.' })
    expect(drafts.some((d) => d.type === MemoryType.FACT)).toBe(true)
  })

  it('extracts assistant EPISODEs that look useful', () => {
    const drafts = ext.extract({
      user: 'hi',
      assistant: 'I set up the CI pipeline with three parallel jobs as you asked.'
    })
    expect(drafts.some((d) => d.type === MemoryType.EPISODE)).toBe(true)
  })

  it('ignores very short fragments', () => {
    expect(ext.extract({ user: 'ok' })).toEqual([])
  })

  it('splits multi-sentence input into multiple drafts', () => {
    const drafts = ext.extract({
      user: 'I am a vegetarian. My goal is to run a marathon.'
    })
    expect(drafts.length).toBeGreaterThanOrEqual(2)
  })

  it('handles Chinese preference/goal detection', () => {
    const drafts = ext.extract({ user: '我喜欢简洁的回答。我的目标是完成这个项目。' })
    expect(drafts.some((d) => d.type === MemoryType.PREFERENCE)).toBe(true)
    expect(drafts.some((d) => d.type === MemoryType.GOAL)).toBe(true)
  })
})

describe('LlmExtractor (OpenAI-compatible chat)', () => {
  it('parses a JSON array response into drafts', async () => {
    const chat = async () => ({
      text: JSON.stringify([
        { type: 'preference', content: 'likes dark mode', importance: 0.8, confidence: 0.9, tags: ['ui'] }
      ])
    })
    const ext = new LlmExtractor({ chat })
    const drafts = await ext.extractAsync({ user: 'I like dark mode for everything.' })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.type).toBe(MemoryType.PREFERENCE)
    expect(drafts[0]!.content).toBe('likes dark mode')
    expect(drafts[0]!.importance).toBeCloseTo(0.8, 5)
  })

  it('returns [] when the LLM throws', async () => {
    const ext = new LlmExtractor({ chat: async () => { throw new Error('boom') } })
    expect(await ext.extractAsync({ user: 'x' })).toEqual([])
  })

  it('returns [] on malformed JSON', async () => {
    const ext = new LlmExtractor({ chat: async () => ({ text: 'not json' }) })
    expect(await ext.extractAsync({ user: 'x' })).toEqual([])
  })

  it('sends the system + user prompt through the chat fn', async () => {
    let captured: { system: string; user: string } | null = null
    const chat = async (msgs: { system: string; user: string }) => {
      captured = msgs
      return { text: '[]' }
    }
    const ext = new LlmExtractor({ chat })
    await ext.extractAsync({ user: 'hello there', assistant: 'hi' })
    expect(captured!.system).toContain('记忆提取')
    expect(captured!.user).toContain('hello there')
    expect(captured!.user).toContain('hi')
  })
})

describe('ExtractionRouter (LLM -> heuristic fallback)', () => {
  it('uses the LLM extractor when it returns drafts', async () => {
    const llm = new LlmExtractor({
      chat: async () => ({ text: JSON.stringify([{ type: 'skill', content: 'knows kubernetes' }]) })
    })
    const router = new ExtractionRouter({ primary: llm, fallback: new HeuristicExtractor() })
    const drafts = await router.extractAsync({ user: 'I know kubernetes well.' })
    expect(drafts.some((d) => d.content === 'knows kubernetes')).toBe(true)
    expect(router.lastBackend()).toBe(llm.name())
  })

  it('falls back to heuristic when the LLM returns empty', async () => {
    const llm = new LlmExtractor({ chat: async () => ({ text: '[]' }) })
    const router = new ExtractionRouter({ primary: llm, fallback: new HeuristicExtractor() })
    const drafts = await router.extractAsync({ user: 'I prefer dark mode for coding.' })
    expect(drafts.some((d) => d.type === MemoryType.PREFERENCE)).toBe(true)
    expect(router.lastBackend()).toBe('dream.heuristic.v1')
  })

  it('falls back to heuristic when the LLM throws', async () => {
    const llm = new LlmExtractor({ chat: async () => { throw new Error('down') } })
    const router = new ExtractionRouter({ primary: llm, fallback: new HeuristicExtractor() })
    const drafts = await router.extractAsync({ user: 'My goal is to learn Rust.' })
    expect(drafts.some((d) => d.type === MemoryType.GOAL)).toBe(true)
    expect(router.lastBackend()).toBe('dream.heuristic.v1')
  })
})
