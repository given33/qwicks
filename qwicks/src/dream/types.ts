/**
 * Dream 系统的核心数据模型。
 *
 * 1:1 对齐 Python `dream/models/types.py`。所有跨层传输的对象都在这里定义。
 * 设计原则:
 *  - 类 + toDict()/fromDict(),对齐 Python dataclass 的 to_dict()/from_dict()。
 *  - 枚举用 TS `enum`(可被 [...Enum] 展开,且保留字符串值)。
 *  - 不依赖任何 ORM,可以被 storage / graph / 合成等模块共同使用。
 *
 * 生命周期语义(MemoryLifecycleStatus,对齐 Python R68):
 *   ACTIVE            - 正常, retrieve 命中
 *   SUPPRESSED        - 用户点过 don't mention, retrieve 跳过
 *   EXPIRED           - expiresAt 已过, retrieve 跳过
 *   SUPERSEDED        - 被 correct() 新值替代, retrieve 跳过, graph 留 supersedes 边
 *   DELETED           - hard deleted (vector/graph 也清), retrieve 跳过
 *   CONNECTOR_REVOKED - 来自 connector 的记忆被撤权, retrieve 跳过
 *   ARCHIVED          - 软删保留审计, retrieve 跳过
 *   HYPOTHESIS        - LLM 推测, 待用户确认
 *   CONFIRMED         - 用户确认过的 LLM 推测
 */
import { createHash, randomUUID } from 'node:crypto'

// ------------------------------------------------------------------
// 时间工具
// ------------------------------------------------------------------

/** 当前 UTC ISO 时间字符串(秒精度,对齐 Python _now_iso)。 */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ------------------------------------------------------------------
// 枚举(TS enum: 可被 Object.values() / [...Enum] 展开, 字符串值)
// ------------------------------------------------------------------

export enum MemoryType {
  GOAL = 'goal',
  SKILL = 'skill',
  PROJECT = 'project',
  PREFERENCE = 'preference',
  CONSTRAINT = 'constraint',
  FACT = 'fact',
  EPISODE = 'episode',
  FEEDBACK = 'feedback'
}

export enum MemoryScope {
  GLOBAL = 'global',
  USER = 'user',
  PROJECT = 'project',
  SESSION = 'session',
  THREAD = 'thread'
}

export enum ConflictVerdict {
  NONE = 'none',
  COMPATIBLE = 'compatible',
  DUPLICATE = 'duplicate',
  CONTRADICTS = 'contradicts',
  SUPERSEDES = 'supersedes'
}

export enum MemoryLifecycleStatus {
  ACTIVE = 'active',
  SUPPRESSED = 'suppressed',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded',
  DELETED = 'deleted',
  CONNECTOR_REVOKED = 'connector_revoked',
  ARCHIVED = 'archived',
  HYPOTHESIS = 'hypothesis',
  CONFIRMED = 'confirmed'
}

/** retrieve 会命中(不跳过)的状态集合。 */
export const RETRIEVABLE_STATUSES: ReadonlySet<MemoryLifecycleStatus> = new Set([
  MemoryLifecycleStatus.ACTIVE,
  MemoryLifecycleStatus.CONFIRMED,
  MemoryLifecycleStatus.HYPOTHESIS
])

function makeEnumParser<T extends string>(enumObj: object, name: string) {
  const values = new Set<string>(Object.values(enumObj))
  return (raw: string): T => {
    if (!values.has(raw)) throw new Error(`invalid ${name}: ${raw}`)
    return raw as T
  }
}

/** 判断字符串是否是某 enum 的合法值(不抛错)。 */
function isValidEnumValue(raw: string, enumObj: object): boolean {
  return new Set<string>(Object.values(enumObj)).has(raw)
}

/**
 * Temporal state(对齐文档 §1 / §4 "temporal state 区分计划中、当前、已发生、过期、被 supersede")。
 * 这是事实的时间属性,与 MemoryLifecycleStatus(记录的生命周期状态)正交:
 *   - PLANNED    : 计划中/未来将发生(如"我要去新加坡旅行")
 *   - CURRENT    : 当前为真(如"我现在住在 A")
 *   - OCCURRED   : 已发生过(如"我曾在某时间去过新加坡" — 由 PLANNED 自动转换)
 *   - EXPIRED    : 已失效/不再为真(由 valid_until 推断)
 *   - SUPERSEDED : 被新事实取代(由 superseded_by 链推断)
 */
export enum TemporalState {
  PLANNED = 'planned',
  CURRENT = 'current',
  OCCURRED = 'occurred',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded'
}

export const parseTemporalState = makeEnumParser<TemporalState>(TemporalState, 'TemporalState')

