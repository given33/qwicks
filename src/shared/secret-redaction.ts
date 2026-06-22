const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|client[-_]?secret|password|secret|token)/i
const LABELED_SECRET_TEXT_PATTERN = /\b([A-Z0-9_.-]*(?:api[-_]?key|authorization|client[-_]?secret|password|secret|token)[A-Z0-9_.-]*)\b(["']?\s*[:=]\s*["']?)(Bearer\s+)?([^"',\s;]+)/gi
const BARE_BEARER_SECRET_TEXT_PATTERN = /\bbearer\s+([^"',\s;]+)/gi

export const REDACTED_SECRET = '<redacted>'

export function redactSecrets<T>(value: T): T {
  return redact(value) as T
}

function redact(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED_SECRET
    return redactSecretText(value)
  }
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = SECRET_KEY_PATTERN.test(childKey)
      ? REDACTED_SECRET
      : redact(childValue, childKey)
  }
  return out
}

export function redactSecretText(value: string): string {
  return value
    .replace(
      LABELED_SECRET_TEXT_PATTERN,
      (_match, key: string, separator: string, bearerPrefix: string | undefined) =>
        `${key}${separator}${bearerPrefix ? `Bearer ${REDACTED_SECRET}` : REDACTED_SECRET}`
    )
    .replace(BARE_BEARER_SECRET_TEXT_PATTERN, `Bearer ${REDACTED_SECRET}`)
}
