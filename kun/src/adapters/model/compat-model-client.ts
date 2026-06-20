/**
 * CompatModelClient - Compatibility HTTP model client.
 *
 * Stub implementation pending full port from upstream model client source.
 * The full implementation supports:
 * - OpenAI Chat Completions format
 * - Anthropic Messages format
 * - OpenAI Responses format
 * - DeepSeek-specific reasoning translation
 * - MiniMax-specific cost calculation
 * - Streaming with idle timeout
 * - Tool call accumulation
 * - Image inputs
 *
 * For the initial Teamflow Agent migration, this stub provides the
 * interface and basic structure. The full implementation should be
 * ported from the Teamflow Agent source code with naming replacement
 * (teamflow-agent).
 *
 * TODO: Port full implementation from Teamflow Agent upstream source
 */

import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../../ports/model-client.js'

export type CompatModelClientConfig = {
  baseUrl: string
  apiKey: string
  model: string
  endpointFormat?: string
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  modelProxyUrl?: string
  historyLimit?: number
  nonStreaming?: boolean
  streamIdleTimeoutMs?: number
  modelCapabilities?: (model: string) => unknown
  debugSink?: unknown
}

export class CompatModelClient implements ModelClient {
  readonly provider = 'teamflow-agent-compat'
  readonly model: string

  constructor(public readonly config: CompatModelClientConfig) {
    this.model = config.model
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    // Stub: returns an error chunk indicating implementation is incomplete
    yield {
      kind: 'error',
      message: 'CompatModelClient is a stub. Full implementation pending port from Teamflow Agent source.'
    }
    yield { kind: 'completed', stopReason: 'error' }
  }
}

export function createCompatModelClient(config: CompatModelClientConfig): CompatModelClient {
  return new CompatModelClient(config)
}