/**
 * 来源类型(对齐文档 §1 source record / §6 Memory Sources)。
 */
export enum SourceType {
  CHAT = 'chat',
  FILE = 'file',
  GMAIL = 'gmail',
  CUSTOM_INSTRUCTION = 'custom_instruction',
  SAVED_MEMORY = 'saved_memory',
  DRIVE = 'drive'
}

export const parseSourceType = makeEnumParser<SourceType>(SourceType, 'SourceType')

/**
 * 敏感度等级(隐私/敏感度 flag,对齐文档 §1 "privacy/sensitivity flags")。
 */
export enum SensitivityLevel {
  NORMAL = 'normal',
  SENSITIVE = 'sensitive',
  RESTRICTED = 'restricted'
}

export const parseSensitivityLevel = makeEnumParser<SensitivityLevel>(
  SensitivityLevel,
  'SensitivityLevel'
)

/** suppress 作用的目标类型(对齐文档 §8 "Don't mention this again")。 */
export enum SuppressionScope {
  /** 整条 memory 不再主动提及。 */
  MEMORY = 'memory',
  /** 某 source 不再作为依据主动提及。 */
  SOURCE = 'source',
  /** memory summary 的某片段不再主动提及。 */
  SUMMARY = 'summary',
  /** 某话题(主题)不再主动提及。 */
  TOPIC = 'topic'
}

export const parseSuppressionScope = makeEnumParser<SuppressionScope>(
  SuppressionScope,
  'SuppressionScope'
)

export const parseMemoryType = makeEnumParser<MemoryType>(MemoryType, 'MemoryType')
export const parseMemoryScope = makeEnumParser<MemoryScope>(MemoryScope, 'MemoryScope')
export const parseConflictVerdict = makeEnumParser<ConflictVerdict>(ConflictVerdict, 'ConflictVerdict')
export const parseMemoryLifecycleStatus = makeEnumParser<MemoryLifecycleStatus>(
  MemoryLifecycleStatus,
  'MemoryLifecycleStatus'
)

// ------------------------------------------------------------------
// Legacy metadata 兼容常量(对齐 Python)
// 老代码读 metadata["__deleted__"] / "do_not_inject" 的, 仍然工作。
// ------------------------------------------------------------------

export const LEGACY_META_DELETED = '__deleted__'
export const LEGACY_META_DO_NOT_INJECT = 'do_not_inject'
export const LEGACY_TAG_DO_NOT_INJECT = '__do_not_inject__'

// ------------------------------------------------------------------
// ID 生成(对齐 Python new_id: "mem_" + uuid4().hex[:12])
// ------------------------------------------------------------------

/** 生成新记忆 id: `mem_` + 12 位 hex(对齐 Python)。 */
export function newMemoryId(): string {
  return 'mem_' + randomUUID().replace(/-/g, '').slice(0, 12)
}

// ------------------------------------------------------------------
// StatusHistoryEntry
// ------------------------------------------------------------------

export interface StatusHistoryEntry {
  status: string
  at: string
  actor: string
  reason?: string | null
}

export function statusHistoryEntryFromDict(raw: Record<string, unknown>): StatusHistoryEntry {
  return {
    status: String(raw.status),
    at: String(raw.at),
    actor: String(raw.actor ?? 'system'),
    reason: raw.reason === undefined ? null : String(raw.reason)
  }
}

export function statusHistoryEntryToDict(e: StatusHistoryEntry): Record<string, unknown> {
  return {
    status: e.status,
    at: e.at,
    actor: e.actor,
    ...(e.reason === undefined ? {} : { reason: e.reason })
  }
}

// ------------------------------------------------------------------
// MemoryProvenance
// ------------------------------------------------------------------

export interface MemoryProvenanceDict {
  source?: string
  actor?: string | null
  thread_id?: string | null
  turn_id?: string | null
  confidence?: number
  model?: string | null
  created_at?: string
  note?: string | null
}

export class MemoryProvenance {
  constructor(
    public source: string = 'user',
    public actor: string | null = null,
    public threadId: string | null = null,
    public turnId: string | null = null,
    public confidence: number = 0.7,
    public model: string | null = null,
    public createdAt: string = nowIso(),
    public note: string | null = null
  ) {}

  static fromDict(raw: MemoryProvenanceDict = {}): MemoryProvenance {
    return new MemoryProvenance(
      typeof raw.source === 'string' ? raw.source : 'user',
      raw.actor === undefined ? null : raw.actor,
      raw.thread_id === undefined ? null : raw.thread_id,
      raw.turn_id === undefined ? null : raw.turn_id,
      typeof raw.confidence === 'number' ? raw.confidence : 0.7,
      raw.model === undefined ? null : raw.model,
      typeof raw.created_at === 'string' ? raw.created_at : nowIso(),
      raw.note === undefined ? null : raw.note
    )
  }

