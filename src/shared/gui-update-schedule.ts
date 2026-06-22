export const GUI_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

export function nextGuiUpdateCheckDelay(
  lastCheckedAtMs: number | null | undefined,
  nowMs = Date.now()
): number {
  if (!Number.isFinite(lastCheckedAtMs) || !lastCheckedAtMs || lastCheckedAtMs <= 0) return 0
  return Math.max(0, lastCheckedAtMs + GUI_UPDATE_CHECK_INTERVAL_MS - nowMs)
}
