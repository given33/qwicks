/**
 * Batch B (spec §2.4): 敏感信息分类器。
 *
 * 复用 sanitizer.detectSecrets(零新检测逻辑)给 identity/financial 打标签,
 * 新增 health 词表(唯一新写)。命中时同时填两个信号:
 *   - sensitivity:粗档(NORMAL/SENSITIVE/RESTRICTED)— D 容量管理读
 *   - categories:细类(⊆ {financial, health, identity})— E 改写过滤读
 * 推导:api_key/ssn/jwt/password → RESTRICTED;其余命中 → SENSITIVE;否则 NORMAL。
 */
import { SensitivityLevel } from '../types.js'
import { detectSecrets } from './sanitizer.js'

export type SensitivityCategory = 'financial' | 'health' | 'identity'

export interface ClassificationResult {
  sensitivity: SensitivityLevel
  categories: SensitivityCategory[]
  matchedPatterns: Array<{ kind: string; category: SensitivityCategory; snippet: string }>
}

/** secret kind → category 映射(detectSecrets 的 kind 前缀都是 pii_)。 */
const SECRET_KIND_TO_CATEGORY: Record<string, SensitivityCategory> = {
  pii_credit_card: 'financial',
  pii_ssn: 'identity',
  pii_email: 'identity',
  pii_phone: 'identity',
  pii_ip: 'identity',
  pii_jwt: 'identity',
  pii_api_key: 'identity',
  pii_password: 'identity'
}

/** identity secret 命中时升 RESTRICTED 的 kind(高保密凭证)。 */
const RESTRICTED_KINDS = new Set(['pii_api_key', 'pii_password', 'pii_ssn', 'pii_jwt'])

// health 词表(中英)。保守起步:明确的医疗/药物/诊断术语,避免误判日常用语。
const HEALTH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // 药物 / 服药
  [/(?:antidepressants?|insulin|statins?|chemo(?:therapy)?|medication|prescription|taking\s+\w+\s+(?:for|tablets?|pills?))/gi, 'medication'],
  // 病况 / 诊断
  [/(?:diagnos(?:is|ed|es)|diabetes|depression|anxiety|hypertension|cancer|tumor|ADHD|bipolar|asthma|allergies|condition|symptoms?|treatment|therapy|chronic\s+illness)/gi, 'diagnosis'],
  // 中文:服药/病情/诊断/病史/症状/治疗
  [/(?:服药|服用|降压药|抗抑郁|病情|诊断|病史|症状|治疗|糖尿病|抑郁症|高血压|慢性病|过敏)/g, 'health_cn']
]

const CATEGORIES: SensitivityCategory[] = ['financial', 'health', 'identity']

export function classifySensitivity(text: string): ClassificationResult {
  const categories = new Set<SensitivityCategory>()
  const matchedPatterns: ClassificationResult['matchedPatterns'] = []
  let restricted = false

  // 1. 复用 detectSecrets → identity / financial 标签
  for (const finding of detectSecrets(text)) {
    const category = SECRET_KIND_TO_CATEGORY[finding.kind]
    if (!category) continue
    categories.add(category)
    if (RESTRICTED_KINDS.has(finding.kind)) restricted = true
    matchedPatterns.push({ kind: finding.kind, category, snippet: finding.snippet })
  }

  // 2. health 词表(唯一新写)
  for (const [pattern, label] of HEALTH_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      categories.add('health')
      const start = m.index ?? 0
      matchedPatterns.push({
        kind: `health_${label}`,
        category: 'health',
        snippet: text.slice(Math.max(0, start - 20), start + m[0].length + 20)
      })
    }
  }

  // 3. 推导 sensitivity 粗档
  let sensitivity = SensitivityLevel.NORMAL
  if (categories.size > 0) sensitivity = SensitivityLevel.SENSITIVE
  if (restricted) sensitivity = SensitivityLevel.RESTRICTED

  return {
    sensitivity,
    categories: CATEGORIES.filter((c) => categories.has(c)),
    matchedPatterns
  }
}