  toDict(): MemoryProvenanceDict {
    return {
      source: this.source,
      actor: this.actor,
      thread_id: this.threadId,
      turn_id: this.turnId,
      confidence: this.confidence,
      model: this.model,
      created_at: this.createdAt,
      note: this.note
    }
  }
}

// ------------------------------------------------------------------
// DerivationRecord(派生记忆的依赖图, 对齐 Python R68)
// ------------------------------------------------------------------

export interface DerivationRecordDict {
  derived_from_source_ids?: unknown[]
  derived_from_memory_ids?: unknown[]
  confidence?: number
  source_count?: number
  last_validated_at?: string
  invalidated_by?: string | null
  method?: string
}

export class DerivationRecord {
  constructor(
    public derivedFromSourceIds: string[] = [],
    public derivedFromMemoryIds: string[] = [],
    public confidence: number = 0.7,
    public sourceCount: number = 0,
    public lastValidatedAt: string = nowIso(),
    public invalidatedBy: string | null = null,
    /** "hierarchical.layer1" / "hierarchical.layer2" / "synth.profile" / "synth.bucket" */
    public method: string = ''
  ) {}

  static fromDict(raw: DerivationRecordDict = {}): DerivationRecord {
    return new DerivationRecord(
      Array.isArray(raw.derived_from_source_ids) ? [...(raw.derived_from_source_ids as string[])] : [],
      Array.isArray(raw.derived_from_memory_ids) ? [...(raw.derived_from_memory_ids as string[])] : [],
      typeof raw.confidence === 'number' ? raw.confidence : 0.7,
      typeof raw.source_count === 'number' ? raw.source_count : 0,
      typeof raw.last_validated_at === 'string' ? raw.last_validated_at : nowIso(),
      raw.invalidated_by === undefined ? null : raw.invalidated_by,
      typeof raw.method === 'string' ? raw.method : ''
    )
  }

  toDict(): DerivationRecordDict {
    return {
      derived_from_source_ids: [...this.derivedFromSourceIds],
      derived_from_memory_ids: [...this.derivedFromMemoryIds],
      confidence: this.confidence,
      source_count: this.sourceCount,
      last_validated_at: this.lastValidatedAt,
      invalidated_by: this.invalidatedBy,
      method: this.method
    }
  }
}

// ------------------------------------------------------------------
// SourceRecord —— 来源记录实体(对齐文档 §1 / §6)
// 每条来源(chat/file/gmail/custom_instruction/saved_memory/drive)都是独立实体,
// 与 memory 分开持久化。memory 通过 source_ids 引用。
// ------------------------------------------------------------------

/** 生成新来源 id: `src_` + 12 位 hex。 */
export function newSourceId(): string {
  return 'src_' + randomUUID().replace(/-/g, '').slice(0, 12)
}

export interface SourceRecordDict {
  id?: string
  user_id: string
  source_type: string
  /** 来源的对外标识(对 chat: threadId+turnId;对 file: fileId;对 gmail: messageId)。 */
  external_ref?: string | null
  /** 摘要 / 预览(对 chat: user 角色消息截断;对 file: 文件名;对 gmail: subject)。 */
  title?: string | null
  /** 原始内容(chat 消息全文 / file 内容片段 / gmail body)。nullable 以保护 PII。 */
  content?: string | null
  /** 文件 / 邮件 / thread 的元数据(如 from、to、ts、file_size、mime 等)。 */
  attrs?: Record<string, unknown>
  created_at?: string
  ingested_at?: string
  /** 来源是否被删除(用户主动删 chat / 断开 connector / 删 file)。 */
  deleted?: boolean
  /** Batch C:能否对外共享(按 sourceType 算 — connector/file/gmail→false, chat/saved/custom→true)。ingest 时写定,不可变。 */
  shareable?: boolean
}

export class SourceRecord {
  constructor(
    public id: string,
    public userId: string,
    public sourceType: SourceType,
    public externalRef: string | null = null,
    public title: string | null = null,
    public content: string | null = null,
    public attrs: Record<string, unknown> = {},
    public createdAt: string = nowIso(),
    public ingestedAt: string = nowIso(),
    public deleted: boolean = false,
    /** Batch C:能否对外共享(按 sourceType 算 — connector/file/gmail→false, chat/saved/custom→true)。ingest 时写定,不可变。 */
    public shareable: boolean = true
  ) {}

