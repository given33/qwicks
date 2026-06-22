# Dream 记忆系统 — 总体设计文档

- **生成时间**:2026-06-23
- **目标**:把基于 OpenAI ChatGPT Memory & Dreaming 文档设计、原本用 Python 实现到一半的 `dream` 记忆系统,**全量用 TypeScript 重写**进 qwicks runtime,不丢失任何原有能力,并补齐文档要求但原项目未尽的功能,最终**彻底取代** qwicks 现有的 n-gram 关键词记忆系统。
- **来源文档**:`openai-chatgpt-memory-dreaming-detailed-cn.docx`(3 个官方来源归纳:OpenAI 2026-06-04《Dreaming: Better memory for a more helpful ChatGPT》、Help Center《Memory FAQ》、《How does Reference saved memories work?》)。
- **原 Python 实现**:`C:/Users/given/Desktop/dream/`(~97K LOC,核心闭环完整但连接器 mock 化、Postgres 后端有 bug、Tier-A 540 延迟未达标)。

---

## 0. 现状基线(决定了"取代"与"不丢功能"的具体含义)

### 0.1 原 Python `dream` 已具备的能力(全部需在 TS 端重建)

| 子系统 | Python 实现位置 | 状态 | 核心机制 |
| --- | --- | --- | --- |
| 事实抽取 | `dream/extraction/` | 完整 | Qwen3Extractor(OpenAI 兼容客户端) + HeuristicExtractor 回退 + ExtractionRouter 路由 + LoopExtractor 4 步循环 |
| PII/注入净化 | `dream/security/` | 完整 | sanitize_for_memory:REDACT/QUARANTINE/REJECT 三态决策 |
| Embedding | `dream/embeddings/` | 完整 | BGE-M3 真后端 + Hash 回退 + batch_cache + warmup + GPU guard + resident service |
| 向量库 | `dream/vectordb/` | 完整 | FAISS + Numpy + zVec 三后端,registry 模式 + health_check |
| 存储 | `dream/storage/repository.py` | SQLite 稳 / Postgres 有 bug | SQLite DDL + upsert/get/list/delete + chat log + twin + 事件日志 + status 过滤 |
| 生命周期 | `dream/models/types.py` MemoryLifecycleStatus | 完整 | 9 态状态机(ACTIVE/SUPPRESSED/EXPIRED/SUPERSEDED/DELETED/CONNECTOR_REVOKED/ARCHIVED/HYPOTHESIS/CONFIRMED)+ status_history + schema_version 迁移 |
| 混合检索 | `dream/retrieval/pipeline.py` | 完整 | 向量 + BM25 + exact + recency + importance 五通道综合打分 + 4 道硬门控(status/suppressed/expired/do_not_inject)+ 跨用户隔离 |
| 冲突消解 | `dream/conflict/engine.py` | 完整 | duplicate/supersede/contradict 判定 + 置信度逻辑 + 状态机 + supersede 传播 |
| 时序推理 | `dream/temporal/engine.py` | 完整 | 指数衰减 + 时间短语检测 + 7 态时序状态机 |
| 图谱 | `dream/graph/` | 完整 | in-memory + Neo4j adapter + auto_link + ResilientAutoLinkService |
| 数字孪生 | `dream/user_state/builder.py` | 完整 | TwinBuilder + CanonicalPreferenceLifter |
| 合成 | `dream/synthesis/base.py` | 完整 | LLMSynthesizer + LoopSynthesizer |
| Dreaming 后台 | `dream/refresh/` | 完整 | MemoryDecay + MemoryReinforcement + MemoryRefresh + DreamingScheduler + advanced.py(L1/L2 分层洞察 + ForgettingService + SelectiveInjectionRouter + TraitScorer + MemoryTimeline) |
| Prompt 注入 | `dream/prompt_builder/builder.py` + `natural_builder.py` | 完整 | 按类型分组 context block + twin profile + 截断 + canonical_traits + 自然语言 builder(env-gated) |
| Controls | `dream/controls/api.py` | 完整 | list/get/edit/delete(soft/hard)/opt_out/opt_in/is_opted_out/export/purge |
| API | `dream/api/server.py` | 完整 | FastAPI HTTP + WebSocket |
| CLI | `dream/cli/main.py` | 完整 | chat/show/add/edit/rm/export/opt-out/opt-in/dream/eval/serve |
| 评测 | `dream/evaluation/` | 完整 | 540 用例 + Tier A/B/C + precision/recall/MRR + redteam + panel e2e + parity |
| Connectors | `dream/connectors/` | **mock HTTP** | OAuth URL/token 真实,list/fetch 读本地 fixture,**不联网** |

