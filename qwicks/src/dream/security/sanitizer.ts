/**
 * Dream 记忆净化层 —— 1:1 对齐 Python `dream/security/__init__.py`。
 *
 * P0-07:PII redaction + prompt-injection 防御 + tool-output 隔离。
 * 全部确定性正则,完全离线,无 ML。
 *
 * 决策(SanitizationDecision,对齐 Python):
 *   ALLOW      - 原样存储
 *   REDACT     - PII/高危注入片段替换成 <REDACTED:kind> / <INJECTION_REDACTED:kind>
 *   QUARANTINE - 存储但标记 low-trust,不注入 prompt(tool output 常见)
 *   REJECT     - 完全不存
 */
export type SanitizationDecision = 'allow' | 'redact' | 'quarantine' | 'reject'

export interface Finding {
  kind: string
  /** [start, end) */
  span: [number, number]
  snippet: string
}

export interface SanitizationResult {
  decision: SanitizationDecision
  /** redaction 后的内容(ALLOW/REJECT 时为原文/空)。 */
  sanitized: string
  findings: Finding[]
  redactionCounts: Record<string, number>
  reason: string
}

// ------------------------------------------------------------------
// Secret / PII patterns(对齐 Python _SECRET_PATTERNS)
// ------------------------------------------------------------------

// matchAll 需要全局正则;包装确保所有 pattern 带 g 标志。
function g(re: RegExp): RegExp {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
  return new RegExp(re.source, flags)
}

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'pii_password',
    g(/(?:password|passwd|pwd|secret|token)\s*(?:is|[:=])\s*["']?([^\s"',;]{4,})["']?/i)
  ],
  [
    'pii_api_key',
    g(/(?:sk-[A-Za-z0-9_-]{8,}|api[_\s-]?key\b[^.\n,;]{0,30}?[A-Za-z0-9_-]{6,}|bearer\s+[A-Za-z0-9._-]{8,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/i)
  ],
  ['pii_ssn', g(/\b\d{3}-\d{2}-\d{4}\b/)],
  ['pii_credit_card', g(/\b(?:\d[ -]*?){13,19}\b/)],
  ['pii_email', g(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)],
  ['pii_phone', g(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)],
  ['pii_ip', g(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)],
  ['pii_jwt', g(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/)]
]

export function detectSecrets(text: string): Finding[] {
  const out: Finding[] = []
  for (const [kind, pat] of SECRET_PATTERNS) {
    for (const m of text.matchAll(pat)) {
      const start = m.index ?? 0
      out.push({
        kind,
        span: [start, start + m[0].length],
        snippet: text.slice(Math.max(0, start - 20), start + m[0].length + 20)
      })
    }
  }
  return out
}

export function redactSecrets(
  text: string,
  findings: Finding[] = detectSecrets(text)
): { text: string; counts: Record<string, number> } {
  if (findings.length === 0) return { text, counts: {} }
  // 按 span start 降序替换,避免破坏偏移量。
  const sorted = [...findings].sort((a, b) => b.span[0] - a.span[0])
  let out = text
  const counts: Record<string, number> = {}
  for (const f of sorted) {
    const marker = `<REDACTED:${f.kind}>`
    out = out.slice(0, f.span[0]) + marker + out.slice(f.span[1])
    counts[f.kind] = (counts[f.kind] ?? 0) + 1
  }
  return { text: out, counts }
}

// ------------------------------------------------------------------
// Injection patterns(对齐 Python _INJECTION_PATTERNS)
// ------------------------------------------------------------------

const INJECTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'injection_override',
    g(/(?:ignore|disregard|forget|override|bypass)\s+(?:all|any|the|previous|prior|above|earlier)?\s*(?:instructions?|rules?|prompts?|directives?|safety)\b/i)
  ],
  ['injection_role_tag', g(/<\s*\|?\s*(?:im_start|system|assistant|tool_call)\s*\|?[^>]*>/is)],
  [
    'injection_dev_mode',
    g(/(?:developer\s+mode|dev\s+mode|debug\s+mode|jailbreak|do\s+anything\s+now|DAN\s+mode)\b/i)
  ],
  [
    'injection_secrets',
    g(/(?:reveal|print|output|leak|expose|disclose)\s+(?:the\s+)?(?:secret|password|api[_\s]?key|token|credential|ssn|all\s+secrets)\b/i)
  ],
  ['injection_system_tag', g(/^\s*(?:system|assistant)\s*:\s*(?!$)/im)],
  ['injection_command', g(/(?:rm\s+-rf|sudo\s+|chmod\s+777|drop\s+table|truncate\s+table)\b/i)],
  [
    'tool_marker',
    g(/(?:web\s+search\s+result|fetched\s+email\s+body|tool\s+output|raw\s+api\s+response)\s*:/i)
  ]
]

