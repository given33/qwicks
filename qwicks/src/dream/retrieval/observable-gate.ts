/**
 * ObservableGate —— 可观测决策系统(1:1 对齐 Python `dream/retrieval/observable_gate.py`)。
 *
 * 把 judicious / freshness / user_correction 三个 gate orchestrate 起来,每条 candidate
 * 产出 ObservableDecision(score_before/after、demote/boost、reason、features、
 * gates_passed/failed),汇总成 GateReport。接收 user_correction 反馈,后续 gate 主动 demote。
 *
 * 决策分类:score_after ≤ 0.05 → suppress;demote<0 → demote;否则 allow。
 */
import type { MemoryItem, MemoryLifecycleStatus } from '../types.js'
import { MemoryLifecycleStatus as Status } from '../types.js'
import { detectGenericQuestion } from './judicious.js'

export interface RetrievalCandidate {
  item: MemoryItem
  score: number
}

export interface ObservableDecision {
  memoryId: string
  scoreBefore: number
  scoreAfter: number
  demote: number
  boost: number
  finalDecision: 'allow' | 'demote' | 'suppress'
  reason: string
  source: string
  features: Record<string, unknown>
  gatesPassed: string[]
  gatesFailed: string[]
}

export interface GateReport {
  userId: string
  query: string
  generatedAt: string
  candidateCount: number
  allowedCount: number
  demotedCount: number
  suppressedCount: number
  decisions: ObservableDecision[]
  reasonCounts: Record<string, number>
  sourceCounts: Record<string, number>
  userCorrectionCount: number
}

export interface UserCorrection {
  userId: string
  memoryId: string
  /** irrelevant / outdated / wrong / duplicate / sensitive */
  kind: string
  feedback: string
  recordedAt: string
}

export interface GateDecideInput {
  candidate: RetrievalCandidate
  query: string
  userId: string
  allUserItems?: MemoryItem[]
  userCorrections?: UserCorrection[]
}

export interface Gate {
  readonly name: string
  decide(input: GateDecideInput): ObservableDecision
}

function baseDecision(candidate: RetrievalCandidate): ObservableDecision {
  return {
    memoryId: candidate.item.id,
    scoreBefore: candidate.score,
    scoreAfter: candidate.score,
    demote: 0,
    boost: 0,
    finalDecision: 'allow',
    reason: '',
    source: '',
    features: {},
    gatesPassed: [],
    gatesFailed: []
  }
}

/** 对通用问题 demote personal history memory(对齐 Python JudiciousDemoteGate)。 */
export class JudiciousDemoteGate implements Gate {
  readonly name = 'judicious'
  constructor(private readonly demoteValue: number = -0.1) {}
  decide(input: GateDecideInput): ObservableDecision {
    const dec = detectGenericQuestion(input.query)
    const features = { is_generic: dec.isGeneric, generic_reason: dec.genericReason, personal_keywords_to_demote: dec.personalKeywordsToDemote }
    // 对齐 Python:gate 用构造传入的 demote 值,不是 applyJudiciousDemote 的固定 -0.15。
    const out = baseDecision(input.candidate)
    out.features = features
    out.source = this.name
    if (!dec.isGeneric) {
      out.reason = 'not_generic'
      out.gatesPassed = [this.name]
      return out
    }
    out.demote = this.demoteValue
    out.scoreAfter = out.scoreBefore + this.demoteValue
    out.reason = `judicious:generic:${dec.genericReason}`
    out.gatesFailed = [this.name]
    return out
  }
}

/** 对 superseded 旧值 demote,对 correction 新值 boost(对齐 Python FreshnessBoostGate)。 */
export class FreshnessBoostGate implements Gate {
  readonly name = 'freshness'
  constructor(private readonly demoteValue: number = -0.2, private readonly boostValue: number = 0.1) {}
  decide(input: GateDecideInput): ObservableDecision {
    const item = input.candidate.item
    const md = item.metadata ?? {}
    const out = baseDecision(input.candidate)
    out.source = this.name
    const isSuperseded = md.explicit_correction === true && (input.allUserItems ?? []).some((it) => it.status === Status.SUPERSEDED)
    if (isSuperseded) {
      out.demote = this.demoteValue
      out.scoreAfter = out.scoreBefore + this.demoteValue
      out.reason = 'freshness:superseded_chain'
      out.features = { is_superseded: true }
      out.gatesFailed = [this.name]
      return out
    }
    if (md.explicit_correction === true && md.corrected_to) {
      out.boost = this.boostValue
      out.scoreAfter = out.scoreBefore + this.boostValue
      out.reason = 'freshness:corrected_new_value'
      out.features = { explicit_correction: true, corrected_to: md.corrected_to }
      out.gatesPassed = [this.name]
      return out
    }
    out.reason = 'freshness:neutral'
    out.gatesPassed = [this.name]
    return out
  }
}