### 0.2 原 chat() 编排闭环(必须在 TS 端 1:1 重建)

来源:`dream/chat/pipeline.py:608-863`,12 阶段:

```
temporary? → 短路返回零副作用
  → 1) save_chat(user + assistant)
  → 2) opt-out 检查
  → 3) extract(LLM | heuristic)
  → 3.5) security.sanitize(PII redact / injection quarantine / reject)
  → 4) _persist_drafts(embed + store)
  → 4.5) timeline.record + trait_scorer.update
  → 5) retrieve(TopK 五通道)
  → 5.1) build_twin
  → 5.2) RelevanceRouter(6 维重排序,如启用)
  → ObservableGate(score_before/after/reason/decision 写回 hit.score)
  → 5.5) SelectiveInjectionRouter(length cap / per-type 限制)
  → 7) synth(twin 更新)+ trait scores 注入 twin + save_twin
  → 8) prompt_builder.build + source receipt 持久化(used_in_prompt 事件)
  → 9) 可选 LLM 调用(复用 prompt_builder 输出,不二次拼接)
  → fallback natural_fallback_reply
  → 10) dreaming:mark_dirty + 后台 scheduler(不阻塞热路径)
```

### 0.3 qwicks 现有记忆系统(被取代对象)

- 位置:`qwicks/src/memory/memory-store.ts`(`FileMemoryStore`)、`qwicks/src/contracts/memory.ts`
- 机制:**纯 n-gram 关键词**(ASCII trigram + CJK bigram)overlap × confidence,user scope 全量注入,workspace/project 走打分 top-N
- 数据模型:`MemoryRecord` zod schema(id/content/scope/sourceThreadId/tags/confidence/createdAt/disabledAt/deletedAt)
- 接入点(被取代时全部继承更新):
  - `MemoryStore` interface(memory-store.ts:12-20)
  - HTTP 路由 `server/routes/memory.ts`
  - LLM 工具 `adapters/tool/memory-tool-provider.ts`(memory_create/update/delete)
  - agent-loop 注入 `loop/agent-loop.ts:2569-2581, 2798-2806`
  - mesh 同步 `mesh/integration/memory-store-adapter.ts`
  - GUI `src/renderer/src/components/settings-section-memory.tsx`
- **pet 玩具(`pet:*` IPC)与记忆系统无关,本次完全不动。**

---

## 1. 已锁定的架构决策

| 决策项 | 选择 | 理由 |
| --- | --- | --- |
| 语言/形态 | 全量 TS 重写,融入 qwicks runtime 单进程 | 用户选择方案 2;避免双进程与打包 Python runtime 的负担 |
| 代码位置 | 新建 `qwicks/src/dream/`,与 `memory/` 并存,strangler 渐进迁移 | 先做接口,逐步替换,最终彻底取代;git 历史清晰 |
| Embedding | HTTP 调用 embedding 服务优先 + 哈希向量回退(双轨) | 零重依赖,与 dream 原双轨设计一致;服务不可用时不崩 |
| 向量检索 | 自研 TS 内存向量索引(余弦 + 可选 IVF 分桶) | 零原生依赖,跨平台稳,桌面单用户万级记忆够用;对应 dream Numpy 后端 |
| 存储后端 | SQLite 唯一后端(`better-sqlite3`),`Repository` 接口抽象 | 检索性能/速度最优(O(log n) vs JSON 文件 O(n) 全扫),与 qwicks 现有技术栈一致;**砍掉有 bug 的 Postgres** |
| LLM 调用 | 复用 qwicks `compat-model-client` | 一套模型配置,不引入第二个 LLM 客户端 |
| 接入点 | 实现 `MemoryStore` 接口 + 扩展 `/v1/memory*` 契约 | GUI 无破坏性改动,HTTP 路由/agent-loop 注入/mesh 同步自动继承 |

---

## 2. 数据模型(TS 端,1:1 对齐 Python `models/types.py`)

所有类型用 zod 定义于 `qwicks/src/dream/types.ts`,保证运行时校验与序列化。字段、默认值、状态机语义与 Python `MemoryItem.from_dict` 的迁移逻辑一致。

