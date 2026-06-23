/**
 * 代表性评测 case 集 —— 覆盖文档 §7.5 的 5 个评测维度(延续上下文 / 遵循偏好 /
 * 时间更新 / 来源可解释 / 删除一致性)。Tier-C 规模(可快速跑通,验证不回归)。
 *
 * 完整 540 case(对齐 Python evaluation/)可通过 loadExternalDataset() 从外部加载;
 * 这里内置一个代表性子集保证 CI 可跑。
 */
import type { EvalCase } from './harness.js'

export const representativeCases: EvalCase[] = [
  // ---- 维度 1:延续上下文(carry_forward)----
  {
    id: 'cf-1',
    userId: 'eval-user',
    category: 'carry_forward',
    turns: [{ role: 'user', content: 'I am skilled in Rust and prefer it for systems programming.' }],
    query: 'what programming skills do I have',
    goldKeywords: ['rust'],
    negativeKeywords: [],
    expectNoInjection: false
  },
  {
    id: 'cf-2',
    userId: 'eval-user',
    category: 'carry_forward',
    turns: [{ role: 'user', content: 'My main project is building a desktop app called teamflow.' }],
    query: 'tell me about my current project',
    goldKeywords: ['teamflow'],
    negativeKeywords: [],
    expectNoInjection: false
  },

  // ---- 维度 2:遵循偏好(follow_preference)----
  {
    id: 'fp-1',
    userId: 'eval-user',
    category: 'follow_preference',
    turns: [{ role: 'user', content: 'I prefer concise answers without any fluff.' }],
    query: 'how should you answer my questions',
    goldKeywords: ['concise'],
    negativeKeywords: [],
    expectNoInjection: false
  },
  {
    id: 'fp-2',
    userId: 'eval-user',
    category: 'follow_preference',
    turns: [{ role: 'user', content: 'I always want source-backed answers with citations.' }],
    query: 'what is my preferred answer style',
    goldKeywords: ['source'],
    negativeKeywords: [],
    expectNoInjection: false
  },

  // ---- 维度 3:时间更新(freshness)----
  {
    id: 'fr-1',
    userId: 'eval-user',
    category: 'freshness',
    turns: [{ role: 'user', content: 'My goal is to ship the dream system by Q3.' }],
    query: 'what is my goal',
    goldKeywords: ['dream', 'q3'],
    negativeKeywords: [],
    expectNoInjection: false
  },

  // ---- 维度 4:来源可解释(source_explain)----
  {
    id: 'se-1',
    userId: 'eval-user',
    category: 'source_explain',
    turns: [{ role: 'user', content: 'I prefer dark mode for all my editors.' }],
    query: 'what do you know about my editor preferences',
    goldKeywords: ['dark'],
    negativeKeywords: [],
    expectNoInjection: false
  },

  // ---- 维度 5:删除一致性 / 不过度个性化(deletion_consistency / over_personalize)----
  {
    id: 'dc-1',
    userId: 'eval-user',
    category: 'deletion_consistency',
    turns: [{ role: 'user', content: 'I prefer concise answers.' }],
    query: 'how to use Python decorators',
    goldKeywords: [],
    negativeKeywords: [],
    expectNoInjection: true // 通用问题不应注入个人偏好
  }
]

/**
 * 从外部 JSON 加载完整 540-case dataset(对齐 Python synthetic_logs/realistic_540)。
 * 格式:EvalCase[]。文件不存在时返回 null(调用方决定 fallback)。
 */
export async function loadExternalDataset(path: string): Promise<EvalCase[] | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(path, 'utf8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data as EvalCase[]
    return null
  } catch {
    return null
  }
}
