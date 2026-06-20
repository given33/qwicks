import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

/**
 * Routes a streaming model request to a per-`providerId` `ModelClient`.
 *
 * The runtime spins up one default client (the GUI's configured
 * Teamflow Agent runtime provider) plus an optional map of extra clients
 * — one per provider the GUI has credentials for. When a `ModelRequest`
 * carries a `providerId` matching an entry in the map, that entry's
 * client handles the stream; otherwise the default client runs
 * (preserving single-provider behavior).
 */
export class MultiProviderModelClient implements ModelClient {
  readonly provider = 'teamflow-agent-multi'
  readonly model: string

  private readonly default_: ModelClient
  private readonly providers: Map<string, ModelClient>

  constructor(input: { default: ModelClient; providers?: Map<string, ModelClient> }) {
    this.default_ = input.default
    this.providers = input.providers ?? new Map()
    this.model = input.default.model
  }

  /**
   * Pick the client for this request's `providerId` (case-insensitive,
   * trimmed); fall back to the default client when the id is missing or
   * unknown.
   */
  resolve(providerId?: string): ModelClient {
    const trimmed = providerId?.trim()
    if (!trimmed) return this.default_
    return this.providers.get(trimmed) ?? this.default_
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    return this.resolve(request.providerId).stream(request)
  }

  /**
   * Exposes the default client's HTTP config (baseUrl, endpointFormat,
   * model) for the loop's diagnostic logging.
   */
  get config(): unknown {
    return (this.default_ as { config?: unknown }).config
  }
}