### 2.1 枚举

```ts
MemoryType       = goal | skill | project | preference | constraint | fact | episode | feedback
DreamMemoryScope = global | user | project | session | thread   // 注意:与 qwicks 现有 MemoryScope 3 值共存
ConflictVerdict  = none | compatible | duplicate | contradicts | supersedes
MemoryLifecycleStatus =
  active | suppressed | expired | superseded | deleted |
  connector_revoked | archived | hypothesis | confirmed
```

### 2.2 MemoryItem(核心,对齐 Python lines 162-315)

字段:`id, userId, type, content, scope, tags[], importance(0-1), confidence(0-1), createdAt, updatedAt, expiresAt?, provenance, embedding?(number[]), embeddingModel?, related[], metadata{}, status, statusHistory[], schemaVersion`。

- `fingerprint()`:sha256(user_id + type + content + sorted tags)[:16],用于去重
- `newId()`:`mem_ + crypto.randomUUID().slice(0,12)`(对齐 Python `mem_ + uuid4().hex[:12]`)
- `transitionStatus(newStatus, {actor, reason})`:状态机迁移,写 statusHistory,同步写 legacy metadata 兼容字段(`__deleted__`/`do_not_inject`/`__expired__`/`__superseded__` 等),保持与 Python 双写语义一致
- `fromDict(raw)`:v1→v2 迁移——旧数据无 status 时,从 metadata `__deleted__`/`do_not_inject`/`__do_not_inject__` tag 推断 status,并置 schemaVersion=1 触发迁移

### 2.3 辅助类型(对齐 Python 其余 dataclass)

`MemoryItemDraft`(提取器输出,无 id/embedding)、`ChatTurn`、`RetrievalQuery`(含 topK/minScore/types/scopes/tags/recencyHalfLifeDays/includeSuppressed)、`RetrievalHit`(item + score + 五通道子分 + source + bm25Score + exactScore + temporalResolution + scoreableText()/auditText() 双表面)、`StatusHistoryEntry`、`DerivationRecord`(L1/L2/synthesized 派生图)、`MemoryProvenance`(source/actor/threadId/turnId/confidence/model/note)、`UserDigitalTwin`(buckets/sections/openGoals/activeProjects/skills/preferences/constraints/recentFacts)、`TwinSection`、`UserStateBucket`、`ConflictAssessment`、`GraphNode`/`GraphEdge`/`GraphSnapshot`、`SynthesisResult`、`PromptBuildRequest`/`PromptBuildResult`(含 canonicalTraits)。

### 2.4 与 qwicks 现有 MemoryRecord 的桥接

- 保留 `MemoryStore` 接口签名不变(create/update/delete/list/retrieve/diagnostics/setLastInjected)
- `DreamMemoryStore` 实现 `MemoryStore`,内部把 `MemoryRecord`(扁平)映射为 `MemoryItem`(富结构):content↔content、scope↔scope、tags↔tags、confidence↔confidence。**Dream 独有富字段(type/importance/status/provenance/embedding)存进 SQLite 的富表列**(不是塞进 metadata),以保证可查询可索引。`MemoryStore` 接口表面(扁平 `MemoryRecord`)完全不变;富字段通过 dream 内部 API 与扩展后的 `/v1/memory` 可选响应字段暴露,旧 GUI 读老字段不受影响
- 扩展 `/v1/memory` 响应:**新增可选字段**(`type, importance, status, provenance, summary`),旧 GUI 只读老字段不受影响;新 GUI 分阶段消费新字段
- **绝不删除/破坏** `contracts/memory.ts` 现有 zod schema(向后兼容)

---

## 3. 模块边界与依赖关系(TS 端目录结构)

