/**
 * B14 Tier 1:characterization corpus —— 锁定 decideInjection 当前的**行为**
 * (shouldInject + 关键 reason/dimension),作为"rename risk→safety 零行为变化"的回归网。
 *
 * 这些 case 覆盖代表性查询空间:
 *   - safety-only / generic-impersonal / generic+代词 / explicit-trigger /
 *     normal-personal / explicit+safety / 含敏感词的正常查询
 *
 * 用法:rename 之前这个文件必须全绿(证明捕捉的是真行为);rename 之后(numbers 不动)
 * 仍必须全绿(证明零行为变化)。任何翻红的 case 就是被改动的行为。
 *
 * 注:Tier 3(safety 硬门)修复"explicit+safety 仍注入"的真 bug 不在本轮 —— 见
 * injection-decision.ts 注释。下面的 'explicit+safety' case 显式标注当前(有 bug 的)
 * 行为,方便 Tier 3 改它时知道哪一行要变。
 */
import { describe, expect, it } from 'vitest'
import { MemoryItem, MemoryProvenance, MemoryScope, MemoryType } from '../types.js'
import { decideInjection } from './injection-decision.js'

function mk(content: string): MemoryItem {
  return new MemoryItem('m', 'alice', MemoryType.FACT, content, MemoryScope.USER, [], 0.5, 0.7, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', null, new MemoryProvenance())
}

describe('decideInjection — characterization corpus (B14 Tier 1 regression net)', () => {
  it('safety-only query ("what is a firewall"): not injected', () => {
    const d = decideInjection({ query: 'what is a firewall', availableMemories: [] })
    expect(d.shouldInject).toBe(false)
    expect(d.score).toBeLessThan(0.35)
  })

  it('generic-impersonal query ("how to use docker", irrelevant memory): NOT injected (isGenericImpersonal override)', () => {
    const d = decideInjection({ query: 'how to use docker', availableMemories: [mk('postgres thing')] })
    expect(d.shouldInject).toBe(false)
  })

  it('generic + personal pronoun ("how do i configure nginx", weak memory): INJECTED (pronoun saves it)', () => {
    const d = decideInjection({ query: 'how do i configure nginx', availableMemories: [mk('nginx thing')] })
    expect(d.shouldInject).toBe(true)
  })

  it('explicit memory trigger ("use my memory to remind me"): INJECTED, explicit flag set', () => {
    const d = decideInjection({ query: 'use my memory to remind me', availableMemories: [mk('my projects')] })
    expect(d.shouldInject).toBe(true)
    expect(d.explicitMemoryTrigger).toBe(true)
  })

  it('normal-personal query ("my project is failing", no memory): INJECTED', () => {
    const d = decideInjection({ query: 'my project is failing', availableMemories: [] })
    expect(d.shouldInject).toBe(true)
  })

  // KNOWN BUG (B14 Tier 3, out of scope): explicit trigger + safety context still injects.
  // This case pins the current (buggy) behavior. When Tier 3 adds a safety hard-gate,
  // this assertion flips to shouldInject=false — that's the intended behavior change.
  it('explicit-trigger + safety context ("based on what you know what is my password"): CURRENTLY injected (Tier 3 bug, pinned)', () => {
    const d = decideInjection({ query: 'based on what you know what is my password', availableMemories: [mk('password is x')] })
    expect(d.shouldInject).toBe(true)
    expect(d.explicitMemoryTrigger).toBe(true)
    // risk/safety dimension is LOW for safety context (0.1) — rename target asserts on behavior
    expect(d.reason).toContain('safety_suppress')
  })

  it('normal query containing a sensitive word ("how to configure an api key", no memory): NOT injected', () => {
    const d = decideInjection({ query: 'how to configure an api key', availableMemories: [] })
    expect(d.shouldInject).toBe(false)
  })
})
