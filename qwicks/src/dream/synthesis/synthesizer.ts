/**
 * Dream 合成层 —— 1:1 对齐 Python `dream/synthesis/base.py`。
 *
 * HeuristicSynthesizer:无 LLM 时按 type 聚合 hits → twin(每 type top 5)。
 * LlmSynthesizer:用 LLM(注入 chat)合成更高层 twin;失败回退 heuristic。
 */
import { MemoryItem, MemoryType, MemoryType as MT, nowIso } from '../types.js'
import type { RetrievalHit } from '../retrieval/pipeline.js'
import type { UserDigitalTwin } from '../user_state/builder.js'

export interface SynthesisInput {
  hits: RetrievalHit[]
  user: string
  assistant: string | null
  twin: UserDigitalTwin | null
  userId: string
}

export interface SynthesisResult {
  twin: UserDigitalTwin
  selected: MemoryItem[]
  merged: Array<[string, string[]]>
  summary: string
  rawResponse: string | null
}

const TOP_PER_TYPE = 5

export class HeuristicSynthesizer {
  name(): string {
    return 'dream.heuristic-synthesizer.v1'
  }

  synthesize(input: SynthesisInput): SynthesisResult {
    const selected = input.hits.map((h) => h.item)
    const byType = new Map<MT, MemoryItem[]>()
    for (const it of selected) {
      const arr = byType.get(it.type) ?? []
      arr.push(it)
      byType.set(it.type, arr)
    }
    const sections = []
    for (const [type, items] of byType) {
      const top = [...items].sort((a, b) => b.importance - a.importance).slice(0, TOP_PER_TYPE)
      sections.push({
        title: type[0]!.toUpperCase() + type.slice(1),
        body: top.map((i) => i.content).join('；'),
        items: top.map((i) => i.id),
        score: top.reduce((s, i) => s + i.importance, 0)
      })
    }
    const twin: UserDigitalTwin = {
      userId: input.userId,
      generatedAt: nowIso(),
      title: 'Dream 数字孪生',
      profile: sections.map((s) => s.body).join('；').slice(0, 600),
      buckets: sections.map((s) => ({
        type: s.title.toLowerCase() as MT,
        summary: s.body.slice(0, 400),
        items: s.items,
        lastUpdated: nowIso()
      })),
      sections,
      openGoals: selected.filter((i) => i.type === MT.GOAL).map((i) => i.content).slice(0, 10),
      activeProjects: selected.filter((i) => i.type === MT.PROJECT).map((i) => i.content).slice(0, 10),
      skills: selected.filter((i) => i.type === MT.SKILL).map((i) => i.content).slice(0, 10),
      preferences: selected.filter((i) => i.type === MT.PREFERENCE).map((i) => i.content).slice(0, 10),
      constraints: selected.filter((i) => i.type === MT.CONSTRAINT).map((i) => i.content).slice(0, 10),
      recentFacts: selected.filter((i) => i.type === MT.FACT).map((i) => i.content).slice(0, 10),
      metadata: { built_at: nowIso(), method: 'heuristic' }
    }
    return { twin, selected, merged: [], summary: twin.profile, rawResponse: null }
  }
}

const SYNTHESIS_SYSTEM = `你是一个「用户数字孪生」生成器。

任务：基于系统检索到的"记忆"和当前对话上下文，更新用户的 Digital Twin。
输出必须是合法 JSON，结构如下：

{
  "profile": "用一段话总结这个用户（150字内）",
  "sections": [{"title":"…","body":"…","items":[…]}],
  "open_goals": ["…"],
  "active_projects": ["…"],
  "skills": ["…"],
  "preferences": ["…"],
  "constraints": ["…"],
  "recent_facts": ["…"]
}

要求：
* 只输出 JSON，不要解释
* 出现的项目必须能在给定记忆中追溯到
* 已经过时的记忆内容应忽略
* 不要捏造不存在的信息`

type ChatFn = (msgs: { system: string; user: string }) => Promise<{ text: string }>

export class LlmSynthesizer {
  private readonly heuristic = new HeuristicSynthesizer()

  constructor(private readonly opts: { chat: ChatFn; model?: string }) {}

  name(): string {
    return `dream.llm-synthesizer[${this.opts.model ?? 'default'}]`
  }

  async synthesizeAsync(input: SynthesisInput): Promise<SynthesisResult> {
    const memText = input.hits.length
      ? input.hits.map((h) => `- id=${h.item.id} type=${h.item.type} content=${h.item.content}`).join('\n')
      : '(空)'
    const userPrompt = `[系统检索到的记忆]\n${memText}\n\n[最近对话]\n[USER] ${input.user}\n[ASSISTANT] ${input.assistant ?? ''}\n`
    let text = ''
    try {
      const resp = await this.opts.chat({ system: SYNTHESIS_SYSTEM, user: userPrompt })
      text = resp.text ?? ''
    } catch {
      return this.heuristic.synthesize(input)
    }
    const parsed = safeParseJson(text)
    if (!parsed) return this.heuristic.synthesize(input)

    const selected = input.hits.map((h) => h.item)
    const twin: UserDigitalTwin = {
      userId: input.userId,
      generatedAt: nowIso(),
      title: 'Dream 数字孪生',
      profile: str(parsed.profile) || this.heuristic.synthesize(input).twin.profile,
      buckets: [],
      sections: Array.isArray(parsed.sections) ? (parsed.sections as UserDigitalTwin['sections']) : [],
      openGoals: strArray(parsed.open_goals),
      activeProjects: strArray(parsed.active_projects),
      skills: strArray(parsed.skills),
      preferences: strArray(parsed.preferences),
      constraints: strArray(parsed.constraints),
      recentFacts: strArray(parsed.recent_facts),
      metadata: { built_at: nowIso(), method: 'llm' }
    }
    return { twin, selected, merged: [], summary: twin.profile, rawResponse: text }
  }
}

function safeParseJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
  const m = t.match(/\{[\s\S]*\}/)
  if (m) t = m[0]
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
}
