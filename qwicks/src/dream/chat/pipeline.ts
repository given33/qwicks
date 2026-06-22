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
import { RetrievalPipeline } from '../retrieval/pipeline.js'
import { compare, decide } from '../conflict/engine.js'
import { TwinBuilder } from '../user_state/builder.js'
import { HeuristicSynthesizer, LlmSynthesizer } from '../synthesis/synthesizer.js'
import { DreamingScheduler, MemoryDecay, MemoryReinforcement } from '../refresh/scheduler.js'

export interface ChatResult {
  reply: string
  systemBlock: string
  contextBlock: string
  newMemories: MemoryItem[]
  hits: Array<{ item: MemoryItem; score: number }>
  twin: ReturnType<TwinBuilder['build']> | null
  extractorBackend: string
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
  readonly vectorDb: FlatVectorIndex
  readonly embedder: HashEmbedder
  readonly retrieval: RetrievalPipeline
  readonly extraction: ExtractionRouter
  readonly synthesizer: HeuristicSynthesizer | LlmSynthesizer
  readonly twinBuilder: TwinBuilder
  readonly scheduler: DreamingScheduler
  readonly controls = new DreamControls()
  private readonly userId: string

  constructor(opts: DreamMemorySystemOptions) {
    this.config = new DreamConfig({
      dataDir: opts.dataDir,
      ...(opts.config ?? {})
    })
    this.userId = opts.userId ?? this.config.userId

    mkdirSync(opts.dataDir, { recursive: true })
    this.repository = new SqliteMemoryRepository({ sqlitePath: join(opts.dataDir, 'dream_memory.db') })

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
  }

  async chat(
    userId: string,
    message: string,
    opts: { assistant?: string | null; threadId?: string | null; turnId?: string | null; temporary?: boolean } = {}
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
        twin: null,
        extractorBackend: 'temporary_skip'
      }
    }

    // 1) save chat (permanent only)
    this.repository.saveChat(userId, 'user', message, { threadId, turnId })
    if (opts.assistant) {
      this.repository.saveChat(userId, 'assistant', opts.assistant, { threadId, turnId })
    }

    // 2) opt-out
    if (this.controls.isOptedOut(userId)) {
      return {
        reply: '(该用户已禁用 Dream 记忆系统 / Dream memory is disabled for this user)',
        systemBlock: '',
        contextBlock: '',
        newMemories: [],
        hits: [],
        twin: null,
        extractorBackend: 'opt_out'
      }
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

    // 6) build twin (early, for synthesis)
    const allItems = this.repository.list(userId, {})
    let twin = this.twinBuilder.build({
      userId,
      memories: allItems,
      hits: hits.map((h) => ({ item: h.item, score: h.score }))
    })

    // 7) synthesize (update twin)
    const synthInput = {
      hits,
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

    // 8) prompt build + source receipts
    const contextBlock = this.buildContextBlock(twin, hits)
    for (let pos = 0; pos < hits.length; pos++) {
      const h = hits[pos]!
      this.repository.logEvent('used_in_prompt', {
        recordId: h.item.id,
        userId,
        payload: { turn_id: turnId, thread_id: threadId, query: message, position: pos, retrieval_score: h.score }
      })
    }

    // 9) reply (natural fallback; LLM reply wired in Phase 2/3 controls)
    const reply = this.naturalReply(twin, hits, message)

    // 10) dreaming: mark dirty (non-blocking; scheduler ticks in background)
    if (newMemories.length > 0) this.scheduler.markDirty(userId)

    return {
      reply,
      systemBlock: this.config.prompt.twinHeader,
      contextBlock,
      newMemories,
      hits,
      twin,
      extractorBackend: this.extraction.lastBackend()
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

  private buildContextBlock(
    twin: ReturnType<TwinBuilder['build']>,
    hits: Array<{ item: MemoryItem; score: number }>
  ): string {
    const lines: string[] = [this.config.prompt.twinHeader]
    if (twin.profile) lines.push(`[孪生摘要] ${twin.profile}`)
    if (hits.length > 0) {
      lines.push('[相关记忆]')
      for (const h of hits.slice(0, this.config.prompt.maxBuckets)) {
        lines.push(`- (${h.item.type}) ${h.item.content}`)
      }
    }
    return lines.join('\n')
  }

  private naturalReply(
    twin: ReturnType<TwinBuilder['build']>,
    hits: Array<{ item: MemoryItem; score: number }>,
    _query: string
  ): string {
    const parts: string[] = []
    if (twin.profile) parts.push(`我记得:${twin.profile.slice(0, 120)}`)
    if (hits.length > 0) {
      parts.push(`这一轮用到 ${hits.length} 条相关记忆,其中:"${hits[0]!.item.content.slice(0, 60)}"`)
    }
    if (parts.length === 0) parts.push('我记下了,暂时没有更多上下文,你可以继续说下去。')
    return parts.join('。')
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
