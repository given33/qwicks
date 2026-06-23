/**
 * Dream 顶层 chat() 编排 —— 1:1 对齐 Python `dream/chat/pipeline.py` 的 12 阶段闭环
 * (见 spec §4 / 0.2)。
 *
 * DreamMemorySystem 是门面:把 storage / embeddings / vectordb / extraction /
 * security / retrieval / conflict / user_state / synthesis / refresh 全部装配起来。
 *
 * 12 阶段:
 *   temporary? → 短路(零副作用)
 *     1) save_chat(user+assistant)
 *     2) opt-out 检查
 *     3) extract(LLM | heuristic)
 *     3.5) security.sanitize(PII redact / injection quarantine / reject)
 *     4) persist_drafts(embed + store + 冲突消解)
 *     5) retrieve(5 通道 + 4 门控)
 *     6) build_twin(早建,供后续)
 *     7) synthesize(twin 更新)+ save_twin
 *     8) prompt_builder.build + source receipt(used_in_prompt 事件)
 *     9) 可选 LLM 回复 / natural fallback
 *    10) dreaming markDirty(不阻塞热路径)
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  MemoryItem,
  MemoryLifecycleStatus,
  MemoryProvenance,
  MemoryScope,
  MemoryType,
  newMemoryId,
  nowIso
} from '../types.js'
import { DreamConfig } from '../config.js'
import { SqliteMemoryRepository } from '../storage/sqlite-repository.js'
import { FlatVectorIndex } from '../vectordb/flat-index.js'
import { HashEmbedder } from '../embeddings/hash-provider.js'
import { EmbeddingRouter } from '../embeddings/router.js'
import { HeuristicExtractor } from '../extraction/heuristic-extractor.js'
import { LlmExtractor } from '../extraction/llm-extractor.js'
import { ExtractionRouter } from '../extraction/router.js'
import { sanitizeForMemory } from '../security/sanitizer.js'
import { RetrievalPipeline, type RetrievalHit } from '../retrieval/pipeline.js'
import { compare, decide } from '../conflict/engine.js'
import {
  FreshnessBoostGate,
  JudiciousDemoteGate,
  ObservableGate,
  UserCorrectionGate,
  type GateReport,
  type UserCorrection
} from '../retrieval/observable-gate.js'
import { decideInjection, type InjectionDecision } from '../retrieval/injection-decision.js'
import { NaturalPromptBuilder, naturalFallbackReply } from '../prompt_builder/natural-builder.js'
import { TwinBuilder } from '../user_state/builder.js'
import { HeuristicSynthesizer, LlmSynthesizer } from '../synthesis/synthesizer.js'
import { DreamingScheduler, MemoryDecay, MemoryReinforcement } from '../refresh/scheduler.js'
import { DreamMemoryStore } from '../dream-store.js'
import { MemoryControls } from '../controls/api.js'
import { buildMemorySummary, type MemorySummary } from '../memory_summary/builder.js'
import { buildMemoryLedger, type BuildLedgerInput, type MemoryLedger } from '../memory_sources/ledger.js'

export interface ChatResult {
  reply: string
  systemBlock: string
  contextBlock: string
  newMemories: MemoryItem[]
  hits: Array<{ item: MemoryItem; score: number }>
  /** 经过 ObservableGate 重排序/剔除后的最终注入集合(suppress 的不在此)。 */
  routedHits: RetrievalHit[]
  twin: ReturnType<TwinBuilder['build']> | null
  extractorBackend: string
  /** Phase 2:ObservableGate 决策汇总(评测/panel 用)。 */
  gateReport: GateReport | null
  /** Phase 2:5 维 SelectiveInjectionRouter 的 query-level "何时用记忆" 决策。 */
  injectionDecision: InjectionDecision | null
}

export interface DreamMemorySystemOptions {
  dataDir: string
  userId?: string
  /** OpenAI 兼容 chat(注入;复用 qwicks compat-model-client 的形态)。不给则纯启发式。 */
  chat?: (msgs: { system: string; user: string }) => Promise<{ text: string }>
  config?: Partial<DreamConfig>
}

/** 用户控制(opt-out / suppress)的最小实现,对齐 Python controls。 */
export class DreamControls {
  private readonly optedOut = new Set<string>()
  optOut(userId: string): void {
    this.optedOut.add(userId)
  }
  optIn(userId: string): void {
    this.optedOut.delete(userId)
  }
  isOptedOut(userId: string): boolean {
    return this.optedOut.has(userId)
  }
}

