/**
 * Dream 用户状态 / Digital Twin 构建器 —— 1:1 对齐 Python `dream/user_state/builder.py`。
 *
 * 策略:
 *  - 按 type 分桶,每桶取 importance 最高的前 topPerBucket 条
 *  - profile 是各桶 1 段话摘要(skills/goals/projects/prefs/facts)
 *  - skills/preferences/constraints/goals/projects/recentFacts 各自抽取
 *
 * R80 canonical trait lift(归纳稳定偏好)依赖 preference/lifter,属于质量增强;
 * 本 TS 实现先把主体 build 做好,canonical lift 留作后续增强(留 hook)。
 */
import { MemoryItem, MemoryType, MemoryType as MT, nowIso } from '../types.js'

export interface TwinSection {
  title: string
  body: string
  items: string[]
  score: number
}

export interface UserStateBucket {
  type: MemoryType
  summary: string
  items: string[]
  lastUpdated: string
}

/** RetrievalHit 的最小形态(只用到 item)。 */
export interface RetrievalHit {
  item: MemoryItem
  score?: number
}

export interface UserDigitalTwin {
  userId: string
  generatedAt: string
  title: string
  profile: string
  buckets: UserStateBucket[]
  sections: TwinSection[]
  openGoals: string[]
  activeProjects: string[]
  skills: string[]
  preferences: string[]
  constraints: string[]
  recentFacts: string[]
  metadata: Record<string, unknown>
}

export interface TwinBuilderOptions {
  topPerBucket?: number
}

export class TwinBuilder {
  private readonly topPerBucket: number

  constructor(opts: TwinBuilderOptions = {}) {
    this.topPerBucket = opts.topPerBucket ?? 5
  }

  build(opts: {
    userId: string
    memories?: MemoryItem[]
    hits?: RetrievalHit[]
  }): UserDigitalTwin {
    const items: MemoryItem[] = [...(opts.memories ?? [])]
    const seen = new Set(items.map((i) => i.id))
    for (const h of opts.hits ?? []) {
      if (!seen.has(h.item.id)) {
        items.push(h.item)
        seen.add(h.item.id)
      }
    }

    // 跳过 deleted/superseded
    const active = items.filter(
      (it) => !it.metadata.__deleted__ && !it.metadata.superseded_by
    )

    // 按 type 分桶
    const byType = new Map<MT, MemoryItem[]>()
    for (const it of active) {
      const arr = byType.get(it.type) ?? []
      arr.push(it)
      byType.set(it.type, arr)
    }

    const buckets: UserStateBucket[] = []
    const sections: TwinSection[] = []
    for (const [type, group] of byType) {
      const top = [...group]
        .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence)
        .slice(0, this.topPerBucket)
      const summary = top.map((it) => it.content).join('；')
      buckets.push({
        type,
        summary: summary.slice(0, 400),
        items: top.map((it) => it.id),
        lastUpdated: top.reduce((max, it) => (it.updatedAt > max ? it.updatedAt : max), nowIso())
      })
      sections.push({
        title: type[0]!.toUpperCase() + type.slice(1),
        body: summary,
        items: top.map((it) => it.id),
        score: top.reduce((s, it) => s + it.importance, 0)
      })
    }

    const skills = take(active, MT.SKILL, 10)
    const prefs = take(active, MT.PREFERENCE, 10)
    const constraints = take(active, MT.CONSTRAINT, 10)
    const goals = take(active, MT.GOAL, 10)
    const projects = take(active, MT.PROJECT, 10)
    const facts = take(active, MT.FACT, 10)

    const profile = this.composeProfile({ skills, goals, projects, prefs, facts })

    return {
      userId: opts.userId,
      generatedAt: nowIso(),
      title: 'Dream 数字孪生',
      profile,
      buckets,
      sections,
      openGoals: goals,
      activeProjects: projects,
      skills,
      preferences: prefs,
      constraints,
      recentFacts: facts,
      metadata: { built_at: nowIso(), item_count: items.length }
    }
  }

  private composeProfile(args: {
    skills: string[]
    goals: string[]
    projects: string[]
    prefs: string[]
    facts: string[]
  }): string {
    const parts: string[] = []
    if (args.skills.length > 0) parts.push('技能：' + args.skills.slice(0, 5).map((s) => s.slice(0, 30)).join('、'))
    if (args.goals.length > 0) parts.push('目标：' + args.goals.slice(0, 5).map((g) => g.slice(0, 30)).join('、'))
    if (args.projects.length > 0) parts.push('项目：' + args.projects.slice(0, 5).map((p) => p.slice(0, 30)).join('、'))
    if (args.prefs.length > 0) parts.push('偏好：' + args.prefs.slice(0, 5).map((p) => p.slice(0, 30)).join('、'))
    if (args.facts.length > 0) parts.push('近期事实：' + args.facts.slice(0, 3).map((f) => f.slice(0, 30)).join('、'))
    return parts.join('；').slice(0, 600)
  }
}

export interface TwinDict {
  user_id: string
  generated_at: string
  title: string
  profile: string
  buckets: unknown[]
  sections: unknown[]
  open_goals: string[]
  active_projects: string[]
  skills: string[]
  preferences: string[]
  constraints: string[]
  recent_facts: string[]
  metadata: Record<string, unknown>
}

export function twinToDict(t: UserDigitalTwin): TwinDict {
  return {
    user_id: t.userId,
    generated_at: t.generatedAt,
    title: t.title,
    profile: t.profile,
    buckets: t.buckets.map((b) => ({ type: b.type, summary: b.summary, items: b.items, last_updated: b.lastUpdated })),
    sections: t.sections,
    open_goals: t.openGoals,
    active_projects: t.activeProjects,
    skills: t.skills,
    preferences: t.preferences,
    constraints: t.constraints,
    recent_facts: t.recentFacts,
    metadata: t.metadata
  }
}

function take(items: MemoryItem[], type: MT, limit: number): string[] {
  return items.filter((it) => it.type === type).map((it) => it.content).slice(0, limit)
}