```
qwicks/src/dream/
├── types.ts                    // 全部数据类型(对齐 models/types.py)
├── config.ts                   // DreamConfig + 环境变量加载(DREAM_*)
├── index.ts                    // DreamMemorySystem 顶层门面 + chat()
├── storage/
│   ├── repository.ts           // Repository 接口
│   ├── sqlite-repository.ts    // better-sqlite3 实现(DDL + CRUD + chat log + twin + event log)
│   └── migrations.ts           // schema 迁移(v1→v2)
├── embeddings/
│   ├── base.ts                 // EmbeddingProvider 接口
│   ├── http-provider.ts        // OpenAI 兼容 embedding API(优先)
│   ├── hash-provider.ts        // 哈希向量回退(离线/服务挂)
│   └── router.ts               // EmbeddingRouter: http → hash 回退 + 缓存 + warmup
├── vectordb/
│   ├── base.ts                 // VectorStore 接口 + healthCheck
│   ├── flat-index.ts           // 暴力余弦(默认,万级够用)
│   ├── ivf-index.ts            // IVF 分桶(可选,大规模)
│   └── registry.ts             // 后端注册
├── extraction/
│   ├── base.ts                 // Extractor 接口 + HeuristicExtractor 回退
│   ├── llm-extractor.ts        // 复用 compat-model-client,JSON mode 抽取
│   └── router.ts               // ExtractionRouter: llm → heuristic
├── security/
│   └── sanitizer.ts            // sanitizeForMemory: REDACT/QUARANTINE/REJECT
├── retrieval/
│   ├── pipeline.ts             // 五通道混合打分 + 4 道硬门控
│   ├── observable-gate.ts      // ObservableGate(score_before/after/reason/decision)
│   ├── relevance-router.ts     // 6 维相关性重排序(阶段 2)
│   └── injection-router.ts     // SelectiveInjectionRouter(length cap / per-type)
├── conflict/
│   ├── engine.ts               // duplicate/supersede/contradict 判定
│   └── supersede-propagation.ts
├── temporal/
│   └── engine.ts               // 指数衰减 + 时间短语 + 7 态状态机
├── graph/
│   ├── base.ts                 // in-memory 图(无 Neo4j,桌面不需要)
│   └── auto-link.ts            // ResilientAutoLinkService
├── synthesis/
│   └── base.ts                 // LLMSynthesizer + 回退
├── refresh/
│   ├── pipeline.ts             // Decay + Reinforcement + Refresh
│   ├── advanced.ts             // L1/L2 分层洞察 + ForgettingService
│   └── scheduler.ts            // DreamingScheduler(mark_dirty + 后台 interval)
├── user_state/
│   └── builder.ts              // TwinBuilder + CanonicalPreferenceLifter
├── prompt_builder/
│   ├── builder.ts              // 分组 context block + 截断
│   └── natural-builder.ts      // 自然语言 builder(阶段 2)
├── memory_summary/             // 阶段 3: Memory Summary 生成/编辑
├── controls/
│   └── api.ts                  // list/get/edit/delete/opt-out/export/purge
├── query_rewrite/              // 阶段 4: 记忆改写 search query
├── pulse/                      // 阶段 4: 夜间异步研究
├── connectors/                 // 阶段 5: 真实 Gmail/Drive OAuth
├── evaluation/                 // 阶段 6: 540 用例 + Tier gate
└── chat/
    └── pipeline.ts             // 12 阶段 chat 闭环(对齐 0.2)
```

**依赖方向(单向,无环):** `chat/pipeline` → 各子模块;子模块依赖 `types` + `storage` + `embeddings` + `vectordb`;`storage/embeddings/vectordb` 不依赖任何上层。

---

## 4. chat() 闭环(TS 端,对齐 0.2 的 12 阶段)

`DreamMemorySystem.chat(userId, message, { assistant?, threadId?, turnId?, runDreaming?, temporary? })` 返回 `ChatResult`:

1. `temporary=true` → 短路,零读写零副作用(对齐 Python 622-632)
2. save_chat(user + assistant)
3. opt-out 检查(`controls.isOptedOut`)
4. `extractor.extract(message, assistant)` → drafts
5. `security.sanitizeForMemory` 逐条 REDACT/QUARANTINE/REJECT
6. `_persistDrafts`(embed + store + 冲突消解)
7. `timeline.record` + `traitScorer.updateFromText`
8. `retrieve`(五通道 + 4 门控)
9. `buildTwin`(早建,供 RelevanceRouter)
10. RelevanceRouter(6 维,阶段 2 接入)+ ObservableGate(score 写回 hit)
11. SelectiveInjectionRouter(length cap / per-type)
12. `synthesizer.synthesize`(twin 更代)+ trait scores 注入 + save_twin
13. `promptBuilder.build` + source receipt 持久化(`used_in_prompt` 事件,带 position/retrievalScore)
14. 可选 LLM 调用(复用 promptBuilder 输出)
15. fallback natural_fallback_reply
16. dreaming:`markDirty` + 后台 scheduler tick(不阻塞)