export class DreamMemorySystem {
  readonly config: DreamConfig
  readonly repository: SqliteMemoryRepository
  /** 适配 qwicks 既有 MemoryStore 接口的扁平视图(runtime 把它喂给 HTTP/工具/agent-loop)。 */
  readonly dreamStore: import('../dream-store.js').DreamMemoryStore
  readonly vectorDb: FlatVectorIndex
  readonly embedder: HashEmbedder
  readonly retrieval: RetrievalPipeline
  readonly extraction: ExtractionRouter
  readonly synthesizer: HeuristicSynthesizer | LlmSynthesizer
  readonly twinBuilder: TwinBuilder
  readonly scheduler: DreamingScheduler
  readonly observableGate: ObservableGate
  readonly promptBuilder = new NaturalPromptBuilder()
  readonly controls = new DreamControls()
  /** Phase 3:用户控制(list/edit/delete/suppress/opt-out/export/purge/versions)。 */
  readonly controls2: MemoryControls
  private readonly userId: string

  constructor(opts: DreamMemorySystemOptions) {
    this.config = new DreamConfig({
      dataDir: opts.dataDir,
      ...(opts.config ?? {})
    })
    this.userId = opts.userId ?? this.config.userId

    mkdirSync(opts.dataDir, { recursive: true })
    this.repository = new SqliteMemoryRepository({ sqlitePath: join(opts.dataDir, 'dream_memory.db') })
    this.dreamStore = new DreamMemoryStore({
      repository: this.repository,
      config: { enabled: true },
      sqlitePath: join(opts.dataDir, 'dream_memory.db')
    })
    this.controls2 = new MemoryControls({ repository: this.repository })

    // embeddings:HTTP 优先 + hash 回退。Phase 1 默认 hash(无 embedding 服务时);
    // 若配置了 embedding baseUrl/model 可换 HTTP。这里 Phase 1 用 hash 保证零依赖可用。
    this.embedder = new HashEmbedder({ dim: 256 })

    this.vectorDb = new FlatVectorIndex({
      dim: this.embedder.dim(),
      persistDir: join(opts.dataDir, 'dream_vectors'),
      autoSaveEvery: 0 // 仅 close() 时显式 save,避免 chat 中途异步落盘与清理竞态
    })

    this.retrieval = new RetrievalPipeline({
      repository: this.repository,
      embedder: this.embedder,
      vectorDb: this.vectorDb
    })
    this.retrieval.warmup()

    // extraction:有 chat → LLM 优先 + heuristic 回退;否则纯 heuristic。
    const heuristic = new HeuristicExtractor()
    if (opts.chat) {
      this.extraction = new ExtractionRouter({
        primary: new LlmExtractor({ chat: opts.chat, model: this.config.llm.model || 'default' }),
        fallback: heuristic
      })
    } else {
      // 无 chat:包一个永远走 fallback 的 router(保留 lastBackend 接口)。
      this.extraction = new ExtractionRouter({
        primary: { name: () => 'no-llm', extractAsync: async () => [] },
        fallback: heuristic
      })
    }

    // synthesis:有 chat → LLM + heuristic 回退;否则 heuristic。
    this.synthesizer = opts.chat
      ? new LlmSynthesizer({ chat: opts.chat, model: this.config.llm.model || 'default' })
      : new HeuristicSynthesizer()

    this.twinBuilder = new TwinBuilder()
    const decay = new MemoryDecay({ repository: this.repository })
    const reinforcement = new MemoryReinforcement({ repository: this.repository })
    this.scheduler = new DreamingScheduler({ decay, reinforcement })

    // Phase 2:ObservableGate(judicious + freshness + user_correction 三 gate orchestrate)
    this.observableGate = new ObservableGate()
      .add(new JudiciousDemoteGate(-0.1))
      .add(new FreshnessBoostGate(-0.2, 0.1))
      .add(new UserCorrectionGate(-0.3))
  }

  /** 记录用户纠错(panel "这条记忆不该出现" / console.correct),后续 gate 主动 demote。 */
  recordCorrection(correction: UserCorrection): void {
    this.observableGate.recordCorrection(correction)
  }

