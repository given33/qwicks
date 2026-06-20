import type { AgentProvider } from './types'
import { TeamflowProvider } from './teamflow-provider'

let cachedProvider: AgentProvider | null = null

export function getProvider(): AgentProvider {
  if (cachedProvider) return cachedProvider
  cachedProvider = new TeamflowProvider()
  return cachedProvider
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
}
