import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryLifecycleStatus, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { buildMemorySummary, memorySummaryToText } from './builder.js'

function mk(id: string, content: string, type: MemoryType, metadata: Record<string, unknown> = {}, importance = 0.5, status = MemoryLifecycleStatus.ACTIVE): MemoryItem {
  return new MemoryItem(id, 'alice', type, content, MemoryScope.USER, [], importance, 0.7, '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', null, new MemoryProvenance(), null, null, [], metadata, status)
}

describe('buildMemorySummary (7 sections)', () => {
  const items = [
    mk('w1', '团队本周要交付 Q3 任务', MemoryType.PROJECT),
    mk('p1', 'SATURN 项目代号', MemoryType.PROJECT, { structured_attrs: { project: 'SATURN' } }),
    mk('pr1', '偏好简洁直接的回答风格', MemoryType.PREFERENCE, {}, 0.8),
    mk('c1', '禁止任何遥测,必须全本地', MemoryType.CONSTRAINT, { structured_attrs: { privacy: 'no_telemetry' } }),
    mk('l1', '当前在新加坡出差', MemoryType.FACT, { structured_attrs: { current_location: 'singapore' } }),
    mk('s1', 'my api key is sk-leak1234567890', MemoryType.FACT),
    mk('h1', '不要再提前任这件事', MemoryType.PREFERENCE, { do_not_inject: true, dont_mention: true })
  ]
  const summary = buildMemorySummary(items, { userId: 'alice' })

  it('classifies into the 7 sections', () => {
    expect(summary.work.map((e) => e.memoryIds[0])).toContain('w1')
    expect(summary.projects.map((e) => e.memoryIds[0])).toContain('p1')
    expect(summary.preferences.map((e) => e.memoryIds[0])).toContain('pr1')
    expect(summary.constraints.map((e) => e.memoryIds[0])).toContain('c1')
    expect(summary.locations.map((e) => e.memoryIds[0])).toContain('l1')
    expect(summary.sensitive.map((e) => e.memoryIds[0])).toContain('s1')
    expect(summary.hidden.map((e) => e.memoryIds[0])).toContain('h1')
  })

  it('skips deleted/superseded memories', () => {
    const withDeleted = [...items, mk('d1', 'a deleted work item', MemoryType.PROJECT, {}, 0.5, MemoryLifecycleStatus.DELETED)]
    const s = buildMemorySummary(withDeleted, { userId: 'alice' })
    expect(s.work.map((e) => e.memoryIds[0])).not.toContain('d1')
  })

  it('skips other users memories', () => {
    const bob = mk('b1', 'bob team work', MemoryType.PROJECT)
    bob.userId = 'bob'
    const s = buildMemorySummary([bob], { userId: 'alice' })
    expect(s.work).toHaveLength(0)
  })

  it('each entry carries confidence/source_count/memory_ids/correction_url/importance', () => {
    const e = summary.preferences[0]!
    expect(e.confidence).toBeGreaterThan(0)
    expect(e.sourceCount).toBeGreaterThanOrEqual(1)
    expect(e.memoryIds.length).toBeGreaterThan(0)
    expect(e.correctionUrl).toContain('memory_id=')
    expect(typeof e.importance).toBe('number')
  })

  it('sorts each section by importance then last_updated desc', () => {
    const high = mk('hi', '偏好 A', MemoryType.PREFERENCE, {}, 0.9)
    const low = mk('lo', '偏好 B', MemoryType.PREFERENCE, {}, 0.1)
    const s = buildMemorySummary([low, high], { userId: 'alice' })
    expect(s.preferences[0]!.memoryIds[0]).toBe('hi')
  })

  it('toDict serializes with counts', () => {
    const d = summary.toDict()
    const counts = d.counts as Record<string, number>
    expect(counts.preferences).toBeGreaterThan(0)
    expect(d.user_id).toBe('alice')
  })
})

describe('memorySummaryToText', () => {
  it('renders a readable markdown summary with section headers', () => {
    const items = [mk('p1', '偏好简洁回答', MemoryType.PREFERENCE, {}, 0.8)]
    const text = memorySummaryToText(buildMemorySummary(items, { userId: 'alice' }))
    expect(text).toContain('Memory Summary for alice')
    expect(text).toContain('PREFERENCES')
    expect(text).toContain('偏好简洁回答')
  })
})
