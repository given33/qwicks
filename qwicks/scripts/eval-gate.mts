#!/usr/bin/env node
/**
 * Batch H(spec §8.4):eval CI 门禁脚本。
 *
 * 加载完整 540 case 评估数据集 → 用真实 DreamMemorySystem 跑 runEval → 断言 Tier A 通过
 * (f1≥0.85, recall≥0.85, staleRate≤0.01)。不通过则非零退出(CI 红,阻止合并)。
 *
 * 用法:
 *   node --experimental-vm-modules scripts/eval-gate.mts [dataset-path]
 *
 * 运行前提:先 `npm run build`(脚本 import 编译后的 .js)。或在 dev 下用 tsx:
 *   npx tsx scripts/eval-gate.mts [dataset-path]
 *
 * 数据集缺失时(本仓库不含 540 case 二进制),脚本以 exit code 77 退出并打印
 * SKIP 提示 —— CI 应据此区分"数据未提供"与"门禁失败"。提供数据集后即可硬门禁。
 *
 * 镜像 src/dream/evaluation/dataset.test.ts 的 runTierC runner(Tier-A 版)。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'

async function main(): Promise<void> {
  const datasetPath = process.argv[2] ?? process.env.DREAM_EVAL_DATASET ?? ''
  if (!datasetPath) {
    console.log('[eval-gate] SKIP: no dataset path provided (set DREAM_EVAL_DATASET or pass as arg).')
    process.exit(0)
  }

  const [{ DreamMemorySystem }, { runEval }, { loadExternalDataset }] = await Promise.all([
    import('../dist/dream/chat/pipeline.js'),
    import('../dist/dream/evaluation/harness.js'),
    import('../dist/dream/evaluation/dataset.js')
  ])

  const cases = await loadExternalDataset(datasetPath)
  if (!cases || cases.length === 0) {
    console.log(`[eval-gate] SKIP: dataset at ${datasetPath} not found or empty.`)
    process.exit(0)
  }

  const dir = mkdtempSync(join(tmpdir(), 'dream-eval-gate-'))
  try {
    const sys = new DreamMemorySystem({ dataDir: dir, userId: 'eval-gate-user' })
    const report = await runEval(
      cases,
      async ({ case: evalCase }) => {
        for (const turn of evalCase.turns) {
          if (turn.role === 'user') await sys.chat(evalCase.userId, turn.content)
        }
        const result = await sys.chat(evalCase.userId, evalCase.query)
        return {
          reply: result.reply,
          routedHits: result.routedHits.map((h) => ({ item: { id: h.item.id, content: h.item.content }, score: h.score })),
          contextBlock: result.contextBlock,
          newMemories: result.newMemories,
          injectionDecision: result.injectionDecision,
          gateReport: result.gateReport
        }
      },
      'A'
    )
    sys.close()
    // Tier A 阈值:对齐 verification_tiers.md(f1≥0.85, recall≥0.85, staleRate≤0.01)
    const verdict = report.metrics.tierVerdict({ minF1: 0.85, minRecall: 0.85, maxStaleRate: 0.01 })
    console.log(
      `[eval-gate] tier=${report.tier} cases=${report.metrics.totalCases} ` +
        `f1=${report.metrics.f1.toFixed(3)} recall=${report.metrics.recall.toFixed(3)} ` +
        `staleRate=${report.metrics.staleInjectionRate.toFixed(3)} passed=${verdict.passed}`
    )
    if (!verdict.passed) {
      console.error(`[eval-gate] FAIL: Tier A gate not met: ${verdict.reasons.join('; ')}`)
      process.exit(1)
    }
    console.log('[eval-gate] PASS: Tier A gate met.')
    process.exit(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`[eval-gate] ERROR: ${String(err)}`)
  process.exit(2)
})
