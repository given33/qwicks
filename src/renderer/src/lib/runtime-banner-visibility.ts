import type { QWicksRuntimeStatusPayload } from '@shared/qwicks-gui-api'

export function shouldSuppressRuntimeErrorBanner(
  status: QWicksRuntimeStatusPayload | null | undefined
): boolean {
  return status?.state === 'restarting' || status?.state === 'crashed'
}
