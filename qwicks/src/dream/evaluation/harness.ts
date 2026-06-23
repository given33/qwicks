/**
 * Dream 评估 harness —— 1:1 对齐 Python `dream/evaluation/` + `docs/verification_tiers.md`。
 *
 * - evaluateCase:跑单条 eval case,比对 reply/contextBlock 与 gold/negative 关键词,
 *   产出 tp/fp/fn/staleInjection。
 * - computeMetrics:聚合 case reports,算 precision/recall/f1/staleInjectionRate。
 * - tierVerdict:对照 Tier A/B/C 阈值(f1≥0.85, recall≥0.85, staleRate≤0.01)给 PASS/FAIL。
 *
 * 一个 eval case = 多轮对话(seed 记忆)+ 一个 query + gold/negative 关键词 + 是否期望不注入。
 * runner(注入)负责实际跑 dream pipeline;harness 只做评分。
 */
export interface EvalTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface EvalCase {
  id: string
  userId: string
  /** carry_forward / follow_preference / freshness / over_personalize / redteam / source_explain */
  category: string
  /** seed turns(先跑这些把记忆灌进去)。 */
  turns: EvalTurn[]
  /** 评估用的 query。 */
  query: string
  /** 期望 reply/contextBlock 命中的关键词(命中 = TP)。 */
  goldKeywords: string[]
  /** 不应出现的关键词(出现 = FP,过度个性化)。 */
  negativeKeywords: string[]
  /** 若 true,期望 routedHits/contextBlock 为空(generic 问题不应注入个人记忆)。 */
  expectNoInjection: boolean
}

export interface CaseResult {
  caseId: string
  tp: number
  fp: number
  fn: number
  staleInjection: number
}

export interface CaseRunOutput {
  reply: string
  routedHits: Array<{ item: { id: string; content: string }; score: number }>
  contextBlock: string
  newMemories: unknown[]
  injectionDecision: unknown
  gateReport: unknown
}

/** 注入的 runner:实际跑 dream pipeline,返回 CaseRunOutput。 */
export type EvalRunner = (ctx: { case: EvalCase }) => Promise<CaseRunOutput>

function normalize(text: string): string {
  return text.toLowerCase()
}

export async function evaluateCase(evalCase: EvalCase, runner: EvalRunner): Promise<CaseResult> {
  const out = await runner({ case: evalCase })
  const haystack = normalize(`${out.reply} ${out.contextBlock}`)
  let tp = 0
  let fp = 0
  let fn = 0

  // gold keyword 命中 → TP;全部 miss → FN
  const goldHits = evalCase.goldKeywords.filter((k) => haystack.includes(normalize(k)))
  if (evalCase.goldKeywords.length > 0) {
    if (goldHits.length > 0) tp = 1
    else fn = 1
  }

  // negative keyword 命中 → FP(过度个性化 / 不该注入的出现了)
  const negHits = evalCase.negativeKeywords.filter((k) => haystack.includes(normalize(k)))
  if (negHits.length > 0) fp = 1

  // stale injection:期望不注入但实际注入了(routedHits 非空 或 contextBlock 非空)
  let staleInjection = 0
  if (evalCase.expectNoInjection) {
    const injected = out.routedHits.length > 0 || out.contextBlock.trim().length > 0
    if (injected) staleInjection = 1
  }

  return { caseId: evalCase.id, tp, fp, fn, staleInjection }
}

export interface MetricsResult {
  totalCases: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  staleInjectionRate: number
  tierVerdict: (thresholds: { minF1: number; minRecall: number; maxStaleRate: number }) => {
    passed: boolean
    reasons: string[]
  }
}

export function computeMetrics(cases: CaseResult[]): MetricsResult {
  const totalCases = cases.length
  const tp = cases.reduce((s, c) => s + c.tp, 0)
  const fp = cases.reduce((s, c) => s + c.fp, 0)
  const fn = cases.reduce((s, c) => s + c.fn, 0)
  const staleTotal = cases.reduce((s, c) => s + c.staleInjection, 0)
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const staleInjectionRate = totalCases > 0 ? staleTotal / totalCases : 0

  return {
    totalCases,
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    staleInjectionRate,
    tierVerdict(thresholds) {
      const reasons: string[] = []
      if (f1 < thresholds.minF1) reasons.push(`f1=${f1.toFixed(3)} < ${thresholds.minF1}`)
      if (recall < thresholds.minRecall) reasons.push(`recall=${recall.toFixed(3)} < ${thresholds.minRecall}`)
      if (staleInjectionRate > thresholds.maxStaleRate) reasons.push(`staleRate=${staleInjectionRate.toFixed(3)} > ${thresholds.maxStaleRate}`)
      return { passed: reasons.length === 0, reasons }
    }
  }
}

export interface EvalReport {
  tier: 'A' | 'B' | 'C'
  cases: CaseResult[]
  metrics: MetricsResult
  verdict: { passed: boolean; reasons: string[] }
  generatedAt: string
}

/** 跑完整 eval set,产出 EvalReport(对照 Tier 阈值)。 */
export async function runEval(
  cases: readonly EvalCase[],
  runner: EvalRunner,
  tier: 'A' | 'B' | 'C'
): Promise<EvalReport> {
  // Tier 阈值(对齐 verification_tiers.md)
  const thresholds = { minF1: 0.85, minRecall: 0.85, maxStaleRate: 0.01 }
  const results: CaseResult[] = []
  for (const c of cases) {
    results.push(await evaluateCase(c, runner))
  }
  const metrics = computeMetrics(results)
  const verdict = metrics.tierVerdict(thresholds)
  return {
    tier,
    cases: results,
    metrics,
    verdict,
    generatedAt: new Date().toISOString()
  }
}