  static fromDict(raw: SourceRecordDict): SourceRecord {
    return new SourceRecord(
      typeof raw.id === 'string' ? raw.id : newSourceId(),
      String(raw.user_id),
      parseSourceType(raw.source_type),
      raw.external_ref === undefined ? null : raw.external_ref,
      raw.title === undefined ? null : raw.title,
      raw.content === undefined ? null : raw.content,
      raw.attrs && typeof raw.attrs === 'object' && !Array.isArray(raw.attrs)
        ? { ...(raw.attrs as Record<string, unknown>) }
        : {},
      typeof raw.created_at === 'string' ? raw.created_at : nowIso(),
      typeof raw.ingested_at === 'string' ? raw.ingested_at : nowIso(),
      raw.deleted === true,
      raw.shareable !== false
    )
  }

  toDict(): SourceRecordDict {
    return {
      id: this.id,
      user_id: this.userId,
      source_type: this.sourceType,
      external_ref: this.externalRef,
      title: this.title,
      content: this.content,
      attrs: { ...this.attrs },
      created_at: this.createdAt,
      ingested_at: this.ingestedAt,
      deleted: this.deleted,
      shareable: this.shareable
    }
  }
}

// ------------------------------------------------------------------
// SuppressionRule —— "Don't mention this again" 一等实体(文档 §8)
// 作用域:summary / source / memory / topic。与 DELETED 状态严格区分:
// suppress 不删除数据,只阻止主动提及;用户明确询问时仍可解释。
// ------------------------------------------------------------------

/** 生成新抑制规则 id: `sup_` + 12 位 hex。 */
export function newSuppressionId(): string {
  return 'sup_' + randomUUID().replace(/-/g, '').slice(0, 12)
}

export interface SuppressionRuleDict {
  id?: string
  user_id: string
  scope: string
  /** 目标 id(memory/source id)或主题字符串(topic/summary 片段)。 */
  target: string
  reason?: string | null
  created_at?: string
  /** 是否仍然生效(suppress 可被恢复;恢复 ≠ 删除规则本身)。 */
  active?: boolean
}

export class SuppressionRule {
  constructor(
    public id: string,
    public userId: string,
    public scope: SuppressionScope,
    /** 目标:MEMORY/SOURCE 用 id;TOPIC/SUMMARY 用字符串。 */
    public target: string,
    public reason: string | null = null,
    public createdAt: string = nowIso(),
    public active: boolean = true
  ) {}

  static fromDict(raw: SuppressionRuleDict): SuppressionRule {
    return new SuppressionRule(
      typeof raw.id === 'string' ? raw.id : newSuppressionId(),
      String(raw.user_id),
      parseSuppressionScope(raw.scope),
      String(raw.target),
      raw.reason === undefined ? null : raw.reason,
      typeof raw.created_at === 'string' ? raw.created_at : nowIso(),
      raw.active !== false
    )
  }

  toDict(): SuppressionRuleDict {
    return {
      id: this.id,
      user_id: this.userId,
      scope: this.scope,
      target: this.target,
      reason: this.reason,
      created_at: this.createdAt,
      active: this.active
    }
  }
}

// ------------------------------------------------------------------
// MemoryItem(核心)
// ------------------------------------------------------------------

export interface MemoryItemDict {
  id: string
  user_id: string
  type: string
  content: string
  scope?: string
  tags?: unknown[]
  importance?: number
  confidence?: number
  created_at?: string
  updated_at?: string
  expires_at?: string | null
  provenance?: MemoryProvenanceDict
  embedding?: number[] | null
  embedding_model?: string | null
  related?: unknown[]
  metadata?: Record<string, unknown>
  status?: string
  status_history?: unknown[]
  schema_version?: number
  // ----- v3 扩展字段(对齐文档 §1 严格数据模型) -----
  normalized_facts?: unknown[]
  source_ids?: unknown[]
  temporal_state?: string
  valid_from?: string | null
  valid_until?: string | null
  supersedes?: unknown[]
  superseded_by?: unknown[]
  is_top_of_mind?: boolean
  is_suppressed?: boolean
  user_corrected?: boolean
  salience?: number
  topic?: string | null
  last_used_at?: string | null
  sensitivity?: string
  /** 是否可对外导出 / 共享(对齐 §6 "共享聊天时不得暴露用户的 Memory Sources")。 */
  shareable?: boolean
  /** 细粒度敏感类别(Batch B)⊆ {financial, health, identity}。 */
  sensitivity_categories?: string[]
  /** sensitivity_categories 的驼峰别名(向后兼容)。 */
  sensitivityCategories?: string[]
}

