/**
 * Batch C (spec §3): share / export 双管道脱敏(纯函数)。
 *
 * - share(给别人)= 剥离来源归因,对齐 OpenAI FAQ"分享的聊天不含 Memory Sources"。
 * - export(给自己)= 全保真(GDPR 数据可携带)。
 *
 * 规则 sourceType 驱动(确定性 > 让系统猜):
 *   connector/file/gmail → 永不出现在 share
 *   chat/saved/custom    → mode='private' 默认不显示;mode='show-chat' 才出现
 *   item.shareable===false → override,无论 sourceType 不出现
 *   item.sensitivityCategories ∩ {financial,health,identity} → override(接 Batch B)
 *
 * 关键:别混淆"来源不可分享"与"派生记忆不可分享"。Gmail 推断的"用户去新加坡"
 * 内容可分享,不可分享的是 Gmail 来源本身(subject/snippet/raw id)。
 * 过滤打在 share 序列化时剔除 source 行 + 抹掉 raw payload,不抹派生记忆内容。
 */
import type { SourceType } from '../types.js'

export type ShareMode = 'private' | 'show-chat'

const CONNECTOR_TYPES = new Set<string>(['gmail', 'drive', 'file', 'connector'])
const CHAT_TYPES = new Set<string>(['chat', 'saved', 'custom'])
const SENSITIVE_CATEGORIES = new Set(['financial', 'health', 'identity'])

export interface ShareSourceAttribution {
  sourceId: string
  sourceType: SourceType | string
  sourceText: string
  rawTitle: string | null
  rawSnippet: string | null
  itemId: string
  itemContent: string
  itemShareable: boolean
  itemSensitivityCategories: string[]
  hiddenWhenShared: boolean
}

export interface ShareThread {
  assistantText: string
  sourceAttributions: ShareSourceAttribution[]
}

export interface ShareResult {
  assistantText: string
  sourceAttributions: ShareSourceAttribution[]
}

export interface ExportItem {
  id: string
  content: string
  sourceIds?: string[]
}

export interface ExportSourceRecord {
  id: string
  sourceType: string
  title: string | null
  content: string | null
  shareable: boolean
}

export interface ExportPayload {
  items: ExportItem[]
  sourceRecords: ExportSourceRecord[]
}

function isShareableAttribution(a: ShareSourceAttribution, mode: ShareMode): boolean {
  // 硬 override(永不出现):
  if (!a.itemShareable) return false
  if (a.itemSensitivityCategories.some((c) => SENSITIVE_CATEGORIES.has(c))) return false
  // sourceType 规则:
  const st = String(a.sourceType)
  if (CONNECTOR_TYPES.has(st)) return false
  if (CHAT_TYPES.has(st)) return mode === 'show-chat'
  return false
}

/** share(给别人):剥离来源归因。保留助手回答文本。 */
export function applyShareFilter(thread: ShareThread, mode: ShareMode = 'private'): ShareResult {
  if (mode === 'private') {
    return { assistantText: thread.assistantText, sourceAttributions: [] }
  }
  const kept = thread.sourceAttributions
    .filter((a) => isShareableAttribution(a, mode))
    // 抹掉来源的原始 payload(rawTitle/rawSnippet/raw id 不可逆),只保留脱敏后的类型 + 文本。
    .map((a) => ({
      ...a,
      sourceId: '',
      rawTitle: null,
      rawSnippet: null
    }))
  return { assistantText: thread.assistantText, sourceAttributions: kept }
}

/** export(给自己):全保真。shareableOnly=true 时只留 shareable 来源。 */
export function applyExportFilter(payload: ExportPayload, shareableOnly = false): ExportPayload {
  if (!shareableOnly) return payload
  return {
    items: payload.items,
    sourceRecords: payload.sourceRecords.filter((s) => s.shareable)
  }
}