  async chat(
    userId: string,
    message: string,
    opts: {
      assistant?: string | null
      threadId?: string | null
      turnId?: string | null
      temporary?: boolean
      /** 上下文 token 预算(影响 injection budget 维度)。 */
      contextBudgetTokens?: number
      /** 安全敏感上下文(降低 injection risk 维度)。 */
      isSafetyContext?: boolean
    } = {}
  ): Promise<ChatResult> {
    const threadId = opts.threadId ?? null
    const turnId = opts.turnId ?? null

    // P1-4: temporary chat → 100% invisible, zero side-effects
    if (opts.temporary) {
      return {
        reply: '',
        systemBlock: '',
        contextBlock: '',
        newMemories: [],
        hits: [],
        routedHits: [],
        twin: null,
        extractorBackend: 'temporary_skip',
        gateReport: null,
        injectionDecision: null
      }
    }

    // 2) opt-out —— 必须在 saveChat 之前(opt-out 用户不应留下任何 chat_log 副作用,
    // 对齐文档 §4.7 "Memory 关闭=不读不写")。检查两套:in-memory DreamControls(快速
    // 短路)+ 持久化 MemoryControls.isOptedOut(用户通过 controls2.optOut 落库的标记)。
    if (this.controls.isOptedOut(userId) || this.controls2.isOptedOut(userId)) {
      return {
        reply: '(该用户已禁用 Dream 记忆系统 / Dream memory is disabled for this user)',
        systemBlock: '',
        contextBlock: '',
        newMemories: [],
        hits: [],
        routedHits: [],
        twin: null,
        extractorBackend: 'opt_out',
        gateReport: null,
        injectionDecision: null
      }
    }

    // 1) save chat (permanent only; opt-out 用户已在上面短路,不会落 chat_log)
    this.repository.saveChat(userId, 'user', message, { threadId, turnId })
    if (opts.assistant) {
      this.repository.saveChat(userId, 'assistant', opts.assistant, { threadId, turnId })
    }

    // 3) extract
    const drafts = await this.extraction.extractAsync({ user: message, assistant: opts.assistant ?? null })

    // 3.5) sanitize each draft (REDACT/QUARANTINE/REJECT)
    const sanitizedDrafts = drafts.filter((d) => {
      const res = sanitizeForMemory(d.content, { source: d.provenance.source })
      if (res.decision === 'reject') return false
      if (res.decision === 'redact') d.content = res.sanitized
      return true
    })

    // 4) persist drafts (embed + store + conflict resolution)
    const newMemories = this.persistDrafts(sanitizedDrafts, userId, threadId, turnId)

    // 5) retrieve
    const hits = await this.retrieval.retrieve({
      userId,
      query: message,
      topK: this.config.retrieval.topK
    })

    // 5.5) Phase 2: ObservableGate —— 跑 judicious/freshness/user_correction 三 gate,
    // score_after 写回, suppress(score_after ≤ 0.05)的剔除出注入集。
    const allItems = this.repository.list(userId, {})
    const gateReport = this.observableGate.run({
      userId,
      query: message,
      candidates: hits.map((h) => ({ item: h.item, score: h.score })),
      allUserItems: allItems
    })
    let routedHits = gateReport.decisions
      .filter((d) => d.finalDecision !== 'suppress')
      .map((d) => {
        const h = hits.find((x) => x.item.id === d.memoryId)!
        return { ...h, score: Math.max(0, d.scoreAfter) }
      })
      .sort((a, b) => b.score - a.score)

    // 5.6) Phase 2: SelectiveInjectionRouter —— 5 维 query-level "何时用记忆" 判断。
    // 先判断本次请求是否会被个性化上下文改善(spec §7.3);shouldInject=false 则不注入
    // (routedHits 清空),但决策仍然 surface 到 ChatResult 供评测/panel。
    const injectionDecision = decideInjection({
      query: message,
      availableMemories: routedHits.map((h) => h.item),
      userId,
      threadId: threadId ?? undefined,
      isSafetyContext: opts.isSafetyContext,
      contextBudgetTokens: opts.contextBudgetTokens ?? 4000
    })
    if (!injectionDecision.shouldInject) {
      routedHits = []
    }

    // 6) build twin (early, for synthesis) — 用 routedHits(已 gate 过)
    let twin = this.twinBuilder.build({
      userId,
      memories: allItems,
      hits: routedHits.map((h) => ({ item: h.item, score: h.score }))
    })

    // 7) synthesize (update twin)
    const synthInput = {
      hits: routedHits,
      user: message,
      assistant: opts.assistant ?? null,
      twin,
      userId
    }
    const synthResult = this.synthesizer instanceof LlmSynthesizer
      ? await this.synthesizer.synthesizeAsync(synthInput)
      : this.synthesizer.synthesize(synthInput)
    twin = synthResult.twin
    this.repository.saveTwin(userId, JSON.stringify({ ...twin, user_id: twin.userId }), twin.generatedAt)

    // 8) prompt build (NaturalPromptBuilder) + source receipts(用 routedHits)
    const built = this.promptBuilder.build({
      userId,
      query: message,
      twin,
      hits: routedHits,
      maxChars: this.config.prompt.maxSectionChars * 8
    })
    const contextBlock = built.contextBlock
    for (let pos = 0; pos < routedHits.length; pos++) {
      const h = routedHits[pos]!
      this.repository.logEvent('used_in_prompt', {
        recordId: h.item.id,
        userId,
        payload: { turn_id: turnId, thread_id: threadId, query: message, position: pos, retrieval_score: h.score }
      })
    }

    // 9) reply (natural fallback; LLM reply wired in Phase 2/3 controls)
    const reply = naturalFallbackReply({ twin, hasHits: routedHits.length > 0, hits: routedHits, query: message })

    // 10) dreaming: mark dirty (non-blocking; scheduler ticks in background)
    if (newMemories.length > 0) this.scheduler.markDirty(userId)

    return {
      reply,
      systemBlock: built.system,
      contextBlock,
      newMemories,
      hits,
      routedHits,
      twin,
      extractorBackend: this.extraction.lastBackend(),
      gateReport,
      injectionDecision
    }
  }

