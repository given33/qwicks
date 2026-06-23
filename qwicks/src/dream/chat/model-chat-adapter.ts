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

/**
 * 构造一个 chat 函数:收集 ModelClient.stream 的所有 assistant_text_delta,
 * 拼成完整文本返回。threadId/turnId 用 dream-internal 前缀(不与真实 turn 冲突)。
 */
export function adaptModelClientToDreamChat(modelClient: ModelClient): (msgs: DreamChatMessage) => Promise<DreamChatResult> {
  return async (msgs: DreamChatMessage): Promise<DreamChatResult> => {
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
      abortSignal: new AbortController().signal
    } satisfies ModelRequest
    let text = ''
    for await (const chunk of modelClient.stream(request)) {
      if (chunk.kind === 'assistant_text_delta') {
        text += chunk.text
      } else if (chunk.kind === 'completed') {
        break
      }
    }
    return { text }
  }
}
