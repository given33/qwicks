/**
 * v3(报告 §4.8/§9 P2-1):把 qwicks 的 ModelClient(stream-based)适配成
 * DreamMemorySystem 需要的 chat 函数:`(msgs) => Promise<{text}>`。
 *
 * 这样 LlmExtractor / LlmSynthesizer 在真实 runtime 里能用真实模型,
 * 而不是退化成 heuristic。
 *
 * ModelClient.stream 接收完整的 ModelRequest(threadId/turnId/prefix/history/tools)。
 * 对于 Dream 的无状态 extraction/synthesis 调用,我们构造一个最小请求:
 * 把 system 放进 systemPrompt,user 作为唯一的 history 项。
 */
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'

export interface DreamChatMessage {
  system: string
  user: string
}

export interface DreamChatResult {
  text: string
}

/** Batch H(spec §8.1):LLM 调用加固配置(超时/取消)。 */
export interface DreamChatOptions {
  /** 单次调用超时(ms),超时则中止并抛错(供上层 fail-open 到 heuristic)。 */
  timeoutMs?: number
  /** 外部取消信号(与 turn 取消同步:用户取消 turn → extraction 中止,不后台继续跑)。 */
  abortSignal?: AbortSignal
}

/**
 * 构造一个 chat 函数:收集 ModelClient.stream 的所有 assistant_text_delta,
 * 拼成完整文本返回。threadId/turnId 用 dream-internal 前缀(不与真实 turn 冲突)。
 *
 * Batch H:可选 timeoutMs / abortSignal —— 超时或外部取消时中止流,避免 extraction
 * 在用户已取消 turn 后仍在后台跑(资源泄露 + 误导)。
 */
export function adaptModelClientToDreamChat(
  modelClient: ModelClient,
  defaultOptions?: DreamChatOptions
): (msgs: DreamChatMessage, opts?: DreamChatOptions) => Promise<DreamChatResult> {
  return async (msgs: DreamChatMessage, opts?: DreamChatOptions): Promise<DreamChatResult> => {
    const timeoutMs = opts?.timeoutMs ?? defaultOptions?.timeoutMs
    const externalSignal = opts?.abortSignal ?? defaultOptions?.abortSignal
    // 合并外部 signal + 超时 signal:任一触发即中止。
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onExternalAbort = () => controller.abort()
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs)
    }
    try {
      const request = {
        threadId: 'dream-internal',
        turnId: `dream-${Date.now()}`,
        model: modelClient.model,
        systemPrompt: msgs.system,
        prefix: [],
        history: [
          {
            id: 'dream-user',
            turnId: 'dream-internal',
            threadId: 'dream-internal',
            role: 'user' as const,
            status: 'completed' as const,
            createdAt: new Date().toISOString(),
            kind: 'user_message' as const,
            text: msgs.user
          }
        ],
        tools: [],
        stream: true,
        abortSignal: controller.signal
      } satisfies ModelRequest
      let text = ''
      for await (const chunk of modelClient.stream(request)) {
        if (controller.signal.aborted) break
        if (chunk.kind === 'assistant_text_delta') {
          text += chunk.text
        } else if (chunk.kind === 'completed') {
          break
        }
      }
      return { text }
    } finally {
      if (timer) clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }
}
