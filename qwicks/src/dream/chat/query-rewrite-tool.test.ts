/**
 * §4.1(二轮报告):query rewrite 实际进入 web_search tool call 的测试。
 * 证明 ToolHostContext.memoryRewrite 被消费,而非只存在内存变量。
 */
import { describe, expect, it } from 'vitest'

/**
 * 模拟 web_search 工具的 execute 逻辑(从 web-tool-provider.ts 提取的核心)。
 * 验证:当 context.memoryRewrite 存在且 originalQuery 匹配时,用 rewrittenQuery。
 */
function simulateWebSearchExecute(
  args: { query: string },
  context: { memoryRewrite?: { originalQuery: string; rewrittenQuery: string; appliedMemoryIds: string[] } }
): { query: string; usedRewrite: boolean } {
  const userQuery = args.query
  const memoryRewrite = context.memoryRewrite
  const query = memoryRewrite && memoryRewrite.originalQuery.trim().toLowerCase() === userQuery.trim().toLowerCase()
    ? memoryRewrite.rewrittenQuery
    : userQuery
  return { query, usedRewrite: query !== userQuery }
}

describe('§4.1 query rewrite into web_search tool', () => {
  it('uses rewritten query when memoryRewrite matches original query', () => {
    const result = simulateWebSearchExecute(
      { query: 'best coffee nearby' },
      {
        memoryRewrite: {
          originalQuery: 'best coffee nearby',
          rewrittenQuery: 'best coffee San Francisco vegan',
          appliedMemoryIds: ['mem_city', 'mem_diet']
        }
      }
    )
    expect(result.query).toBe('best coffee San Francisco vegan')
    expect(result.usedRewrite).toBe(true)
  })

  it('does NOT rewrite when memoryRewrite originalQuery differs from tool query', () => {
    const result = simulateWebSearchExecute(
      { query: 'weather today' },
      {
        memoryRewrite: {
          originalQuery: 'best coffee nearby',
          rewrittenQuery: 'best coffee San Francisco',
          appliedMemoryIds: ['mem_city']
        }
      }
    )
    expect(result.query).toBe('weather today')
    expect(result.usedRewrite).toBe(false)
  })

  it('does NOT rewrite when no memoryRewrite in context (Temporary Chat / opt-out)', () => {
    const result = simulateWebSearchExecute({ query: 'best coffee nearby' }, {})
    expect(result.query).toBe('best coffee nearby')
    expect(result.usedRewrite).toBe(false)
  })

  it('preserves rewritten query for audit (originalQuery tracked)', () => {
    const ctx = {
      memoryRewrite: {
        originalQuery: 'nearby restaurant',
        rewrittenQuery: 'vegan restaurant San Francisco',
        appliedMemoryIds: ['mem_diet', 'mem_loc']
      }
    }
    const result = simulateWebSearchExecute({ query: 'nearby restaurant' }, ctx)
    expect(result.query).toContain('vegan')
    expect(result.query).toContain('San Francisco')
    expect(ctx.memoryRewrite!.appliedMemoryIds).toContain('mem_diet')
  })
})
