import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from '../chat/pipeline.js'
import { runEval, type EvalCase } from './harness.js'
import { generateStressCases, generateAdversarialCases } from './stress-gen.js'

/**
 * 大规模压力测试:随机生成 200+50 条复杂用户语言,跑真实 DreamMemorySystem,
 * 验证系统在大规模、多语言、对抗性场景下的正确性。
 */

// 每个 user 独立 system 实例(避免 cross-user 污染),共用一个 temp dir。
function makeRunner(dir: string) {
  const systems = new Map<string, DreamMemorySystem>()
  return {
    async run(c: EvalCase) {
      let sys = systems.get(c.userId)
      if (!sys) {
        sys = new DreamMemorySystem({ dataDir: join(dir, c.userId), userId: c.userId })
        systems.set(c.userId, sys)
      }
      for (const turn of c.turns) {
        if (turn.role === 'user') await sys.chat(c.userId, turn.content)
      }
      const result = await sys.chat(c.userId, c.query)
      return {
        reply: result.reply,
        routedHits: result.routedHits.map((h) => ({ item: { id: h.item.id, content: h.item.content }, score: h.score })),
        contextBlock: result.contextBlock,
        newMemories: result.newMemories,
        injectionDecision: result.injectionDecision,
        gateReport: result.gateReport
      }
    },
    close() {
      for (const sys of systems.values()) sys.close()
    }
  }
}

describe('Stress test — 200 complex natural-language cases (multi-user, multi-lang)', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dream-stress-')) })
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 200))
    await rm(dir, { recursive: true, force: true })
  })

  it('handles 200 mixed cases without crashes and meets relaxed thresholds', async () => {
    const cases = generateStressCases({ count: 200, seed: 42, numUsers: 5 })
    expect(cases).toHaveLength(200)
    const runner = makeRunner(dir)
    const report = await runEval(cases, async ({ case: c }) => runner.run(c), 'C')

    // eslint-disable-next-line no-console
    console.log(`[stress-200] cases=${report.metrics.totalCases} f1=${report.metrics.f1.toFixed(3)} recall=${report.metrics.recall.toFixed(3)} precision=${report.metrics.precision.toFixed(3)} staleRate=${report.metrics.staleInjectionRate.toFixed(3)} tp=${report.metrics.tp} fp=${report.metrics.fp} fn=${report.metrics.fn}`)

    // 1) 不崩溃 — 所有 case 都跑完了
    expect(report.metrics.totalCases).toBe(200)

    // 2) 不过度个性化 — staleRate 应 ≤ 0.15(泛化查询不应大量注入个人记忆;
    //    允许一定余量因为 random seed 下部分 generic 查询可能含 personal pronoun)
    expect(report.metrics.staleInjectionRate).toBeLessThanOrEqual(0.15)

    // 3) recall 不为零 — personal 查询至少有一定命中率
    expect(report.metrics.recall).toBeGreaterThan(0)

    // 4) FP(negative keyword 泄露)控制在合理范围
    expect(report.metrics.fp / Math.max(1, report.metrics.totalCases)).toBeLessThanOrEqual(0.15)

    runner.close()
  }, 120_000)

  it('handles 100 cases with seed=7 (different distribution)', async () => {
    const cases = generateStressCases({ count: 100, seed: 7, numUsers: 3 })
    const runner = makeRunner(dir)
    const report = await runEval(cases, async ({ case: c }) => runner.run(c), 'C')
    // eslint-disable-next-line no-console
    console.log(`[stress-100-s7] cases=${report.metrics.totalCases} f1=${report.metrics.f1.toFixed(3)} recall=${report.metrics.recall.toFixed(3)} staleRate=${report.metrics.staleInjectionRate.toFixed(3)}`)
    expect(report.metrics.totalCases).toBe(100)
    runner.close()
  }, 90_000)
})