export class MemoryItem {
  constructor(
    public id: string,
    public userId: string,
    public type: MemoryType,
    public content: string,
    public scope: MemoryScope = MemoryScope.USER,
    public tags: string[] = [],
    public importance: number = 0.5,
    public confidence: number = 0.7,
    public createdAt: string = nowIso(),
    public updatedAt: string = nowIso(),
    public expiresAt: string | null = null,
    public provenance: MemoryProvenance = new MemoryProvenance(),
    public embedding: number[] | null = null,
    public embeddingModel: string | null = null,
    public related: string[] = [],
    public metadata: Record<string, unknown> = {},
    public status: MemoryLifecycleStatus = MemoryLifecycleStatus.ACTIVE,
    public statusHistory: StatusHistoryEntry[] = [],
    public schemaVersion: number = 2,
    // ----- v3 扩展字段 -----
    /** normalized facts:把 content 拆解为可机器消费的原子事实列表。 */
    public normalizedFacts: string[] = [],
    /** source_ids:本记忆派生自哪些 SourceRecord(来源谱系)。 */
    public sourceIds: string[] = [],
    /** temporal_state:计划中/当前/已发生/过期/被取代。 */
    public temporalState: TemporalState = TemporalState.CURRENT,
    /** valid_from:事实生效的起始时间(对"我要去新加坡"= 出发日)。 */
    public validFrom: string | null = null,
    /** valid_until:事实失效时间(对旅行 = 返回日;转换到 occurred 后此字段保留为历史)。 */
    public validUntil: string | null = null,
    /** supersedes:本记忆取代了哪些旧记忆 id。 */
    public supersedes: string[] = [],
    /** superseded_by:本记忆被哪些新记忆取代(链)。 */
    public supersededBy: string[] = [],
    /** is_top_of_mind:是否在 top-of-mind 池(高 salience 主动提及候选)。 */
    public isTopOfMind: boolean = false,
    /** is_suppressed:是否被用户用 suppression rule 主动抑制提及(≠ SUPPRESSED 状态)。 */
    public isSuppressed: boolean = false,
    /** user_corrected:用户人工纠正过(降权 LLM 自信度,优先级更高)。 */
    public userCorrected: boolean = false,
    /** salience:[0,1] 显著度,与 importance 不同维度(影响 top-of-mind 排序)。 */
    public salience: number = 0.5,
    /** topic:主题分组键(如 "diet"、"location"、"travel:sg")。 */
    public topic: string | null = null,
    /** last_used_at:最近一次被 retrieve 命中的时间(用于 fresh 排序)。 */
    public lastUsedAt: string | null = null,
    /** sensitivity:隐私敏感度等级(对齐 §1 privacy/sensitivity flags)。 */
    public sensitivity: SensitivityLevel = SensitivityLevel.NORMAL,
    /** shareable:能否对外共享 / 导出到第三方(默认敏感=false 时仍 true,显式标 restricted 时 false)。 */
    public shareable: boolean = true,
    /**
     * sensitivityCategories:细粒度敏感类别(Batch B)⊆ {financial, health, identity}。
     * E(query-rewrite 过滤)按类别判定;D(容量管理)只读粗档 sensitivity,不碰此字段。
     * 新增类别(如 location)对 D/E 透明。ingest 时由 classifier 写定。
     */
    public sensitivityCategories: string[] = []
  ) {}