/** 根据 user_correction 反馈给同 kind 的 candidate demote(对齐 Python UserCorrectionGate)。 */
export class UserCorrectionGate implements Gate {
  readonly name = 'user_correction'
  constructor(private readonly demoteValue: number = -0.3) {}
  decide(input: GateDecideInput): ObservableDecision {
    const out = baseDecision(input.candidate)
    out.source = this.name
    const corrections = input.userCorrections ?? []
    if (corrections.length === 0) {
      out.reason = 'user_correction:none'
      out.features = { corrections_seen: 0 }
      out.gatesPassed = [this.name]
      return out
    }
    const md = input.candidate.item.metadata ?? {}
    const itemKind = (md.kind as string) ?? (md.category as string) ?? ''
    const matched = corrections.filter((c) => c.userId === input.userId && (!itemKind || c.kind === itemKind || c.kind === 'irrelevant'))
    if (matched.length > 0) {
      out.demote = this.demoteValue
      out.scoreAfter = out.scoreBefore + this.demoteValue
      out.reason = `user_correction:matched:${matched.length}`
      out.features = { matched_corrections: matched.length, item_kind: itemKind }
      out.gatesFailed = [this.name]
    } else {
      out.reason = 'user_correction:no_match'
      out.features = { matched_corrections: 0 }
      out.gatesPassed = [this.name]
    }
    return out
  }
}

export class ObservableGate {
  private readonly gates: Gate[] = []
  private readonly corrections: UserCorrection[] = []

  add(gate: Gate): this {
    this.gates.push(gate)
    return this
  }

  recordCorrection(correction: UserCorrection): void {
    this.corrections.push(correction)
  }

  getCorrections(userId?: string): UserCorrection[] {
    return userId ? this.corrections.filter((c) => c.userId === userId) : [...this.corrections]
  }

  run(opts: {
    userId: string
    query: string
    candidates: Iterable<RetrievalCandidate>
    allUserItems?: MemoryItem[]
    userCorrections?: UserCorrection[]
  }): GateReport {
    const corrections = opts.userCorrections ?? this.getCorrections(opts.userId)
    const report: GateReport = {
      userId: opts.userId,
      query: opts.query,
      generatedAt: new Date().toISOString(),
      candidateCount: 0,
      allowedCount: 0,
      demotedCount: 0,
      suppressedCount: 0,
      decisions: [],
      reasonCounts: {},
      sourceCounts: {},
      userCorrectionCount: corrections.length
    }
    for (const cand of opts.candidates) {
      const aggregate: ObservableDecision = {
        memoryId: cand.item.id,
        scoreBefore: cand.score,
        scoreAfter: cand.score,
        demote: 0,
        boost: 0,
        finalDecision: 'allow',
        reason: '',
        source: '',
        features: {},
        gatesPassed: [],
        gatesFailed: []
      }
      for (const gate of this.gates) {
        const d = gate.decide({
          candidate: cand,
          query: opts.query,
          userId: opts.userId,
          allUserItems: opts.allUserItems,
          userCorrections: corrections
        })
        aggregate.demote += d.demote
        aggregate.boost += d.boost
        aggregate.scoreAfter += d.demote + d.boost
        for (const gp of d.gatesPassed) if (!aggregate.gatesPassed.includes(gp)) aggregate.gatesPassed.push(gp)
        for (const gf of d.gatesFailed) if (!aggregate.gatesFailed.includes(gf)) aggregate.gatesFailed.push(gf)
        if (d.reason && d.reason !== `${d.source}:neutral` && d.reason !== `${d.source}:none`) {
          aggregate.reason = aggregate.reason ? `${aggregate.reason} | ${d.reason}` : d.reason
        }
        for (const [k, v] of Object.entries(d.features)) aggregate.features[`${d.source}.${k}`] = v
        if (d.source) aggregate.source = d.source
      }
      if (aggregate.scoreAfter <= 0.05) {
        aggregate.finalDecision = 'suppress'
        report.suppressedCount += 1
      } else if (aggregate.demote < 0) {
        aggregate.finalDecision = 'demote'
        report.demotedCount += 1
      } else {
        aggregate.finalDecision = 'allow'
        report.allowedCount += 1
      }
      if (aggregate.reason) report.reasonCounts[aggregate.reason] = (report.reasonCounts[aggregate.reason] ?? 0) + 1
      if (aggregate.source) report.sourceCounts[aggregate.source] = (report.sourceCounts[aggregate.source] ?? 0) + 1
      report.decisions.push(aggregate)
    }
    report.candidateCount = report.decisions.length
    return report
  }
}

export type { MemoryLifecycleStatus }
