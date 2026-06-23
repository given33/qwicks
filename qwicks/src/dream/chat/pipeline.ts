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
import { rewriteQuery, type RewriteResult } from '../query_rewrite/rewriter.js'
import { generatePulseTopics, buildPulseDigest, type PulseDigest, type PulseResearchFn } from '../pulse/engine.js'
import { OAuthTokenStore, OAuthToken, type RefreshNetwork } from '../connectors/oauth.js'
import { GmailConnector } from '../connectors/gmail.js'
import { DriveConnector } from '../connectors/drive.js'

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
  /** Phase 4:记忆改写后的搜索查询(供 web search / tool 调用使用,doc §3.5)。 */
  rewrittenQuery: RewriteResult | null
  /** 每阶段的 fail-open 错误记录(空=全部成功)。 */
  failures: string[]
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
  /** Phase 5:连接器 OAuth token 存储(加密)。 */
  readonly oauthStore: OAuthTokenStore
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
    this.oauthStore = new OAuthTokenStore({ persistDir: join(opts.dataDir, 'oauth') })

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
        injectionDecision: null,
        rewrittenQuery: null,
        failures: []
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
        injectionDecision: null,
        rewrittenQuery: null,
        failures: []
      }
    }

    // 1) save chat (permanent only; opt-out 用户已在上面短路,不会落 chat_log)
    this.repository.saveChat(userId, 'user', message, { threadId, turnId })
    if (opts.assistant) {
      this.repository.saveChat(userId, 'assistant', opts.assistant, { threadId, turnId })
    }

    // 以下每步都 try/catch fail-open(对齐 spec §8 "每一步都用 try/catch fail-open")。
    // 任何步骤失败不中断整个 turn,记录到 failures[] 供可观测。
    const failures: string[] = []

    // 3) extract
    let drafts: Awaited<ReturnType<typeof this.extraction.extractAsync>> = []
    try {
      drafts = await this.extraction.extractAsync({ user: message, assistant: opts.assistant ?? null })
    } catch (err) { failures.push(`extract: ${String(err)}`) }

    // 3.5) sanitize each draft (REDACT/QUARANTINE/REJECT)
    let sanitizedDrafts = drafts.filter((d) => {
      try {
        const res = sanitizeForMemory(d.content, { source: d.provenance.source })
        if (res.decision === 'reject') return false
        if (res.findings.some((f) => f.kind.startsWith('injection_'))) return false
        if (res.decision === 'redact') d.content = res.sanitized
        return true
      } catch { return false }
    })

    // 4) persist drafts (embed + store + conflict resolution)
    let newMemories: MemoryItem[] = []
    try {
      newMemories = this.persistDrafts(sanitizedDrafts, userId, threadId, turnId)
    } catch (err) { failures.push(`persist: ${String(err)}`) }

    // 5) retrieve
    let hits: RetrievalHit[] = []
    try {
      hits = await this.retrieval.retrieve({ userId, query: message, topK: this.config.retrieval.topK })
    } catch (err) { failures.push(`retrieve: ${String(err)}`) }

    // 5.5) ObservableGate
    const allItems = this.repository.list(userId, {})
    let gateReport: GateReport | null = null
    let routedHits: RetrievalHit[] = []
    try {
      gateReport = this.observableGate.run({
        userId, query: message,
        candidates: hits.map((h) => ({ item: h.item, score: h.score })),
        allUserItems: allItems
      })
      routedHits = gateReport.decisions
        .filter((d) => d.finalDecision !== 'suppress')
        .map((d) => { const h = hits.find((x) => x.item.id === d.memoryId)!; return { ...h, score: Math.max(0, d.scoreAfter) } })
        .sort((a, b) => b.score - a.score)
    } catch (err) { failures.push(`gate: ${String(err)}`); routedHits = [...hits] }

    // 5.6) SelectiveInjectionRouter
    let injectionDecision: InjectionDecision | null = null
    try {
      injectionDecision = decideInjection({
        query: message, availableMemories: routedHits.map((h) => h.item), userId,
        threadId: threadId ?? undefined, isSafetyContext: opts.isSafetyContext,
        contextBudgetTokens: opts.contextBudgetTokens ?? 4000
      })
      if (!injectionDecision.shouldInject) routedHits = []
    } catch (err) { failures.push(`injection: ${String(err)}`) }

    // 5.7) Query Rewrite
    let rewrittenQuery: RewriteResult | null = null
    try {
      rewrittenQuery = rewriteQuery({ userId, query: message, memories: this.repository.list(userId, {}) })
    } catch (err) { failures.push(`rewrite: ${String(err)}`) }

    // 6-7) build twin + synthesize
    let twin: ReturnType<TwinBuilder['build']> | null = null
    try {
      twin = this.twinBuilder.build({ userId, memories: allItems, hits: routedHits.map((h) => ({ item: h.item, score: h.score })) })
      const synthInput = { hits: routedHits, user: message, assistant: opts.assistant ?? null, twin, userId }
      const synthResult = this.synthesizer instanceof LlmSynthesizer
        ? await this.synthesizer.synthesizeAsync(synthInput)
        : this.synthesizer.synthesize(synthInput)
      twin = synthResult.twin
      this.repository.saveTwin(userId, JSON.stringify({ ...twin, user_id: twin.userId }), twin.generatedAt)
    } catch (err) { failures.push(`synthesize: ${String(err)}`) }

    // 8) prompt build + source receipts
    let built: ReturnType<typeof this.promptBuilder.build> | null = null
    try {
      built = this.promptBuilder.build({
        userId, query: message,
        twin: injectionDecision?.shouldInject ? twin : null,
        hits: routedHits, maxChars: this.config.prompt.maxSectionChars * 8
      })
      for (let pos = 0; pos < routedHits.length; pos++) {
        const h = routedHits[pos]!
        this.repository.logEvent('used_in_prompt', { recordId: h.item.id, userId, payload: { turn_id: turnId, thread_id: threadId, query: message, position: pos, retrieval_score: h.score } })
      }
    } catch (err) { failures.push(`prompt: ${String(err)}`) }

    // 9) reply
    const reply = naturalFallbackReply({ twin, hasHits: routedHits.length > 0, hits: routedHits, query: message })

    // 10) dreaming: mark dirty + auto-tick(对齐审计修复:dreaming 不应积压不执行)
    if (newMemories.length > 0) {
      this.scheduler.markDirty(userId)
      // 在 microtask 里非阻塞跑一次 tick,让 decay/reinforce 真正执行
      void Promise.resolve().then(() => { try { this.scheduler.tick({ userId }) } catch { /* non-blocking */ } })
    }

    return {
      reply,
      systemBlock: built?.system ?? '',
      contextBlock: built?.contextBlock ?? '',
      newMemories,
      hits,
      routedHits,
      twin,
      extractorBackend: this.extraction.lastBackend(),
      gateReport,
      injectionDecision,
      rewrittenQuery,
      failures
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
      // 先 embed(必须在冲突消解之前,让 cosine 通道能工作 — 审计修复)
      const v = this.embedder.embed(item.content)
      if (v) {
        item.embedding = v
        item.embeddingModel = this.embedder.name()
      }
      // 冲突消解:对新 item vs existing 逐个 compare,根据 verdict 处理。
      for (const ex of existing) {
        const a = compare(item, ex)
        const action = decide(a)
        if (action === 'supersede_old') {
          ex.transitionStatus(MemoryLifecycleStatus.SUPERSEDED, { actor: 'chat.persist', reason: 'superseded by newer' })
          this.repository.upsert(ex)
        } else if (action === 'merge_into_existing') {
          // DUPLICATE:跳过插入(旧记忆已覆盖此内容)
          return out
        } else if (action === 'ask_user_or_invalidate_old') {
          // CONTRADICTS:标记旧记忆为 HYPOTHESIS(待用户确认),新记忆照常插入
          ex.transitionStatus(MemoryLifecycleStatus.HYPOTHESIS, { actor: 'chat.persist', reason: 'contradicts new memory' })
          this.repository.upsert(ex)
        }
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

  /** Phase 6 审计修复:轻量级语义检索接口(供 agent-loop 直接调用,非 chat 全流程)。 */
  async retrieve(query: string, userId: string, topK: number): Promise<Array<{ item: MemoryItem; score: number }>> {
    const hits = await this.retrieval.retrieve({ userId, query, topK })
    // 跑 ObservableGate(轻量)
    const allItems = this.repository.list(userId, {})
    const gateReport = this.observableGate.run({ userId, query, candidates: hits.map((h) => ({ item: h.item, score: h.score })), allUserItems: allItems })
    return gateReport.decisions
      .filter((d) => d.finalDecision !== 'suppress')
      .map((d) => { const h = hits.find((x) => x.item.id === d.memoryId)!; return { item: h.item, score: Math.max(0, d.scoreAfter) } })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  /** Phase 5:从 Gmail 拉取邮件,抽取记忆(带 connector source lineage)。 */
  async ingestGmail(account: string, opts: { maxResults?: number; fetchImpl?: typeof fetch } = {}): Promise<{ ingested: number }> {
    const token = this.oauthStore.load(account)
    if (!token) throw new Error(`no oauth token for ${account}`)
    const gmail = new GmailConnector({ token, fetchImpl: opts.fetchImpl })
    const msgs = await gmail.list({ maxResults: opts.maxResults ?? 20 })
    let ingested = 0
    for (const m of msgs) {
      const full = await gmail.fetch(m.id)
      const drafts = gmail.extractDrafts(full, account)
      for (const d of drafts) {
        this.persistDrafts([d], account, null, null)
        ingested += 1
      }
    }
    return { ingested }
  }

  /** Phase 5:从 Drive 拉取文件,抽取记忆(带 connector source lineage)。 */
  async ingestDrive(account: string, opts: { maxResults?: number; fetchImpl?: typeof fetch } = {}): Promise<{ ingested: number }> {
    const token = this.oauthStore.load(account)
    if (!token) throw new Error(`no oauth token for ${account}`)
    const drive = new DriveConnector({ token, fetchImpl: opts.fetchImpl })
    const files = await drive.list({ maxResults: opts.maxResults ?? 10 })
    let ingested = 0
    for (const f of files) {
      const content = await drive.fetchContent(f)
      const drafts = drive.extractDrafts({ fileId: f.id, fileName: f.name, content }, account)
      for (const d of drafts) {
        this.persistDrafts([d], account, null, null)
        ingested += 1
      }
    }
    return { ingested }
  }

  /** Phase 5:撤销连接器授权 → CONNECTOR_REVOKED tombstone(文档 §8.1 删除一致性)。 */
  revokeConnector(account: string, userId: string): { affected: number } {
    this.oauthStore.delete(account)
    // 把该 account 来源的 connector memory 全部标记 CONNECTOR_REVOKED。
    // 同时按 userId 和 account 搜索(ingest 时可能用 account 作 userId)。
    const candidates = [
      ...this.repository.list(userId, { includeDeleted: true, includeSuppressed: true, includeExpired: true }),
      ...(userId !== account ? this.repository.list(account, { includeDeleted: true, includeSuppressed: true, includeExpired: true }) : [])
    ]
    const seen = new Set<string>()
    let affected = 0
    for (const it of candidates) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      if (it.provenance.source === 'connector' && it.metadata.source_account === account) {
        it.transitionStatus(MemoryLifecycleStatus.CONNECTOR_REVOKED, { actor: 'connector.revoke', reason: `account ${account} revoked` })
        this.repository.upsert(it)
        affected += 1
      }
    }
    return { affected }
  }

  /** Phase 4:运行一轮 Pulse(夜间异步研究)。research 函数可注入(默认 no-op 占位)。 */
  async runPulse(userId: string, opts: { research?: PulseResearchFn; maxTopics?: number } = {}): Promise<PulseDigest> {
    const memories = this.repository.list(userId, {})
    // 文档 §7:Pulse 同时参考 saved memories + chat history(两个 source 都开)。
    const recentChats = this.repository.loadRecentChats(userId, 50)
    const topics = generatePulseTopics(memories, {
      userId,
      maxTopics: opts.maxTopics,
      recentChats: recentChats.map((c) => ({ role: c.role, content: c.content }))
    })
    const research: PulseResearchFn = opts.research ?? (async (query) => ({ query, summary: '(未配置 research 函数)', sources: [], followUps: [] }))
    return buildPulseDigest({ userId, topics, research })
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