  /**
   * 从 dict 构造。实现 v1->v2->v3 渐进迁移:
   *  - 旧数据无 status/schema_version 时从 metadata 推断 status, schemaVersion 置 1 触发迁移。
   *  - v3 字段缺失时回填默认值,保持兼容。
   *  - 对齐 Python from_dict (lines 209-251)。
   */
  static fromDict(raw: MemoryItemDict): MemoryItem {
    const rawMetadata: Record<string, unknown> = { ...(raw.metadata ?? {}) }
    const tags = Array.isArray(raw.tags) ? [...(raw.tags as string[])] : []

    const legacyDeleted = rawMetadata[LEGACY_META_DELETED] === true
    const legacyDoNotInject =
      rawMetadata[LEGACY_META_DO_NOT_INJECT] === true || tags.includes(LEGACY_TAG_DO_NOT_INJECT)

    let status: MemoryLifecycleStatus
    if (raw.status !== undefined) {
      status = parseMemoryLifecycleStatus(raw.status)
    } else if (legacyDeleted) {
      status = MemoryLifecycleStatus.DELETED
    } else if (legacyDoNotInject) {
      status = MemoryLifecycleStatus.SUPPRESSED
    } else {
      status = MemoryLifecycleStatus.ACTIVE
    }

    const schemaVersion = raw.schema_version === undefined ? 1 : Number(raw.schema_version)
    const createdAt = raw.created_at ?? nowIso()

    // v3 字段(全部带向后兼容默认值)。
    const temporalRaw =
      typeof raw.temporal_state === 'string' ? raw.temporal_state : TemporalState.CURRENT
    const temporalState: TemporalState = isValidEnumValue(temporalRaw, TemporalState)
      ? (temporalRaw as TemporalState)
      : TemporalState.CURRENT
    const sensitivityRaw =
      typeof raw.sensitivity === 'string' ? raw.sensitivity : SensitivityLevel.NORMAL
    const sensitivity: SensitivityLevel = isValidEnumValue(sensitivityRaw, SensitivityLevel)
      ? (sensitivityRaw as SensitivityLevel)
      : SensitivityLevel.NORMAL

    return new MemoryItem(
      String(raw.id),
      String(raw.user_id),
      parseMemoryType(raw.type),
      String(raw.content),
      parseMemoryScope(raw.scope ?? 'user'),
      tags,
      typeof raw.importance === 'number' ? raw.importance : 0.5,
      typeof raw.confidence === 'number' ? raw.confidence : 0.7,
      createdAt,
      raw.updated_at ?? createdAt,
      raw.expires_at ?? null,
      MemoryProvenance.fromDict(raw.provenance ?? {}),
      Array.isArray(raw.embedding) ? [...(raw.embedding as number[])] : null,
      raw.embedding_model ?? null,
      Array.isArray(raw.related) ? [...(raw.related as string[])] : [],
      rawMetadata,
      status,
      Array.isArray(raw.status_history)
        ? (raw.status_history as Record<string, unknown>[]).map(statusHistoryEntryFromDict)
        : [],
      schemaVersion,
      Array.isArray(raw.normalized_facts) ? [...(raw.normalized_facts as string[])] : [],
      Array.isArray(raw.source_ids) ? [...(raw.source_ids as string[])] : [],
      temporalState,
      raw.valid_from ?? null,
      raw.valid_until ?? null,
      Array.isArray(raw.supersedes) ? [...(raw.supersedes as string[])] : [],
      Array.isArray(raw.superseded_by) ? [...(raw.superseded_by as string[])] : [],
      raw.is_top_of_mind === true,
      raw.is_suppressed === true,
      raw.user_corrected === true,
      typeof raw.salience === 'number' ? raw.salience : 0.5,
      raw.topic === undefined ? null : raw.topic,
      raw.last_used_at === undefined ? null : raw.last_used_at,
      sensitivity,
      raw.shareable !== false,
      Array.isArray(raw.sensitivity_categories)
        ? [...(raw.sensitivity_categories as string[])]
        : Array.isArray(raw.sensitivityCategories)
          ? [...(raw.sensitivityCategories as string[])]
          : []
    )
  }

  toDict(): MemoryItemDict {
    return {
      id: this.id,
      user_id: this.userId,
      type: this.type,
      content: this.content,
      scope: this.scope,
      tags: [...this.tags],
      importance: this.importance,
      confidence: this.confidence,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      expires_at: this.expiresAt,
      provenance: this.provenance.toDict(),
      embedding: this.embedding === null ? null : [...this.embedding],
      embedding_model: this.embeddingModel,
      related: [...this.related],
      metadata: { ...this.metadata },
      status: this.status,
      status_history: this.statusHistory.map(statusHistoryEntryToDict),
      schema_version: this.schemaVersion,
      normalized_facts: [...this.normalizedFacts],
      source_ids: [...this.sourceIds],
      temporal_state: this.temporalState,
      valid_from: this.validFrom,
      valid_until: this.validUntil,
      supersedes: [...this.supersedes],
      superseded_by: [...this.supersededBy],
      is_top_of_mind: this.isTopOfMind,
      is_suppressed: this.isSuppressed,
      user_corrected: this.userCorrected,
      salience: this.salience,
      topic: this.topic,
      last_used_at: this.lastUsedAt,
      sensitivity: this.sensitivity,
      shareable: this.shareable,
      sensitivity_categories: [...this.sensitivityCategories]
    }
  }

