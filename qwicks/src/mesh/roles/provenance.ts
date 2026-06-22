/**
 * Provenance chain helpers (RFC 007 §7).
 *
 * Every task carries the list of deviceIds that have already touched it. A
 * device must refuse to dispatch to (or accept from) a peer already in the
 * chain — that would form an A→B→A loop. The chain is also depth-capped so an
 * runaway fan-out cannot cascade indefinitely.
 *
 * These are pure functions so both the orchestrator (before dispatch) and the
 * worker (on receipt) can apply the same check.
 */

export function detectCycle(provenance: string[], targetDeviceId: string): boolean {
  return provenance.includes(targetDeviceId)
}

export function exceedsDepth(provenance: string[], maxDepth: number): boolean {
  return provenance.length >= maxDepth
}

export function appendProvenance(provenance: string[], deviceId: string): string[] {
  return [...provenance, deviceId]
}

export function canDispatchTo(opts: {
  provenance: string[]
  targetDeviceId: string
  maxDepth: number
}): boolean {
  if (detectCycle(opts.provenance, opts.targetDeviceId)) return false
  if (exceedsDepth(opts.provenance, opts.maxDepth)) return false
  return true
}