export function detectInjections(text: string): Finding[] {
  const out: Finding[] = []
  for (const [kind, pat] of INJECTION_PATTERNS) {
    for (const m of text.matchAll(pat)) {
      const start = m.index ?? 0
      out.push({
        kind,
        span: [start, start + m[0].length],
        snippet: text.slice(Math.max(0, start - 20), start + m[0].length + 20)
      })
    }
  }
  return out
}

const HIGH_RISK_INJECTION_KINDS = new Set([
  'injection_override',
  'injection_role_tag',
  'injection_dev_mode',
  'injection_system_tag',
  'injection_command',
  'injection_secrets'
])

// ------------------------------------------------------------------
// 公共 API: sanitize_for_memory(对齐 Python)
// ------------------------------------------------------------------

export interface SanitizeOptions {
  /** user | tool | assistant(默认 user) */
  source?: string
  /** false 时任何 source=tool 直接 REJECT(默认 true)。 */
  allowToolOutput?: boolean
}

export function sanitizeForMemory(
  content: string,
  opts: SanitizeOptions = {}
): SanitizationResult {
  const source = opts.source ?? 'user'
  const allowToolOutput = opts.allowToolOutput ?? true

  if (typeof content !== 'string') {
    return { decision: 'reject', sanitized: '', findings: [], redactionCounts: {}, reason: 'non-string content' }
  }
  if (content.trim() === '') {
    return { decision: 'reject', sanitized: '', findings: [], redactionCounts: {}, reason: 'empty content' }
  }

  const secretFindings = detectSecrets(content)
  const injectionFindings = detectInjections(content)

  // 1. 密钥/PII → 一律 redact
  if (secretFindings.length > 0) {
    const { text, counts } = redactSecrets(content, secretFindings)
    return {
      decision: 'redact',
      sanitized: text,
      findings: secretFindings,
      redactionCounts: counts,
      reason: 'redacted PII/secrets'
    }
  }

  // 2. tool 来源隔离
  if (source === 'tool') {
    if (!allowToolOutput) {
      return {
        decision: 'reject',
        sanitized: '',
        findings: injectionFindings,
        redactionCounts: {},
        reason: 'tool output rejected (allowToolOutput=false)'
      }
    }
    if (injectionFindings.length > 0 || injectionFindings.some((f) => f.kind === 'tool_marker')) {
      return {
        decision: 'quarantine',
        sanitized: content,
        findings: injectionFindings,
        redactionCounts: {},
        reason: 'tool output quarantined (untrusted source)'
      }
    }
  }

  // 3. 高危注入 → redact 注入片段(无论来源)
  const highRisk = injectionFindings.filter((f) => HIGH_RISK_INJECTION_KINDS.has(f.kind))
  if (highRisk.length > 0) {
    const sorted = [...highRisk].sort((a, b) => b.span[0] - a.span[0])
    let sanitized = content
    const counts: Record<string, number> = {}
    for (const f of sorted) {
      sanitized = sanitized.slice(0, f.span[0]) + `<INJECTION_REDACTED:${f.kind}>` + sanitized.slice(f.span[1])
      counts[f.kind] = (counts[f.kind] ?? 0) + 1
    }
    return {
      decision: 'redact',
      sanitized,
      findings: highRisk,
      redactionCounts: counts,
      reason: 'redacted prompt-injection spans'
    }
  }

  // 4. 低危注入标记 → ALLOW(metadata 层标 low-trust)
  if (injectionFindings.length > 0) {
    return {
      decision: 'allow',
      sanitized: content,
      findings: injectionFindings,
      redactionCounts: {},
      reason: 'allowed with low-severity injection markers'
    }
  }

  return { decision: 'allow', sanitized: content, findings: [], redactionCounts: {}, reason: 'clean' }
}

// ------------------------------------------------------------------
// 检索侧 guard(对齐 is_low_trust / filter_for_injection)
// ------------------------------------------------------------------

const LOW_TRUST_TOKENS = ['INJECTION_REDACTED', 'REDACTED:', 'raw_api_response']

export function isLowTrust(content: string): boolean {
  if (!content) return false
  return LOW_TRUST_TOKENS.some((t) => content.includes(t))
}

export function filterForInjection(
  candidates: Array<{ content?: string; metadata?: Record<string, unknown> }>
): typeof candidates {
  return candidates.filter((c) => {
    const content = (c.content ?? '').trim()
    const meta = c.metadata ?? {}
    const trust = (meta.trust as string | undefined) ?? (meta.quarantine as string | undefined) ?? ''
    if (isLowTrust(content)) return false
    if (trust === 'low' || trust === 'quarantined') return false
    return true
  })
}
