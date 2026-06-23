/**
 * Query Rewrite —— 文档 §3.5(记忆影响工具调用前的查询构造)。
 *
 * 当用户问"附近有什么我会喜欢的餐厅"时,若记忆里有"住在旧金山"和"vegan",
 * 把查询改写成"San Francisco 好的 vegan 餐厅"(对齐文档示例)。
 *
 * 策略(启发式槽位填充):
 *  - 检测 query 的意图(food/restaurant/recipe → diet 槽;near/nearby/local/附近 → location 槽)
 *  - 从记忆里抽取对应槽位值(diet:vegan/vegetarian;location:城市/地区)
 *  - 仅当 query 有匹配意图时才注入对应槽位(避免污染无关查询)
 *  - 保留原 query 前缀,追加槽位约束
 */
import type { MemoryItem } from '../types.js'

export interface RewriteContext {
  userId: string
  query: string
  memories: MemoryItem[]
}

export interface AppliedSlot {
  memoryId: string
  /** diet / location / preference */
  slot: string
  extractedValue: string
}

export interface RewriteResult {
  /** 改写后的查询(原 query 无变化时等于 query)。 */
  rewritten: string
  /** 应用了哪些记忆的哪个槽位(source lineage)。 */
  appliedMemories: AppliedSlot[]
}

// query 意图信号
const FOOD_INTENT = /(?:restaurant|recipe|dinner|\beat\b|food|餐|饭店|食谱|吃饭|推荐.*吃|lunch|breakfast|brunch|coffee|\bbar\b|\bpub\b)/i
const LOCATION_INTENT = /(?:near|nearby|local|around|close|附近|周边|本地|here|这附近|in my area)/i

// 槽位抽取正则(从记忆 content 里抠值)
const DIET_PATTERN = /\b(vegan|vegetarian|pescatarian|kosher|halal|gluten[-\s]?free|keto|paleo)\b|(素食|纯素|vegan|vegetarian|清真|不吃肉|无麸质|生酮)/i
const LOCATION_PATTERN = /\b(?:live in|based in|located in|from|staying in|reside in)\s+([A-Z][\w\s.]+?)$|(?:住在|在|来自|位于)\s*([一-鿿]{2,8}[市省]?)$/i

const CITIES = ['san francisco', 'new york', 'london', 'tokyo', 'paris', 'berlin', 'singapore', 'beijing', 'shanghai', 'shenzhen', 'hangzhou', 'seoul', 'sydney', 'toronto']

export function rewriteQuery(ctx: RewriteContext): RewriteResult {
  const query = ctx.query.trim()
  if (!query) return { rewritten: query, appliedMemories: [] }

  const hasFood = FOOD_INTENT.test(query)
  const hasLocation = LOCATION_INTENT.test(query)
  // 触发改写:query 有 food 意图(注入 diet 槽)或 location 意图(注入 location 槽)。
  // 通用事实问题("how does X work")既不匹配 food 也不匹配 location,不会改写。
  if (!hasFood && !hasLocation) {
    return { rewritten: query, appliedMemories: [] }
  }

  const applied: AppliedSlot[] = []
  const additions: string[] = []

  for (const mem of ctx.memories) {
    // diet 槽:仅当 query 有 food 意图时注入
    if (hasFood) {
      const diet = extractDiet(mem.content)
      if (diet) {
        applied.push({ memoryId: mem.id, slot: 'diet', extractedValue: diet })
        additions.push(diet)
      }
    }
    // location 槽:仅当 query 有 location 意图时注入
    if (hasLocation) {
      const loc = extractLocation(mem.content)
      if (loc) {
        applied.push({ memoryId: mem.id, slot: 'location', extractedValue: loc })
        additions.push(loc)
      }
    }
  }

  if (additions.length === 0) return { rewritten: query, appliedMemories: [] }

  // 保留原 query,追加槽位约束
  const deduped = [...new Set(additions)]
  const rewritten = `${query} (${deduped.join(', ')})`
  return { rewritten, appliedMemories: applied }
}

function extractDiet(content: string): string | null {
  const m = content.match(DIET_PATTERN)
  if (!m) return null
  // 取第一个非空捕获组,规范化
  const raw = m[1] ?? m[2] ?? ''
  const v = raw.toLowerCase().trim()
  if (!v) return null
  if (/纯素|vegan/.test(v)) return 'vegan'
  if (/素食|vegetarian|不吃肉/.test(v)) return 'vegetarian'
  if (/清真|halal/.test(v)) return 'halal'
  if (/无麸质|gluten/.test(v)) return 'gluten-free'
  if (/生酮|keto/.test(v)) return 'keto'
  return v
}

function extractLocation(content: string): string | null {
  // 先试显式 "live in X" / "住在 X"
  const m = LOCATION_PATTERN.exec(content)
  if (m) {
    const v = (m[1] ?? m[2] ?? '').trim()
    if (v) return v
  }
  // 再试已知城市名直接出现
  const low = content.toLowerCase()
  for (const c of CITIES) {
    if (low.includes(c)) return c
  }
  return null
}
