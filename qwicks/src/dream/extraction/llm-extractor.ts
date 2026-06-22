/**
 * LlmExtractor —— 通过 OpenAI 兼容 chat completions 抽取记忆(对齐 Python Qwen3Extractor)。
 *
 * 决策:复用 qwicks compat-model-client 的同一种 OpenAI 兼容协议。这里不直接 import
 * CompatModelClient(避免 dream ↔ qwicks adapters 强耦合),而是接收一个 `chat` 函数注入,
 * 该函数签名跟 compat-model-client 的请求/响应形态一致(system+user → text)。
 * DreamMemorySystem 在 Phase 1g 编排时会用真实 CompatModelClient 适配出这个 chat 函数。
 *
 * 输出必须是合法 JSON 数组;解析失败返回 [](对齐 Python _parse 行为)。
 */
import {
  MemoryItemDraft,
  MemoryProvenance,
  MemoryType,
  parseMemoryType
} from '../types.js'
import type { AsyncExtractor, ExtractInput } from './base.js'

const SYSTEM_PROMPT = `你是一个「记忆提取器」。从用户/助手对话中抽取值得长期记住的事实，并以 JSON 数组输出。
类型只能是：goal, skill, project, preference, constraint, fact, episode, feedback
置信度 confidence ∈ [0,1]；重要度 importance ∈ [0,1]；tag 简短小写；scope 默认 user。

输出示例：
[{"type":"skill","content":"熟悉机器人路径规划 A*","importance":0.7,"confidence":0.92,"tags":["robotics","a-star"]}]`

export interface LlmChatMessage {
  system: string
  user: string
}

export type LlmChatFn = (msgs: LlmChatMessage) => Promise<{ text: string }>

export interface LlmExtractorOptions {
  chat: LlmChatFn
  /** 注入模型名(用于 provenance / name)。 */
  model?: string
}

export class LlmExtractor implements AsyncExtractor {
  constructor(private readonly opts: LlmExtractorOptions) {}

  name(): string {
    return `dream.llm-extractor[${this.opts.model ?? 'default'}]`
  }

  async extractAsync(input: ExtractInput): Promise<MemoryItemDraft[]> {
    const userPrompt = `\n[USER] ${input.user.trim()}\n[ASSISTANT] ${(input.assistant ?? '').trim()}\n`
    let text: string
    try {
      const resp = await this.opts.chat({ system: SYSTEM_PROMPT, user: userPrompt })
      text = resp.text ?? ''
    } catch {
      return []
    }
    return this.parse(text)
  }

  private parse(text: string): MemoryItemDraft[] {
    const raw = this.extractJsonArray(text)
    if (!raw) return []
    let arr: unknown
    try {
      arr = JSON.parse(raw)
    } catch {
      return []
    }
    if (!Array.isArray(arr)) return []
    const drafts: MemoryItemDraft[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      try {
        const type = parseMemoryType(String(r.type))
        drafts.push(
          new MemoryItemDraft(
            type,
            String(r.content),
            Array.isArray(r.tags) ? (r.tags as string[]) : [],
            typeof r.importance === 'number' ? r.importance : 0.5,
            typeof r.confidence === 'number' ? r.confidence : 0.7,
            undefined,
            new MemoryProvenance('model', null, null, null, typeof r.confidence === 'number' ? r.confidence : 0.7, this.opts.model),
            { method: 'llm' }
          )
        )
      } catch {
        // 单条解析失败跳过(对齐 Python 容错)
      }
    }
    return drafts
  }

  /** 从可能含解释文本的模型输出里抠出 JSON 数组。 */
  private extractJsonArray(text: string): string | null {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end < 0 || end <= start) return null
    return text.slice(start, end + 1)
  }
}