每一步都用 try/catch fail-open(对齐 Python "defensive fail-open,不是空函数")。

---

## 5. 检索算法(核心质量)

对齐 `retrieval/pipeline.py`,五通道综合打分:

```
final = w_vec * vector_score + w_bm25 * bm25_score + w_exact * exact_score
      + w_rec * recency_score + w_imp * importance_score
```

- **vector_score**:余弦(query embedding, item embedding)
- **bm25_score**:词项频率/逆文档频率(TS 自研,ASCII 分词 + CJK bigram)
- **exact_score**:query 与 content 子串精确命中加权
- **recency_score**:exp(-Δt / half_life_days),half_life=60
- **importance_score**:item.importance × confidence

**4 道硬门控(命中即剔除,不参与打分):**
1. status ∉ {active, confirmed, hypothesis}(superseded/expired/deleted/archived/suppressed/connect_revoked 剔除)
2. suppressed(Don't-mention-again)—— 除非 includeSuppressed
3. expires_at 已过
4. do_not_inject metadata/tag

跨用户隔离:按 userId 过滤。

延迟目标(对齐 `docs/verification_tiers.md`):retrieve p95 ≤ 300ms。

---

## 6. 阶段路线图(7 个子项目,有序依赖)

每个阶段独立走 spec → plan → 实现 → 测试 agent + 审查 agent → 验证循环。本总体 spec 定义全部阶段的范围/依赖/接口/验收;阶段 0 之后各阶段会有自己的子 spec。

| 阶段 | 核心交付 | 关键模块 | 验收信号 |
| --- | --- | --- | --- |
| **0. 地基与契约** | dream/ 骨架、types.ts、config.ts、SQLite schema、DreamMemoryStore 适配壳(先透传 FileMemoryStore) | types, config, storage, dream-store.ts | qwicks 编译启动;现有 memory 功能零退化;新模块类型检查通过 |
| **1. 核心记忆引擎** | 抽取(LLM/启发式)+ embedding(双轨)+ 向量索引 + 混合检索 + 冲突 + 时序 + 图谱 + 数字孪生 + dreaming 调度 + chat 闭环 | extraction, security, embeddings, vectordb, retrieval, conflict, temporal, graph, user_state, synthesis, refresh, chat/pipeline | 完整 chat 闭环跑通;五通道检索 + 4 门控单测全过;临时对话零副作用验证;Tier B 评测通过 |
| **2. 智能检索与门控** | RelevanceRouter(6 维)+ ObservableGate + SelectiveInjectionRouter + "何时用记忆"判断 + natural_builder | retrieval 扩展, prompt_builder/natural-builder | retrieve p95≤300ms;无关记忆不污染(评测 fp 率达标);Remembering 状态可观测 |
| **3. 用户控制与可解释性** | Memory Summary 生成/编辑/定点纠正 + Source receipts UI + Don't-mention-again + opt-out + 临时对话开关 + 版本历史/按日期恢复 | memory_summary, controls, GUI settings-section-memory 扩展 | 用户能查看/编辑/删除/抑制;source lineage 完整可追溯;删除一致性(删源→派生停止) |
| **4. 搜索改写 + Pulse** | 记忆改写工具调用前 search query + Pulse 夜间异步研究 + 可视化摘要 | query_rewrite, pulse | 搜索结果贴合用户地点/偏好(评测);Pulse 产出可浏览摘要 |
| **5. 连接器(真实化)** | 真实 Gmail/Drive OAuth 授权 + 数据拉取 + source lineage 注入记忆 + 撤权 tombstone | connectors 真实化 | 授权后能从邮件/文件抽取带 lineage 的记忆;撤权后 CONNECTOR_REVOKED 生效 |
| **6. 评测与 Tier 门控** | 540 用例 harness + Tier A/B/C + 延迟/质量门控 + redteam + parity | evaluation | Tier A 540 在目标机器通过(retrieve p95≤300ms, embed_batch p95≤1500ms, fp_total/cases≤0.01) |

**阶段 6 贯穿所有阶段**:每阶段交付前都要跑对应 Tier gate,不达标不算完成。

---

## 7. 验收标准(对照文档 §12 启发清单)

### 7.1 数据模型(文档 12.1)
- [x] 区分 explicit memory(用户明确保存)/ inferred memory(从历史综合)/ source record(聊天/文件/Gmail/自定义指令)/ memory summary / suppression rule / deletion lineage
- [x] 每条 memory 带 source、时间、最近使用、主题、置信度、是否 top of mind、是否被纠正、是否被要求不要再提
- [x] 支持 supersede(计划→历史)
- [x] source lineage 可追到原始聊天/文件/Gmail

### 7.2 后台 Dreaming(文档 12.2)
- [x] 周期/触发式综合记忆状态,不只"记住"时写入
- [x] 合并重复、解决冲突、降级过期、提升近期高频
- [x] 自然上下文纳入记忆,可解释可撤销
- [x] 生成可读 Memory Summary + 保留细粒度内部 lineage
- [x] 处理"新信息推翻旧信息",非 append-only

### 7.3 检索与使用策略(文档 12.3)
- [x] 先判断当前请求是否被个性化上下文改善,非每次全量检索
- [x] 区分直接事实/长期偏好/当前计划/地点时区/近期项目/敏感内容
- [x] 回答可展示 remembering/personalizing 状态
- [x] 搜索/工具调用前允许记忆改写查询
- [x] 相关性门控防污染

### 7.4 用户控制(文档 12.4)
- [x] Memory Summary 页面:编辑/定点纠正/刷新/删除并关闭
- [x] Memory Sources:展示使用了哪些来源 + 标记相关/不相关
- [x] Don't-mention-again(抑制≠删除)
- [x] 真正删除路径:删 saved memory / 删源聊天 / 删文件 / 断应用 / 删派生记忆
- [x] Temporary Chat:不读不写
- [x] saved memories 搜索/排序/prioritize/历史版本/恢复

### 7.5 评估指标(文档 12.5)
- [x] 延续上下文 / 遵循偏好 / 时间更新 / 来源可解释 / 删除一致性 / 不过度个性化

---

## 8. 质量与工程要求

- **TDD**:每个模块先写测试(vitest),实现满足测试。对齐 Python 126 个测试文件的覆盖广度。
- **类型安全**:`npm run typecheck` 全程零错误。
- **fail-open**:对齐 Python——可选子系统的 try/catch fail-open 是有意设计,不是空函数。但**核心路径**(storage/embeddings/vectordb)的失败必须显式处理,不能静默吞。
- **零重原生依赖**:不引入 torch/faiss/neo4j 等需要编译或平台特定的包。better-sqlite3 已是 qwicks 现有依赖。
- **向后兼容**:绝不破坏现有 `MemoryStore` 接口、`/v1/memory*` 契约、GUI 类型。
- **迁移**:提供 `FileMemoryStore → DreamMemoryStore` 的数据迁移脚本(读老 JSON 写入 SQLite),保证现有记忆不丢。

---

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| TS 端 embedding 质量不如 Python BGE-M3 | HTTP 优先调用同一 embedding 服务(Ollama bge-m3)即可达到同等质量;哈希回退仅兜底 |
| 自研向量索引大规模性能 | IVF 分桶阶段提供;桌面单用户万级记忆,flat 暴力余弦 p95≤300ms 可达 |
| chat() 12 阶段在 TS 重建工程量大 | 分阶段实现,阶段 1 先跑通核心闭环(extract+persist+retrieve+prompt),RelevanceRouter/ObservableGate 等留到阶段 2 |
| 连接器 OAuth 在桌面 Electron 的安全 | 阶段 5 用系统浏览器授权 + loopback 回调,token 加密存本地;撤权即 tombstone |
| 评测 540 用例的 gold label | 从 Python `evaluation/` 移植用例与 gold,TS runner 重新实现打分逻辑 |

---

## 10. 执行流程(用户已确认的工作模式)

每个阶段:
1. 按 spec 写 plan(writing-plans)→ 实现
2. 实现 → 派出**测试 agent**(端到端 + 功能验证,找 bug)与**审查 agent**(对照本 spec 该阶段验收清单,查漏)
3. 任一 agent 打回 → 继续完善 → 再派两个 agent
4. **两个 agent 都判定"完美实现、零问题"** → 才向用户汇报该阶段完成
5. 进入下一阶段

七个阶段顺序完成全部七阶段后,再做**全系统端到端**(覆盖文档 §7 全部验收),通过即向用户汇报整套系统完成。时长无限,持续优化直至严格达标。
