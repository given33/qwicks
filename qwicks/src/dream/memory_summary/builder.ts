/**
 * Memory Summary —— 1:1 对齐 Python `dream/memory_summary/__init__.py`。
 *
 * 模仿 OpenAI "ChatGPT knows about you" 的 7 区摘要(work/projects/preferences/
 * constraints/locations/sensitive/hidden)。每条 entry 带 text/last_updated/confidence/
 * source_count/memory_ids/structured_attrs/correction_url/importance。
 */
import { MemoryLifecycleStatus, type MemoryItem } from '../types.js'

const WORK_PATTERN = /(?:项目|project|团队|team|任务|task|deadline|Q[1-4]|milestone)/i
const PROJECT_PATTERN = /(?:^|[^一-\u9fffA-Za-z])(?:SATURN|VENUS|MARS|JUPITER|TITAN|EUROPA|PHOBOS|DEIMOS|CERES|IO|GANYMEDE|CALLISTO|项目\s*代号)/i
const PREFERENCE_PATTERN = /(?:偏好|prefer|喜欢|习惯|style|风格|preference|minimalist|YAGNI|source.backed|简洁|短|直接|素食|vegetarian|无肉|vegan)/i
const CONSTRAINT_PATTERN = /(?:禁止|不允许|不要|必须|constraint|prohibit|must|不收集|no.telemetry|隐私|privacy|全本地)/i
const LOCATION_PATTERN = /(?:本地|北京|上海|深圳|杭州|成都|广州|新加坡|东京|巴黎|纽约|伦敦|首尔|曼谷|香港|台北|悉尼|location|out.of.office|出差|旅行|travel)/i
const SENSITIVE_PATTERN = /(?:password|api.key|credit.card|ssn|身份证|护照|secret|token|private.key)/i
const HIDDEN_PATTERN = /(?:不?要?再?提|不要?主动|不要?告诉|hidden|do_not_inject|suppress|dont_mention|forbidden)/i

export interface SummaryEntry {
  text: string
  lastUpdated: string
  confidence: number
  sourceCount: number
  memoryIds: string[]
  structuredAttrs: Record<string, unknown>
  correctionUrl: string
  importance: number
}

export type SummarySection = 'work' | 'projects' | 'preferences' | 'constraints' | 'locations' | 'sensitive' | 'hidden'

export interface MemorySummary {
  userId: string
  work: SummaryEntry[]
  projects: SummaryEntry[]
  preferences: SummaryEntry[]
  constraints: SummaryEntry[]
  locations: SummaryEntry[]
  sensitive: SummaryEntry[]
  hidden: SummaryEntry[]
  generatedAt: string
  /** 序列化为 snake_case dict(含 counts)。 */
  toDict(): Record<string, unknown>
}

function attrsOf(item: MemoryItem): Record<string, unknown> {
  const a = item.metadata.structured_attrs
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
}

function classifySection(item: MemoryItem): SummarySection {
  const content = item.content ?? ''
  const md = item.metadata ?? {}
  const attrs = attrsOf(item)
  if (md.suppressed_at || md.do_not_inject || md.dont_mention) return 'hidden'
  if (HIDDEN_PATTERN.test(content)) return 'hidden'
  if (SENSITIVE_PATTERN.test(content)) return 'sensitive'
  if (md.sensitive_type) return 'sensitive'
  if (CONSTRAINT_PATTERN.test(content)) return 'constraints'
  if (attrs.privacy === 'no_telemetry') return 'constraints'
  if (attrs.current_location) return 'locations'
  if (attrs.active_during_travel) return 'locations'
  if (LOCATION_PATTERN.test(content)) return 'locations'
  if (attrs.project) return 'projects'
  if (PROJECT_PATTERN.test(content)) return 'projects'
  if (attrs.preference) return 'preferences'
  if (PREFERENCE_PATTERN.test(content)) return 'preferences'
  return 'work'
}

