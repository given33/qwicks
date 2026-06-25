import { describe, expect, it } from 'vitest'
import { deriveTurnTimer } from './turn-timer'

const NOW = 10_000

describe('deriveTurnTimer', () => {
  it('THINKING_WAIT: no reasoning, no assistant -> no seconds', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: false,
      hasLiveAssistant: false,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_wait')
    expect(r.displayMs).toBeUndefined()
    expect(r.labelKey).toBe('thinkingNow')
  })

  it('THINKING_REASON: first reasoning delta -> seconds from reasoningStartedAt', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: false,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_reason')
    expect(r.displayMs).toBe(1000)
    expect(r.labelKey).toBe('thinkingWithSeconds')
  })

  it('PROCESSING (from thinking): assistant arrives -> continues timer, no reset', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: true,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
    // same reasoningStartedAt as THINKING_REASON -> seconds continue, not reset
    expect(r.displayMs).toBe(1000)
    expect(r.labelKey).toBe('processingWithDuration')
  })

  it('PROCESSING (skip thinking): no reasoning, direct assistant -> fallback to turnStartedAt', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: false,
      hasLiveAssistant: true,
      turnStartedAt: 7000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
    expect(r.displayMs).toBe(3000)
    expect(r.labelKey).toBe('processingWithDuration')
  })

  it('DONE: uses recordedDurationMs when present', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      reasoningStartedAt: 9000,
      recordedDurationMs: 12_000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(12_000)
    expect(r.labelKey).toBe('processedWithDuration')
  })

  it('DONE: falls back to now - reasoningStartedAt when no recorded duration', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      reasoningStartedAt: 8000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(2000)
  })

  it('DONE: falls back to now - turnStartedAt when no reasoning', () => {
    const r = deriveTurnTimer({
      isProcessing: false,
      turnStartedAt: 6000,
      nowMs: NOW
    })
    expect(r.phase).toBe('done')
    expect(r.displayMs).toBe(4000)
  })

  it('reasoning reappearing after PROCESSING does not revert to thinking', () => {
    // already in processing (assistant seen), reasoning still present -> stays processing
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: true,
      reasoningStartedAt: 9000,
      nowMs: NOW
    })
    expect(r.phase).toBe('processing')
  })

  it('THINKING_REASON without reasoningStartedAt -> undefined displayMs', () => {
    const r = deriveTurnTimer({
      isProcessing: true,
      hasLiveReasoning: true,
      hasLiveAssistant: false,
      nowMs: NOW
    })
    expect(r.phase).toBe('thinking_reason')
    expect(r.displayMs).toBeUndefined()
  })

  it('idle when not processing and no data', () => {
    const r = deriveTurnTimer({ isProcessing: false, nowMs: NOW })
    expect(r.phase).toBe('idle')
    expect(r.displayMs).toBeUndefined()
  })
})