  /**
   * 内容指纹(对齐 Python fingerprint):
   * sha256(user_id + type + content + sorted tags)[:16]。忽略 id, tag 顺序无关。
   */
  fingerprint(): string {
    const material = JSON.stringify({
      user_id: this.userId,
      type: this.type,
      content: this.content,
      tags: [...this.tags].sort()
    })
    return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)
  }

  /**
   * 状态机迁移(对齐 Python transition_status, lines 270-304)。
   * 写 statusHistory,同步写 legacy metadata 兼容字段。迁移到任意非 active 状态都把
   * schemaVersion 提升到 2。
   */
  transitionStatus(
    newStatus: MemoryLifecycleStatus,
    opts: { actor?: string; reason?: string | null } = {}
  ): void {
    if (this.status === newStatus) return
    this.statusHistory = [
      ...this.statusHistory,
      {
        status: newStatus,
        at: nowIso(),
        actor: opts.actor ?? 'system',
        reason: opts.reason === undefined ? null : opts.reason
      }
    ]
    this.status = newStatus
    // 任何状态转换都提升 schemaVersion(≥2);若已有 v3 字段则保 ≥3。
    this.schemaVersion = Math.max(2, this.schemaVersion)

    const md: Record<string, unknown> = { ...this.metadata }
    if (newStatus === MemoryLifecycleStatus.DELETED) {
      md[LEGACY_META_DELETED] = true
      md.__deleted_at__ = nowIso()
    } else if (newStatus === MemoryLifecycleStatus.SUPPRESSED) {
      md[LEGACY_META_DO_NOT_INJECT] = true
      if (md.dont_mention_at === undefined) md.dont_mention_at = nowIso()
      if (!this.tags.includes(LEGACY_TAG_DO_NOT_INJECT)) {
        this.tags = [...this.tags, LEGACY_TAG_DO_NOT_INJECT]
      }
      // v3:同步 isSuppressed flag
      this.isSuppressed = true
    } else if (newStatus === MemoryLifecycleStatus.EXPIRED) {
      md.__expired__ = true
      if (md.expired_at === undefined) md.expired_at = nowIso()
      if (this.temporalState !== TemporalState.OCCURRED) {
        this.temporalState = TemporalState.EXPIRED
      }
    } else if (newStatus === MemoryLifecycleStatus.SUPERSEDED) {
      md.__superseded__ = true
      if (this.temporalState !== TemporalState.OCCURRED) {
        this.temporalState = TemporalState.SUPERSEDED
      }
    } else if (newStatus === MemoryLifecycleStatus.CONNECTOR_REVOKED) {
      md.__connector_revoked__ = true
    } else if (newStatus === MemoryLifecycleStatus.ARCHIVED) {
      md.__archived__ = true
    }
    this.metadata = md
    if (schemaWasV3(this) && this.schemaVersion < 3) this.schemaVersion = 3
  }

  // ----------------------------------------------------------------
  // v3: temporal state 转换(对齐文档 §4 "把旧计划转换为历史事实")
  // ----------------------------------------------------------------

  /**
   * 把本记忆的时间状态从 PLANNED 转换为 OCCURRED(对齐文档:"我要去新加坡旅行"
   * 在旅行结束后变成"我曾在某时间去过新加坡")。
   * - 改写 content(可选,调用方传入历史化的文本)
   * - temporalState → OCCURRED
   * - 保留 validFrom/validUntil 作为历史窗口
   * - status 保持 ACTIVE(仍是真实事实,只是从"未来"变"过去")
   */
  transitionToOccurred(
    historyContent: string,
    opts: { actor?: string; reason?: string | null } = {}
  ): void {
    this.content = historyContent
    this.temporalState = TemporalState.OCCURRED
    if (this.schemaVersion < 3) this.schemaVersion = 3
    this.updatedAt = nowIso()
    this.metadata = {
      ...this.metadata,
      temporal_transition_at: nowIso(),
      temporal_transition_from: 'planned',
      temporal_transition_reason: opts.reason ?? 'planned_event_occurred'
    }
    this.statusHistory = [
      ...this.statusHistory,
      {
        status: `temporal:planned→occurred`,
        at: nowIso(),
        actor: opts.actor ?? 'dream.temporal',
        reason: opts.reason ?? 'planned_event_occurred'
      }
    ]
  }

  /**
   * 标记本记忆被某新记忆取代(supersede 链)。
   * - superseded_by 加上 newId
   * - temporalState → SUPERSEDED
   * - 可选:同步 lifecycle status(通常 SUPERSEDED)
   */
  markSupersededBy(
    newId: string,
    opts: { actor?: string; reason?: string | null; toStatus?: MemoryLifecycleStatus } = {}
  ): void {
    if (!this.supersededBy.includes(newId)) {
      this.supersededBy = [...this.supersededBy, newId]
    }
    this.temporalState = TemporalState.SUPERSEDED
    this.isSuppressed = false // 被 supersede ≠ suppress
    if (this.schemaVersion < 3) this.schemaVersion = 3
    if (opts.toStatus && this.status !== opts.toStatus) {
      this.transitionStatus(opts.toStatus, { actor: opts.actor, reason: opts.reason })
    }
  }

  /** 标记本记忆取代了某些旧记忆(supersedes 链;通常与新 MemoryItem 关联)。 */
  markSupersedes(oldIds: readonly string[]): void {
    const merged = new Set([...this.supersedes, ...oldIds])
    this.supersedes = [...merged]
    if (this.schemaVersion < 3) this.schemaVersion = 3
  }

  /** 标记本记忆在最近一次检索中被使用(刷新 lastUsedAt)。 */
  markUsed(at: string = nowIso()): void {
    this.lastUsedAt = at
  }

  /** 提升为 top-of-mind(对齐文档 §2 "把高相关记忆保持 top of mind")。 */
  promoteToTopOfMind(): void {
    this.isTopOfMind = true
    if (this.schemaVersion < 3) this.schemaVersion = 3
  }

  /** 降级到 background(对齐文档 §2 "把低相关记忆降级到 background")。 */
  demoteToBackground(): void {
    this.isTopOfMind = false
    if (this.schemaVersion < 3) this.schemaVersion = 3
  }

  /** 用户人工纠正过(影响检索加权与可信度)。 */
  markUserCorrected(): void {
    this.userCorrected = true
    if (this.schemaVersion < 3) this.schemaVersion = 3
  }
}