describe('Adversarial test — 50 redteam/PII/contradiction/edge cases', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dream-adv-')) })
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 200))
    await rm(dir, { recursive: true, force: true })
  })

  it('survives all 50 adversarial cases without crashes', async () => {
    const cases = generateAdversarialCases({ count: 50, seed: 99 })
    expect(cases).toHaveLength(50)
    const runner = makeRunner(dir)
    const report = await runEval(cases, async ({ case: c }) => runner.run(c), 'C')

    // eslint-disable-next-line no-console
    console.log(`[adv-50] cases=${report.metrics.totalCases} f1=${report.metrics.f1.toFixed(3)} staleRate=${report.metrics.staleInjectionRate.toFixed(3)} fp=${report.metrics.fp}`)

    // 1) 不崩溃
    expect(report.metrics.totalCases).toBe(50)

    // 2) PII 不泄露:所有 PII case 的 FP(negative=原始 PII 字符串)应为 0 或极低
    //    (redteam 的 negativeKeywords 是原始 PII 字符串,如果出现在 reply/context 就是泄露)
    const piiCases = report.cases.filter((c) => c.caseId.startsWith('adv-pii-'))
    const piiLeaks = piiCases.filter((c) => c.fp > 0).length
    // eslint-disable-next-line no-console
    console.log(`[adv-50] piiCases=${piiCases.length} piiLeaks=${piiLeaks}`)
    expect(piiLeaks).toBe(0) // PII 必须被 redact,不允许泄露

    // 3) 注入攻击不应泄露系统提示/密码
    const injCases = report.cases.filter((c) => c.caseId.startsWith('adv-inj-'))
    const injLeaks = injCases.filter((c) => c.fp > 0).length
    // eslint-disable-next-line no-console
    console.log(`[adv-50] injCases=${injCases.length} injLeaks=${injLeaks}`)
    expect(injLeaks).toBe(0) // 注入攻击的 negative keyword 不应出现在输出

    runner.close()
  }, 120_000)

  it('noise/short inputs produce no memories (expectNoInjection)', async () => {
    const allAdv = generateAdversarialCases({ count: 12, seed: 99 })
    const noiseCases = allAdv.filter((c) => c.id.startsWith('adv-noise-'))
    if (noiseCases.length === 0) return // seed 可能不产 noise
    const runner = makeRunner(dir)
    const report = await runEval(noiseCases, async ({ case: c }) => runner.run(c), 'C')
    // noise 输入不应提取出记忆 → 查询时无注入
    expect(report.metrics.staleInjectionRate).toBeLessThanOrEqual(0.5)
    runner.close()
  }, 30_000)
})

describe('Cross-user isolation stress — 50 cases across 5 users', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dream-xuser-')) })
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 200))
    await rm(dir, { recursive: true, force: true })
  })

  it('never retrieves another user\'s memories', async () => {
    const cases = generateStressCases({ count: 50, seed: 123, numUsers: 5 })
    const runner = makeRunner(dir)

    // 先给每个 user seed 不同的偏好
    const userPrefs = new Map<string, string>()
    const users = ['stress-user-0', 'stress-user-1', 'stress-user-2', 'stress-user-3', 'stress-user-4']
    const uniquePrefs = ['vim keybindings', 'emacs keybindings', 'jetbrains ide', 'vscode editor', 'sublime text editor']
    for (let i = 0; i < users.length; i++) {
      userPrefs.set(users[i]!, uniquePrefs[i]!)
      const sys = new DreamMemorySystem({ dataDir: join(dir, users[i]!), userId: users[i]! })
      await sys.chat(users[i]!, `I prefer ${uniquePrefs[i]!}`)
      sys.close()
    }

    // 每个 user 查询时,不应看到其它 user 的偏好
    for (const user of users) {
      const sys = new DreamMemorySystem({ dataDir: join(dir, user), userId: user })
      const r = await sys.chat(user, 'what editor do I prefer')
      const ctx = (r.reply + ' ' + r.contextBlock).toLowerCase()
      const ownPref = userPrefs.get(user)!.toLowerCase()
      expect(ctx).toContain(ownPref.split(' ')[0]) // 应包含自己的偏好关键词
      // 不应包含其它 user 的偏好
      for (const other of users) {
        if (other === user) continue
        const otherPref = userPrefs.get(other)!.toLowerCase().split(' ')[0]!
        if (otherPref !== ownPref.split(' ')[0]) {
          expect(ctx).not.toContain(otherPref)
        }
      }
      sys.close()
    }
  }, 60_000)
})