function makeEntry(item: MemoryItem): SummaryEntry {
  const md = item.metadata ?? {}
  const reinforceCount = typeof md.reinforce_count === 'number' ? md.reinforce_count : 0
  return {
    text: (item.content ?? '').slice(0, 200),
    lastUpdated: item.updatedAt,
    confidence: item.confidence,
    sourceCount: Math.max(1, reinforceCount + 1),
    memoryIds: [item.id],
    structuredAttrs: attrsOf(item),
    correctionUrl: `memory_panel.html?memory_id=${item.id}&action=correct`,
    importance: item.importance
  }
}

export function buildMemorySummary(items: Iterable<MemoryItem>, opts: { userId: string }): MemorySummary {
  const summary: MemorySummary = {
    userId: opts.userId,
    work: [],
    projects: [],
    preferences: [],
    constraints: [],
    locations: [],
    sensitive: [],
    hidden: [],
    generatedAt: new Date().toISOString(),
    toDict() {
      return summaryToDict(this)
    }
  }
  const sectionLists: Record<SummarySection, SummaryEntry[]> = {
    work: summary.work,
    projects: summary.projects,
    preferences: summary.preferences,
    constraints: summary.constraints,
    locations: summary.locations,
    sensitive: summary.sensitive,
    hidden: summary.hidden
  }
  for (const it of items) {
    if (!it || it.userId !== opts.userId) continue
    if (it.status === MemoryLifecycleStatus.DELETED || it.status === MemoryLifecycleStatus.SUPERSEDED) continue
    const section = classifySection(it)
    sectionLists[section].push(makeEntry(it))
  }
  for (const lst of Object.values(sectionLists)) {
    lst.sort((a, b) => b.importance - a.importance || b.lastUpdated.localeCompare(a.lastUpdated))
  }
  return summary
}

export function memorySummaryToText(summary: MemorySummary, opts: { maxPerSection?: number } = {}): string {
  const maxPerSection = opts.maxPerSection ?? 5
  const lines: string[] = [`# Memory Summary for ${summary.userId}`, '']
  const sections: ReadonlyArray<readonly [SummarySection, SummaryEntry[]]> = [
    ['work', summary.work],
    ['projects', summary.projects],
    ['preferences', summary.preferences],
    ['constraints', summary.constraints],
    ['locations', summary.locations],
    ['sensitive', summary.sensitive],
    ['hidden', summary.hidden]
  ]
  for (const [name, lst] of sections) {
    if (lst.length === 0) continue
    lines.push(`## ${name.toUpperCase()} (${lst.length} items)`)
    for (const e of lst.slice(0, maxPerSection)) {
      const attrsStr = Object.entries(e.structuredAttrs).map(([k, v]) => `${k}=${v}`).join(', ')
      const attrsPart = attrsStr ? ` [${attrsStr}]` : ''
      lines.push(`- ${e.text}${attrsPart} (last_updated=${e.lastUpdated}, confidence=${e.confidence.toFixed(2)}, sources=${e.sourceCount})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function summaryToDict(summary: MemorySummary): Record<string, unknown> {
  const sections: ReadonlyArray<readonly [SummarySection, SummaryEntry[]]> = [
    ['work', summary.work],
    ['projects', summary.projects],
    ['preferences', summary.preferences],
    ['constraints', summary.constraints],
    ['locations', summary.locations],
    ['sensitive', summary.sensitive],
    ['hidden', summary.hidden]
  ]
  const out: Record<string, unknown> = { user_id: summary.userId, generated_at: summary.generatedAt }
  const counts: Record<string, number> = {}
  for (const [name, lst] of sections) {
    out[name] = lst.map((e) => ({
      text: e.text,
      last_updated: e.lastUpdated,
      confidence: Math.round(e.confidence * 1000) / 1000,
      source_count: e.sourceCount,
      memory_ids: e.memoryIds,
      structured_attrs: e.structuredAttrs,
      correction_url: e.correctionUrl,
      importance: Math.round(e.importance * 1000) / 1000
    }))
    counts[name] = lst.length
  }
  out.counts = counts
  return out
}