/** 内部:判断 item 是否含 v3 字段(用于 transitionStatus 后提升 schemaVersion)。 */
function schemaWasV3(item: MemoryItem): boolean {
  return (
    item.normalizedFacts.length > 0 ||
    item.sourceIds.length > 0 ||
    item.temporalState !== TemporalState.CURRENT ||
    item.validFrom !== null ||
    item.validUntil !== null ||
    item.supersedes.length > 0 ||
    item.supersededBy.length > 0 ||
    item.isTopOfMind ||
    item.isSuppressed ||
    item.userCorrected ||
    item.salience !== 0.5 ||
    item.topic !== null ||
    item.lastUsedAt !== null ||
    item.sensitivity !== SensitivityLevel.NORMAL ||
    item.shareable !== true
  )
}

// ------------------------------------------------------------------
// MemoryItemDraft(提取器输出的草稿, 还没分配 id / embedding)
// ------------------------------------------------------------------

export interface MemoryItemDraftDict {
  type: string
  content: string
  tags?: unknown[]
  importance?: number
  confidence?: number
  scope?: string
  provenance?: MemoryProvenanceDict
  metadata?: Record<string, unknown>
  /** Batch B:粗档敏感度(由 classifier 填充)。 */
  sensitivity?: string
  /** Batch B:细粒度敏感类别(由 classifier 填充)。 */
  sensitivity_categories?: unknown[]
}

export class MemoryItemDraft {
  constructor(
    public type: MemoryType,
    public content: string,
    public tags: string[] = [],
    public importance: number = 0.5,
    public confidence: number = 0.7,
    public scope: MemoryScope = MemoryScope.USER,
    public provenance: MemoryProvenance = new MemoryProvenance(),
    public metadata: Record<string, unknown> = {},
    /** Batch B:粗档敏感度(由 classifier 填充,默认 NORMAL)。 */
    public sensitivity: SensitivityLevel = SensitivityLevel.NORMAL,
    /** Batch B:细粒度敏感类别(由 classifier 填充)。 */
    public sensitivityCategories: string[] = []
  ) {}

  static fromDict(raw: MemoryItemDraftDict): MemoryItemDraft {
    return new MemoryItemDraft(
      parseMemoryType(String(raw.type)),
      String(raw.content),
      Array.isArray(raw.tags) ? [...(raw.tags as string[])] : [],
      typeof raw.importance === 'number' ? raw.importance : 0.5,
      typeof raw.confidence === 'number' ? raw.confidence : 0.7,
      parseMemoryScope(typeof raw.scope === 'string' ? raw.scope : 'user'),
      MemoryProvenance.fromDict(raw.provenance ?? {}),
      { ...(raw.metadata ?? {}) },
      parseSensitivityLevel(typeof raw.sensitivity === 'string' ? raw.sensitivity : 'normal'),
      Array.isArray(raw.sensitivity_categories) ? [...(raw.sensitivity_categories as string[])] : []
    )
  }

  toDict(): MemoryItemDraftDict {
    return {
      type: this.type,
      content: this.content,
      tags: [...this.tags],
      importance: this.importance,
      confidence: this.confidence,
      scope: this.scope,
      provenance: this.provenance.toDict(),
      metadata: { ...this.metadata },
      sensitivity: this.sensitivity,
      sensitivity_categories: [...this.sensitivityCategories]
    }
  }
}