  /** 4) persist drafts:分配 id,embed,store,做冲突消解(对齐 Python _persist_drafts)。 */
  private persistDrafts(
    drafts: ReturnType<HeuristicExtractor['extract']>,
    userId: string,
    threadId: string | null,
    turnId: string | null
  ): MemoryItem[] {
    const out: MemoryItem[] = []
    const existing = this.repository.list(userId, {})
    for (const draft of drafts) {
      const item = new MemoryItem(
        newMemoryId(),
        userId,
        draft.type,
        draft.content,
        draft.scope,
        [...draft.tags],
        draft.importance,
        draft.confidence,
        nowIso(),
        nowIso(),
        null,
        new MemoryProvenance(
          draft.provenance.source,
          draft.provenance.actor,
          threadId,
          turnId,
          draft.provenance.confidence,
          draft.provenance.model
        ),
        null,
        null,
        [],
        { ...draft.metadata },
        MemoryLifecycleStatus.ACTIVE,
        [],
        2
      )
      // 冲突消解:对新 item vs existing 逐个 compare,若 SUPERSEDES/CONTRADICTS 则处理旧 item。
      for (const ex of existing) {
        const a = compare(item, ex)
        const action = decide(a)
        if (action === 'supersede_old') {
          ex.transitionStatus(MemoryLifecycleStatus.SUPERSEDED, { actor: 'chat.persist', reason: 'superseded by newer' })
          this.repository.upsert(ex)
        }
        // duplicate / contradicts:Phase 1 暂不合并/不阻塞(contradicts 留给 Phase 3 ask-user)
      }
      // embed + store
      const v = this.embedder.embed(item.content)
      if (v) {
        item.embedding = v
        item.embeddingModel = this.embedder.name()
      }
      this.repository.upsert(item)
      this.retrieval.onIndexChanged(item)
      out.push(item)
    }
    return out
  }

  /** Phase 3:构建用户的 7 区 Memory Summary。 */
  buildSummary(userId: string): MemorySummary {
    const items = this.repository.list(userId, { includeDeleted: false, includeSuppressed: true, includeExpired: true })
    return buildMemorySummary(items, { userId })
  }

  /** Phase 3:构建本次回答的 Memory Sources ledger(used/downranked/suppressed/skipped)。 */
  buildLedger(input: BuildLedgerInput): MemoryLedger {
    return buildMemoryLedger({
      ...input,
      allUserItems: input.allUserItems ?? this.repository.list(input.userId, { includeDeleted: false, includeSuppressed: true, includeExpired: true })
    })
  }

  close(): void {
    this.scheduler.stop()
    try {
      this.vectorDb.save()
    } catch {
      // 持久化失败不致命
    }
    this.repository.close()
  }
}
