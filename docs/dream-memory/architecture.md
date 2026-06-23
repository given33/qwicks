# Dream Memory System — Architecture

## Overview

The Dream Memory System is a long-term, semantic memory backend integrated
into the QWicks agent runtime. It learns from chat history, explicit saves,
files, and connected apps (Gmail/Drive), then uses that context to
personalize answers, rewrite search queries, and run background
consolidation ("dreaming").

## Module Layout

```
qwicks/src/dream/
  types.ts              Core data model (MemoryItem, SourceRecord, SuppressionRule, TemporalState...)
  config.ts             DreamConfig (embedding/llm/retrieval tuning)
  storage/
    repository.ts       MemoryRepository interface
    sqlite-repository.ts SQLite impl (memory, source_record, suppression_rule, memory_source_link, dream_job tables)
  embeddings/
    base.ts             Embedder interface
    hash-provider.ts    HashEmbedder (BoW fallback, zero-dep)
    http-provider.ts    HttpEmbedder (OpenAI-compatible /embeddings)
    router.ts           EmbeddingRouter (HTTP→hash failover)
    zvec-adapter.ts     ZvecVectorIndex (PQ quantization, zvec integration)
  vectordb/
    flat-index.ts       FlatVectorIndex (brute-force cosine)
    ivf-index.ts        IvfVectorIndex (K-means buckets)
  extraction/
    heuristic-extractor.ts  HeuristicExtractor (sentence splitting, question filter)
    llm-extractor.ts        LlmExtractor (injected chat fn)
    router.ts               ExtractionRouter (LLM→heuristic fallback)
  security/
    sanitizer.ts        sanitizeForMemory (PII/injection/secret)
  retrieval/
    pipeline.ts         RetrievalPipeline (5-channel hybrid + 4 gates + async embed)
    judicious.ts        JudiciousDemote (generic question detection)
    observable-gate.ts  ObservableGate (judicious + freshness + user-correction)
    injection-decision.ts SelectiveInjectionRouter (5-D injection decision)
  conflict/
    engine.ts           compare/decide (duplicate/supersede/contradict + location-slot)
  temporal/
    engine.ts           recencyScore (binary half-life), assess, filterActive
  refresh/
    scheduler.ts        DreamingScheduler (decay + temporal + top-of-mind)
    temporal-dreamer.ts TemporalDreamer (planned→occurred)
    top-of-mind.ts      TopOfMindBalancer (salience/recency scoring)
  controls/
    api.ts              MemoryControls (CRUD + source + suppression + cascade + versions)
  chat/
    pipeline.ts         DreamMemorySystem (beforeTurn/afterTurn/retrieve middleware)
    model-chat-adapter.ts adaptModelClientToDreamChat (LLM injection)
  connectors/
    oauth.ts            OAuthTokenStore (AES-256-GCM)
    gmail.ts            GmailConnector (real Gmail API)
    drive.ts            DriveConnector (real Drive API)
  memory_summary/       buildMemorySummary (7-section)
  memory_sources/       buildMemoryLedger (used/downranked/suppressed/skipped)
  query_rewrite/        rewriteQuery (diet/location slot-fill)
  pulse/                generatePulseTopics + buildPulseDigest
  prompt_builder/       NaturalPromptBuilder (no id/score leakage)
  user_state/           TwinBuilder (digital twin)
  synthesis/            HeuristicSynthesizer + LlmSynthesizer
  evaluation/           harness + dataset + stress-gen
```

## Data Flow

### Read Path (beforeTurn)
```
AgentLoop.retrieveMemories()
  → DreamMemorySystem.beforeTurn()
    → temporary/off short-circuit (zero read)
    → RetrievalPipeline.retrieve() [5 channels: vector/BM25/exact/recency/importance]
      → embedQuery() [async-first: HttpEmbedder → HashEmbedder fallback]
    → ObservableGate [judicious demote + freshness boost + user-correction demote]
    → filterSuppressedHits [memory/topic-level suppression]
    → SelectiveInjectionRouter [5-D: intent/relevance/risk/utility/budget]
    → rewriteQuery [diet/location slot-fill for web_search]
    → statusHints {remembering, personalizing, sources, rewrittenQueryFromMemory}
```

### Write Path (afterTurn)
```
AgentLoop.runTurn() finally block
  → DreamMemorySystem.afterTurn()
    → temporary/off short-circuit (zero write)
    → saveChat (user + assistant to chat_log)
    → upsertSource (chat SourceRecord, idempotent by threadId/turnId)
    → ExtractionRouter.extractAsync [LLM → heuristic]
    → sanitizeForMemory [PII/injection/secret reject]
    → persistDrafts [embed → conflict resolve → upsert + sourceIds + temporal]
    → DreamingScheduler.markDirty + auto-tick [decay + temporal + top-of-mind]
```

### AgentLoop Integration
- `memory_status` SSE event: emits remembering/personalizing/sources after beforeTurn
- `memoryRewrite` in ToolHostContext: web_search uses rewritten query
- `dream_stage_failed` error event: fail-open failures are observable
- `memoryMode` (normal/temporary/off): flows renderer → TurnSchema → AgentLoop → Dream
