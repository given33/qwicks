# Dream 记忆系统 — 产品化主链路打通设计

- **生成时间**:2026-06-25
- **目标**:把已实现 90% 但因「默认关 + 无开关 + 无迁移」而沉睡的 Dream 记忆系统真正跑起来,并补齐文档承诺但缺失的产品级能力:透明度(Memory Sources 面板)、Connectors 授权 UX、安全硬化、敏感分级、容量管理、数据控制、身份与同步、质量加固。
- **上游 spec**:`docs/superpowers/specs/2026-06-23-dream-memory-system-design.md`(总体架构,7 阶段路线图)
- **来源**:用户提供的 gap 分析(P0/P1/P2)+ 二轮审计 + 用户在设计对话中追加的 5 条深层差距(容量管理 / 敏感分级 / Improve-the-model / 改写隐私 / 多设备多账号)。
- **工作模式**:8 个批次(A–H),每批独立 spec→plan→实现→双 agent 验证循环(对齐 master spec §10)。

---

## 0. 范围与已锁定的策略决策

### 0.1 本次实现范围 = 全部 P0/P1/P2 + 5 条新增

| 批次 | 含原 P 级 + 新增 | 核心交付 | 依赖 |
| --- | --- | --- | --- |
| **A** 主链路打通 | P0-1 GUI 开关 + P0-2 幂等迁移 | dream 真正跑起来、不丢数据 | — |
| **B** 敏感信息分级 🆕 | 新增#2 | SensitivityClassifier + pending_sensitive 独立表 + 高敏感需确认 | —(前置地基) |
| **C** 透明度 + 脱敏 | P1-1 Sources 面板 + P1-4 share/export 脱敏 | MemorySourcesPanel + 双管道(sourceType 驱动) | A,B |
| **D** 容量管理 🆕 | 新增#1 | MemoryCapacityGuard(maxItems → 自动 demote,排除高敏感) | B |
| **E** Connectors + 安全 | P1-2 授权 UX + P1-3 OAuth 密钥 + 新增#4 改写 connector 过滤 | connector 页 + 生产拒绝默认 key + rewriter 加 connector/health 黑名单 | B |
| **F** 数据控制 🆕 | 新增#3 | Improve-the-model 开关(train opt-out + 记忆参与改进独立开关)默认全关 | — |
| **G** 身份与同步 🆕 | 新增#5 + 原 P2 userId | identity 解析(替换 'default')+ mesh private grant/scope | A |
| **H** P2 余项 | LLM 加固 / Pulse / CI 门禁 / eval / fail-open 面板 / embedding baseUrl | 质量加固 | 全部 |

> **批次 B 独立前置**:它被 C(share 过滤)、D(容量降级排除项)、E(改写过滤)三条依赖,必须先于它们落地。不能让三个下游各自重新发明敏感度判定。

### 0.2 默认值三阶段策略(P0-1)

| 阶段 | 默认 backend | 迁移触发 | 本次实现? |
| --- | --- | --- | --- |
| **现在(阶段1)** | `file` | GUI 切到 dream 时一次性、非破坏、幂等 | ✅ 本次 |
| 临近毕业(阶段2) | `file` | 首次进入设置页引导提示 | ❌ 后续 |
| 达标后(阶段3) | `dream` | 老用户首启自动迁移 | ❌ 后续 |

**本次锁定阶段 1**:默认仍 `file`,在设置页加「记忆引擎」开关(File/Dream),切到 dream 时触发一次性幂等迁移。后两阶段作为「达标后切换」记录,不在本次实现范围。

### 0.3 share/export 双管道(P1-4)

- **share(给别人)** = 全剥离来源归因(对齐 OpenAI FAQ 原文「Memory Sources are not included in chats you share」)。
- **export(给自己)** = 全保真(GDPR 数据可携带,是用户自己的数据)。
- 现有代码只做了 Export:`controls/api.ts` 的 `export({shareableOnly})` 默认 `shareableOnly=false`(全量);**Share 管道的过滤根本还没写**。
- 规则 **sourceType 驱动**(确定性 > 让系统猜 shareable)。新增 `source_record.shareable` 列,`MemoryItem.shareable` 当硬 override。

### 0.4 已核实的代码现状(决定「接线 vs 新建」)

| Gap | 核实结果 |
| --- | --- |
| P0-1 默认关 | `capabilities.ts:264` 默认 `file`;`qwicks-process.ts:525-528` 不设 `backend`;`runtime-factory.ts:799` **有 `if(backend==='dream')` 实例化分支,管线已就绪**,只差开关 |
| P0-2 无迁移 | `backfill.test.ts` 只回填 `source_ids` JSON→link 表,不读 FileMemoryStore JSON 写 SQLite |
| P1-1 无面板 | 后端 `buildLedger` + `/v1/dream/ledger` 路由都在;`dream-memory-status-indicator.tsx:45` 只显数字点不开 |
| P1-2 无 Connector UX | `oauth.ts`/`gmail.ts`/`drive.ts` 齐全;`listAccounts`/`save`/`load`/`delete`/`PermissionRevocation` 都在,但无高层 `revokeConnector({preview})` + 渲染层零页面 |
| P1-3 默认密钥 | `oauth.ts:148` 已有 `DREAM_OAUTH_PRODUCTION=true` 拦截 **save**,但非生产仍可明文存 |
| P1-4 脱敏 | `ledger.ts` 有 `hiddenWhenShared`,`MemoryItem.shareable` 默认 true,但 share 管道无端到端过滤 |
| 容量管理 | `TopOfMindBalancer` 只按 salience/staleness 调整,无 maxItems 阈值触发 demote |
| 敏感分级 | `sanitizer.ts` 全文无 financial/health/identity 字样;4 态决策(allow/redact/quarantine/reject),无分级 + 无「需确认才落库」 |
| Improve-the-model | `grep train/opt-out/dataControl` 零命中,完全空白 |
| 改写隐私 | `rewriter.ts:15-27` 已接 `sanitizeForMemory`,slot value 命中 `injection_/secret_/pii_` 即拒;但缺 connector 内容过滤 + health 类(sanitizer 不识别 health,过滤穿透) |
| userId | `agent-loop.ts:452,554,2704,2718,2751` 处处 `?? 'default'`,无 identity 解析 |
| embedding baseUrl | `config.ts:47` `baseUrl` 默认空 → 缺省全程走 HashEmbedder(伪语义) |
| eval CI | harness/tierVerdict/precision-recall-f1 完整,Tier A/B/C 阈值在;540 case 走 `loadExternalDataset` 外部加载,CI 缺「加载并断言 Tier A 通过」一步 |
| mesh scope | 已有 `MemoryScope(public/collaboration/private)` + `memoryQuery{allowed,maxTopK,scopes}` + `grantToken`,缺与 dream userId 的桥接 |

---

## 1. 批次 A — 主链路打通

### A1. 数据流(切到 dream 时发生什么)

```
用户在设置页把「记忆引擎」从 File 切到 Dream
  → 弹确认对话框(说明:会迁移现有 N 条记忆,耗时 <Xs,可随时切回)
  → updateQWicks({ memoryBackend: 'dream' })
  → 主进程 runtime 重启(detectMemoryBackendChange → 重启 qwicks server)
  → runtime-factory.buildMemoryStore(backend='dream')
  → 启动 DreamMemorySystem 前先调 migrateLegacyMemory()
      ├─ 读 FileMemoryStore 的 *.json 记录(legacyRootDir/memory/*.json)
      ├─ 对每条:draftToItem(MemoryItemDraft{type:FACT, scope 映射, content, tags, confidence})
      ├─ repository.upsert(item)  ← 按指纹去重,幂等
      └─ 记 migration_log 表(已迁移条数 + 时间戳,防重跑)
  → DreamMemorySystem 实例化,SQLite 已含全部老数据
  → 服务就绪
```

### A2. 关键设计点

- **幂等**:`MemoryItem.fingerprint()` 去重,迁移脚本可安全重复执行(防「中途失败重跑」产生重复)。
- **非破坏**:迁移只**读** FileMemoryStore JSON、**写** SQLite;老 JSON 文件原样保留,切回 file 不丢。
- **失败可观测**:迁移失败 → `failures[]` 记原因 + `dream_stage_failed` 事件 + 设置页红条提示「迁移失败,已切回 file」。

### A3. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`migrate-legacy-memory.ts`** (新) | `qwicks/src/dream/storage/migrate-legacy-memory.ts` | 纯函数 `migrateLegacyMemory({legacyRootDir, repository, logger?}): MigrationReport`。读 FileMemoryStore JSON → draftToItem → upsert。无副作用依赖(不碰网络/embedding) |
| `MemoryCapabilityConfig` | `qwicks/src/contracts/capabilities.ts:254` | 已有 `backend` 字段,**无需改 schema** |
| **GUI 设置开关** | `src/renderer/src/components/settings-section-memory.tsx` | 新增「记忆引擎」`SettingRow`(File/Dream 下拉或 segmented control)。切到 Dream 触发确认对话框 |
| `QWicksRuntimeSettingsV1` | `src/shared/app-settings.ts` | 新增 `memoryBackend: 'file' \| 'dream'`(默认 `'file'`) |
| `qwicks-process.ts` memory 构造 | `src/main/qwicks-process.ts:525` | memory 配置加 `backend: runtime.memoryBackend` |
| `runtime-factory.buildMemoryStore` | `qwicks/src/server/runtime-factory.ts:799` | dream 分支实例化前先调 `migrateLegacyMemory` |
| **migration_log 表** | `qwicks/src/dream/storage/sqlite-repository.ts` | 新增表 `(id, migrated_count, skipped_count, failed_count, error, ran_at)`,查最近一条决定是否再跑 |

### A4. 错误处理

迁移失败:catch 整个迁移,记录失败条数,抛出 → `buildMemoryStore` 捕获 → 回退到 `FileMemoryStore` + 返回 `migrationError`,GUI 红条提示。**绝不让用户进入「空 SQLite」状态。**

### A5. 测试(`migrate-legacy-memory.test.ts`)

1. 老 JSON 10 条 → 迁移后 SQLite 10 条,fingerprint 一致
2. 重复迁移 → 仍 10 条(幂等)
3. 部分损坏 JSON → 跳过坏条 + failed_count 正确
4. 空 legacy 目录 → `MigrationReport{migratedCount:0}`,不抛错
5. scope 映射(qwicks user/workspace/project → dream global/user/project)

---

## 2. 批次 B — 敏感信息分级(前置地基)

### B1. 关键洞察:D 和 E 需要不同粒度(单一标量不够)

- D 容量管理需要粗粒度(「这条能不能主动提及?」)→ 二值/三档即可(RESTRICTED 永不主动提)。
- E 改写过滤需要细粒度(「这个 slot 能不能进外部搜索 query?」)→ 必须按类别。文章 query-rewrite 招牌例子(「你住 SF → 搜 SF」)依赖 **location 可用、health 不可用**——标量分不清这两者。
- **结论**:两类信号,各管一边。`sensitivity`(粗档,已有死字段)喂 D;`sensitivityCategories[]`(细类,新增)喂 E。分类器命中时同时填两个。加新类别对 D/E 都透明。

### B2. v1 三类的选择理由

financial / health / identity 恰好是「E 必须 hard-block、D 必须永不主动提」的精确集合,复用价值最高、伤害最大。而且:
- identity/financial 的词表 sanitizer 已有一半(`sanitizer.ts:41-56` 检测 api_key/ssn/credit_card/email/phone/ip/jwt)。只需让它**打 category 标签**(api_key/credit_card→financial,ssn/email/phone/jwt→identity),不新增检测逻辑。
- health 是唯一要新写的词表(药物/病况/诊断关键词),工作量可控。
- location 留到建 E 时再加(它是 E 的 allow 用例,加了 allowlist 才有意义)。
- children 最后(对话域频率最低,正则易误判,收益/风险比最差)。

### B3. 数据模型(types.ts)

```ts
// 现有(死字段,本批激活)—— D 读粗档
export enum Sensitivity { NORMAL = 'normal', SENSITIVE = 'sensitive', RESTRICTED = 'restricted' }

// 新增—— E 读细类,各读各的字段
export class MemoryItem {
  public sensitivity: Sensitivity = Sensitivity.NORMAL
  public sensitivityCategories: string[] = []  // ⊆ {financial, health, identity}
}
```

### B4. 分类器(扩展 sanitizer,复用已有检测)

```
新文件:qwicks/src/dream/security/sensitivity-classifier.ts

classifySensitivity(text): { sensitivity, categories, matchedPatterns }
  ├─ 复用 detectSecrets(text)  ← 零新检测逻辑
  │    命中 pii_credit_card → categories.push('financial')
  │    命中 pii_ssn/email/phone/ip/jwt → categories.push('identity')
  │    命中 pii_api_key/password → RESTRICTED + categories.push('identity')
  ├─ 新增 HEALTH 词表(唯一新写):药物/病况/诊断关键词(中英) → categories.push('health')
  └─ 推导:categories 命中 identity 且是 api_key/ssn/jwt → RESTRICTED;非空 → SENSITIVE;否则 NORMAL
```

### B5. 待确认闭环(独立 pending_sensitive 表,失败模式最坏情况选)

**决策**:物理分表。pending 的定义是「确认前任何记忆机制都碰不到它」(不检索/不注入/不 decay/不强化/不 conflict/不 export/share/不算 summary 统计)。物理分表用「不在 memory 表里」一次性保证全部——retrieval 候选集从 `repository.list()` 来,物理上扫不到。漏写一个查询的最坏结果 = 一条陈旧 pending 行残留(外观问题);状态标志方案漏一处守卫 = 未确认的健康/财务事实被注入或导出 = **本功能要防的隐私泄露**。且现有 HYPOTHESIS 已在 RETRIEVABLE_STATUSES 里(types.ts:76),再加一个 PENDING_CONFIRMATION 会形成两个语义相反的「未确认」状态。

```sql
CREATE TABLE IF NOT EXISTS pending_sensitive_draft (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  draft_json  TEXT NOT NULL,        -- 含 type/content/scope/tags/sourceIds/provenance
  category    TEXT NOT NULL,        -- financial/health/identity
  fingerprint TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, fingerprint)      -- 双向去重兜底
);
CREATE INDEX ix_pending_user ON pending_sensitive_draft(user_id, created_at);
```

**6 个设计要点**:
1. **fingerprint 双向去重**:入队前查两处——① pending 表内同指纹(UNIQUE 兜底);② memory 表是否已有同指纹(已确认就别再 pending)。
2. **sticky dismiss tombstone**:驳回不只删行,否则下次同话题再抽出又入队。驳回留 tombstone:复用 `suppression_rule`(scope 加一档 `sensitive_fingerprint`,target=fingerprint)。入队前查 tombstone 命中即丢弃,永久生效。
3. **gate 位置(单点)**:`pipeline.ts` `persistDrafts` 里,sanitizer/分类器判为高敏感的 draft → `pendingStore.enqueue(draft)`,不调 `repository.upsert`。memory 表完全不动。改动局部易测。
4. **确认后跑 conflict**:`confirm(id)` → 构造 MemoryItem(sensitivity=SENSITIVE,identity/financial 命中 PII 可升 RESTRICTED)→ 接 sourceIds → `repository.upsert` → 跑一遍 conflict(确认的敏感事实可能 supersede 已有记忆)→ 删 pending 行。
5. **可见性(对齐 P1-4 拆分)**:主记忆列表不显示;Memory Summary 统计不计入;export 含(数据可携带);share 永不含;Memory Summary 新增「待你确认(N)」栏,点进去逐条 confirm/dismiss + 显示分类理由。
6. **老化清理**:dreaming job 扫 30 天未确认 → 自动删(不确认视为放弃,不像 dismiss 留 tombstone)。

### B6. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`sensitivity-classifier.ts`** (新) | `qwicks/src/dream/security/` | 纯函数,复用 detectSecrets + health 词表 |
| **`pending-sensitive-store.ts`** (新) | `qwicks/src/dream/storage/` | SQLite CRUD:enqueue/get/list/confirm/dismiss + 双向去重 + tombstone 查询 |
| **DDL** | `sqlite-repository.ts` | `pending_sensitive_draft` 表 + `suppression_rule` 的 `sensitive_fingerprint` scope |
| **gate** | `pipeline.ts` persistDrafts | 单点分流:高敏感 → pending,否则正常 upsert |
| **controls API** | `controls/api.ts` | `listPending / confirmPending / dismissPending` |
| **GUI** | settings-section-memory.tsx + summary | 「待确认 N」栏 + confirm/dismiss UI |

### B7. 测试

1. 分类器:api_key→RESTRICTED+identity、credit_card→financial、health 词表→health、干净文本→NORMAL
2. enqueue:memory 表已有同指纹不重复入队(双向去重)
3. dismiss tombstone:同话题再抽不入队(sticky)
4. 物理隔离:pending 项不出现在 `repository.list()` / retrieval 候选集 / decay / conflict / summary 统计
5. confirm 后:memory 表有项 + 跑 conflict(supersede 传播)
6. 老化:30 天后 pending 行被删
7. export 含 / share 不含

---

## 3. 批次 C — 透明度旗舰(Memory Sources 面板 + share/export 脱敏)

### C1. 数据流(两层:面板读取 + 序列化分流)

```
【面板读取层】回答生成完成
  → SSE 事件 memory_sources_ready(含 ledger 的 used/downranked/suppressed/skipped)
  → chat-store 写入 memoryStatusByTurnId[turnId].sources
  → MemorySourcesPanel 消费:点 indicator 展开,逐条显示
  → 用户操作(Don't mention / 这条不对 / 删来源)→ 调 controls API

【序列化分流层】用户点「分享」或「导出」
  → share(thread)  → applyShareFilter(payload, mode='private')  → 剥离全部 source 归因
  → export(userId) → applyExportFilter(payload, shareableOnly=false) → 全保真
  → 两条管道独立,纯函数,各自单测 + 属性测试锁边界
```

### C2. MemorySourcesPanel(前端,消费现有后端)

后端 `/v1/dream/ledger` + `buildLedger` 已就绪,只缺前端消费。

| 区块 | 数据源 | 操作 |
| --- | --- | --- |
| **Used**(默认展开) | `ledger.used[]` | 类型徽章 + 标题(sourceText 截断)+ why used(reason)+ 评分条(score) |
| ↳ 逐条操作 | — | **Don't mention**(→ suppression) / **这条不对**(→ mark correction) / **删来源**(→ revoke/delete source) |
| **Downranked**(折叠) | `ledger.downranked[]` | 只读,显示降权原因 |
| **Suppressed**(折叠) | `ledger.suppressed[]` | 只读,显示过滤原因 |
| **Skipped**(折叠) | `ledger.skipped[]` | 只读,lifecycle 跳过 |

- **空状态**:ledger 为空时不渲染面板(对齐文章「无记忆不显示」)。
- **挂载点**:`MessageTimeline` 的 assistant message 旁,复用现有 `DreamMemoryStatusIndicator`——点它的 `(N 个来源)` 数字展开/收起 panel,而非新加按钮。
- **共享聊天过滤**:panel 在 share 视图下**整体不渲染**(`isSharedView ? null : <Panel>`)。

### C3. share/export 双管道脱敏(纯函数)

```ts
// 新文件:qwicks/src/dream/controls/share-export-filter.ts

type ShareMode = 'private' | 'show-chat'  // 默认 private,show-chat 是单 opt-in

/** share(给别人):剥离全部 source 归因,默认连 chat 源也剥 */
export function applyShareFilter(payload: SharePayload, mode: ShareMode = 'private'): SharePayload

/** export(给自己):全保真,数据可携带 */
export function applyExportFilter(payload, shareableOnly = false): ExportPayload
```

**关键建模陷阱(避免)**:别把「来源不可分享」和「派生记忆不可分享」混为一谈。从 Gmail 推断的「用户去新加坡」记忆**内容可分享**,不可分享的是 Gmail 来源本身(subject/snippet/raw id)。过滤打在 **share 序列化时剔除 source 行**,不抹掉所有 connector 派生记忆的内容。

### C4. 数据模型改动(sourceType 驱动 + source_record.shareable 列)

```ts
// types.ts SourceRecord 加一列:让 SQL 过滤廉价,规则在数据里显式可见
export class SourceRecord {
  public shareable: boolean = true  // 按 sourceType 算:connector/file/gmail→false, chat/saved/custom→true
}                                    // ingest 时写定,不可变
```

`sqlite-repository.ts`:`source_record` 表加列 `shareable INTEGER`,已有行回填(`CASE WHEN sourceType IN ('gmail','drive','file') THEN 0 ELSE 1 END`)。

**share 过滤决策总表**:

| 条件 | share 出现? |
| --- | --- |
| sourceType ∈ {gmail,drive,file} | ❌ 永不 |
| sourceType ∈ {chat,saved,custom} + mode='private' | ❌ 默认 |
| sourceType ∈ {chat,saved,custom} + mode='show-chat' | ✅ |
| `item.shareable === false` | ❌ override,无论 sourceType |
| `item.sensitivityCategories ∩ {health,financial,identity} ≠ ∅`(接批次 B) | ❌ 永不 |

### C5. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`MemorySourcesPanel.tsx`** (新) | `src/renderer/src/components/` | 消费 `DreamTurnMemoryStatus.sources`,渲染 used/downranked/suppressed/skipped + 操作按钮 |
| `DreamMemoryStatusIndicator.tsx` | `src/renderer/src/components/` | 改造:`(N 个来源)` 可点击展开/收起 panel;share 视图下整体不渲染 |
| **`share-export-filter.ts`** (新) | `qwicks/src/dream/controls/` | 纯函数 applyShareFilter/applyExportFilter + 属性测试 |
| **share 入口** | `src/renderer/src/`(share/export 现有 handler) | 序列化前调 applyShareFilter;非 dream 后端透传不变 |
| `source_record.shareable` | types.ts + sqlite-repository.ts | 新列 + 迁移回填 + ingest 时写定 |
| controls API | controls/api.ts | 已有 export;新增 share 端点注入 filter |

### C6. 测试

**属性测试(比断言具体 case 更防回归)**:

```
对任意 thread,序列化后的 share payload 必须满足:
 - sourceType ∈ {gmail,drive,file} 的行 = 0 条
 - 不含 connector 来源的 raw source id / title / content snippet
 - mode='private' 时 source 归因总数 = 0
 - mode='show-chat' 时只出现 sourceType ∈ {chat,saved,custom} 的归因
 - item.shareable===false 的记忆,source 归因不出现
 - sensitivityCategories ∩ {health,financial,identity} ≠ ∅ 的,source 归因不出现(接B)
export 对称测试:export(shareableOnly:false) 必须含全量(含 connector),证明两条管道独立
```

**端到端断言**:
1. Gmail 邮件 subject "Board meeting Q3 confidential" → share 链接 grep 不到;export-self 完整存在
2. health 类记忆(「我在吃抗抑郁药」)→ share 永不含;export 含
3. share 视图下 MemorySourcesPanel 不渲染
4. ledger.used 非空时 panel 显示;空时不显示

---

## 4. 批次 D — 容量管理("memory full" 防护)

### D1. 问题与机制

文章承诺:记忆接近上限时自动把次要记忆降到 background(gray),保留 top-of-mind。现状 `TopOfMindBalancer` 只按 salience/staleness 调整,**无容量触发**。补 `MemoryCapacityGuard`:当活跃记忆数超过阈值时,自动 demote 最低价值的活跃记忆,直到回到安全水位。

```
【触发点】afterTurn 持久化后 + dreaming tick
  → MemoryCapacityGuard.check(userId)
    → 统计 active 状态记忆数(active+confirmed,不含 hypothesis/pending)
    → count > softLimit ?
       → 候选集 = active 记忆 EXCLUDING:
           • sensitivity = RESTRICTED    ← 永不自动降级(接批次B)
           • sensitivity = SENSITIVE     ← 降权参与但最后才降(乘惩罚系数)
           • createdAt 在保护期内(默认 24h,新记忆不立即降)
           • metadata.top_of_mind = true(用户/系统显式置顶)
       → 按 valueScore 排序,逐条 demote 直到 count == softLimit
       → 每条 demote 写 statusHistory(actor='capacity_guard', reason='auto_demote_capacity')
    → count > hardLimit ?(异常)
       → 触发 dream_stage_failed 事件 + 记录到 failures[]
```

### D2. valueScore 排序(决定谁先被降级)

```
valueScore = w_salience * salienceScore + w_recency * recencyScore
           + w_freq * frequencyScore + w_type * typeBoost

  salienceScore: item.importance × item.confidence(已有字段)
  recencyScore:  exp(-Δt / halfLifeDays),halfLife=60(复用 retrieval 衰减)
  frequencyScore: lastUsedAt 次数(metadata.accessCount,新增计数)
  typeBoost:     goal/project/skill 基础加权(长期价值),feedback/episode 降权

权重默认:salience 0.4 / recency 0.3 / freq 0.2 / type 0.1
  → 最低 valueScore 的先降级
```

**SENSITIVE 降权但不排除**:SENSITIVE 记忆的 valueScore 计算时乘 0.5 惩罚系数——同类价值下它先降,但不会无脑降到 background(避免高价值健康记忆被误降)。RESTRICTED 永不进候选集。

### D3. 降级语义(background 不是删除)

降级到 background 的记忆:
- **仍可检索**(用户显式问时能召回)——对齐文章「gray memory 可被问起」
- **不主动注入**(不进 top-of-mind 注入集)
- **不计入 softLimit**(降级后腾出名额)
- **可手动恢复**:Memory Summary 里 background 区有「重新激活」按钮

与现有 `metadata.background` 标记一致(`types.ts:816`),不新增状态。demote = 设 `metadata.background=true` + 写 statusHistory。

### D4. 配置与水位

```ts
capacity: {
  softLimit: 500,
  hardLimit: 1000,
  protectWindowHours: 24,
  sensitiveDemotePenalty: 0.5
}
```

**可配置但带合理默认**:单用户桌面万级记忆,500 softLimit 够用。GUI 不暴露这些数值(避免用户误调到 0 导致全降级),但 Memory Summary 显示「活跃 320/500」水位条。

### D5. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`memory-capacity-guard.ts`** (新) | `qwicks/src/dream/refresh/` | 纯函数 `guardCapacity(items, config): DemotionPlan` + 在 pipeline/DreamingScheduler 调用的执行器 |
| `accessCount` 字段 | types.ts MemoryItem + repository | 检索命中时 +1(retrieval pipeline 命中处更新) |
| `memory.background` 复用 | types.ts:816 | 已有标记,demote 设 true;retrieval 的注入决策排除 background |
| DreamingScheduler 接入 | refresh/scheduler.ts | tick 时调 guardCapacity(后台,不阻塞热路径) |
| GUI 水位条 | Memory Summary 区 | 「活跃 N/500」+ background 区可手动恢复 |

### D6. 测试

1. softLimit=10,活跃 12 条 → demote 2 条,valueScore 最低的先降
2. RESTRICTED 记忆**永不**进 demote 候选(接批次B)
3. SENSITIVE 记忆乘 0.5 惩罚,同价值下先于 NORMAL 降
4. 保护期内(createdAt < 24h)记忆不降
5. `top_of_mind=true` 记忆不降
6. demote 后 background 标记 + statusHistory 写入;计数回到 softLimit
7. background 记忆可被显式检索但不在主动注入集
8. hardLimit 触达 → dream_stage_failed 事件 + failures[] 记录
9. 幂等:连续两次 check(中间无新增)→ 第二次不重复 demote

---

## 5. 批次 E — Connectors 授权 UX + OAuth 安全 + 改写 connector 过滤

### E1. Connector 设置页(渲染层,消费现有后端)

后端 OAuth store / Gmail / Drive / ingest / `PermissionRevocation` 都齐了,渲染层零页面。补:

```
【设置页:连接的应用】
  → 列表:listAccounts() → 显示已连接账号(provider/account_email)
  → 「连接 Gmail」「连接 Drive」按钮
       → 触发系统浏览器 OAuth(loopback 回调,token 加密存本地)
       → 授权成功后触发首次 ingest(从邮件/文件抽取带 lineage 的记忆)
  → scope 说明(每个连接显示申请的只读 scope)
  → 撤销前预览:复用 revokeConnector({preview:true}) → 展示将影响哪些记忆(N 条会变 CONNECTOR_REVOKED)
       → 确认后 revokeConnector({preview:false}) → tombstone 传播
```

### E2. OAuth 密钥安全(P1-3)

现有 `DREAM_OAUTH_PRODUCTION=true` 拦截 save,但非生产仍可明文存。补:
- **生产模式(或 `DREAM_OAUTH_KEY` 未设且非 dev)拒绝启动 connector**:不只拦截 save,而是启动时若 `isUsingDefaultKey() && !isDev` → connector 能力标 unavailable + 设置页提示「请先设置安全密钥」。
- **接 Windows Credential Manager / macOS Keychain**(Electron `safeStorage` API):优先用系统密钥库存加密 key,把 `dream-default-key` 回退彻底移出生产路径。

### E3. 改写隐私过滤(新增#4,接批次 B)

`rewriter.ts:15-27` 已接 `sanitizeForMemory`,但缺:
- **connector 内容过滤**:私有 Gmail/Drive 内容不应进外部搜索 query。slot value 命中 connector 来源标记 → 拒。
- **health 类**(sanitizer 当前不识别 health,过滤穿透):接批次 B 的 `sensitivityCategories`,slot 关联的记忆 `sensitivityCategories` 含 health/financial/identity → 该 slot 永不进 query。
- **location 作 allow 用例**:建 E 时同步加入 location 类别到分类器(此时 E 的 allowlist 才有意义)——location slot **允许**进 query(文章招牌特性)。

**slot 黑名单决策**(纯函数):
```
isSlotShareable(memory): boolean
  → memory.sensitivityCategories ∩ {health, financial, identity} ≠ ∅ ? false : true
  → location ∉ {health,financial,identity} → true(允许,招牌特性)
  → memory 来源是 connector(gmail/drive)且内容含私有标记 → false
```

### E4. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`settings-section-connectors.tsx`** (新) | `src/renderer/src/components/` | Connect/列表/scope/revoke-preview UI |
| **`revokeConnector({preview})`** 高层 API (新) | `qwicks/src/dream/controls/` | 封装:preview 统计影响条数;执行时 tombstone 传播(CONNECTOR_REVOKED) |
| OAuth 启动安全门 | runtime-factory / oauth.ts | 生产 + 默认 key → connector unavailable |
| **Electron `safeStorage` 接入** | oauth.ts / main 进程 | 系统密钥库存 key,移除生产明文回退 |
| rewriter slot 黑名单 | query_rewrite/rewriter.ts | 接 sensitivityCategories + connector 来源过滤 + location allow |

### E5. 测试

1. 授权成功后首次 ingest 产出带 lineage 的记忆(provenance.source=gmail/drive)
2. revoke preview 返回正确影响条数;执行后受影响记忆变 CONNECTOR_REVOKED
3. 生产模式 + 默认 key → connector unavailable,设置页提示
4. safeStorage 加密的 key 能正确加解密 token
5. rewriter:health slot 永不进 query;location slot 进 query;connector 私有内容不进 query
6. 撤权后 tombstone 传播:派生记忆标 CONNECTOR_REVOKED,不注入

---

## 6. 批次 F — 数据控制(Improve the model)

### F1. 两个独立开关

文章要求用户能控制数据是否参与模型改进/训练。补两个**独立**开关(默认全关):

```ts
// QWicksRuntimeSettingsV1 或 DreamConfig 新增
dataControl: {
  /** 记忆数据是否参与模型改进(本地的 retrieval/extract 仍可用,只控制是否上报) */
  allowModelImprovement: false,   // 默认关
  /** 记忆数据是否参与模型训练(opt-out) */
  allowTraining: false            // 默认关
}
```

**关键**:这两个开关控制的是**数据上报/外发**,不影响本地记忆能力(retrieval/extract/dream 全部照常)。本应用是本地优先,默认全关,即默认**零外发**。

### F2. 数据流

```
任何「上报记忆数据用于改进」的路径(遥测/匿名化上报/同步到云端训练管道)
  → 检查 dataControl.allowModelImprovement && dataControl.allowTraining
  → 任意一个 false → 该路径短路,数据不出本地
  → GUI 设置页「数据控制」区:两个 toggle + 明确文案说明本地优先、默认不上报
```

### F3. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| `dataControl` 配置 | app-settings.ts / DreamConfig | 两开关,默认 false |
| 上报路径门控 | 任何外发/遥测入口 | 检查两开关,任一 false 短路 |
| **GUI 数据控制区** | settings-section-memory.tsx 或新 section | 两 toggle + 文案 |

### F4. 测试

1. 两开关默认 false,任何上报路径短路
2. allowModelImprovement=true 但 allowTraining=false → 改进路径通,训练路径仍短路
3. 两开关都 true → 路径通
4. 本地记忆能力(retrieval/extract/dream)不受开关影响

---

## 7. 批次 G — 身份与同步(多设备/多账号)

### G1. identity 解析(替换 'default')

`agent-loop.ts` 处处 `?? 'default'`,无 identity 解析。补 `MemoryIdentityResolver`:

```
resolveUserId(context): string
  ├─ context 含 workspace 用户身份 → 用之
  ├─ context 含设备配对身份(mesh)→ 用之
  └─ 兜底 'default'(单机单人,保持现状)
```

**接入点**:`agent-loop.ts:554` `memoryUserId` 改为 `resolveUserId(opts)`,所有 `?? 'default'` 走 resolver。

### G2. mesh private grant/scope 桥接

mesh 已有 `MemoryScope(public/collaboration/private)` + `memoryQuery{allowed,maxTopK,scopes}` + `grantToken`(contracts.ts:291-314),缺与 dream userId 的桥接:
- dream MemoryItem 映射到 mesh scope:`item.scope` ∈ {global,user,project} → mesh `public/collaboration/private` 的映射规则。
- private scope 的记忆:跨设备同步时只走 grant 授权的通道,无 grant 不外发。
- 多账号:不同 userId 的记忆物理隔离(SQLite 按 userId 分库或分前缀),mesh 同步按设备身份路由。

### G3. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **`memory-identity-resolver.ts`** (新) | `qwicks/src/dream/` 或 loop | resolveUserId,替换 'default' |
| agent-loop 接入 | agent-loop.ts:554 等 | memoryUserId 走 resolver |
| mesh scope 映射 | mesh 集成层 | dream scope ↔ mesh MemoryScope 映射 + private grant 门控 |
| 多账号隔离 | sqlite-repository.ts | **单库 + 所有表加 `user_id` 列 + 查询统一带 `WHERE user_id=?`**（默认方案）。repository 现有 DDL 已含 user_id 列,本批只审计确认每条查询都带 user_id 过滤,杜绝跨账号泄露。若未来单账号记忆超 50k 再评估分库 |

### G4. 测试

1. resolveUserId:有 workspace 身份用之;无 → 'default'(现状不退化)
2. mesh 同步:private scope 记忆无 grant 不外发
3. 多账号:不同 userId 记忆互不可见(隔离)
4. dream scope → mesh scope 映射正确

---

## 8. 批次 H — P2 质量加固

### H1. LLM extractor/synthesizer 加固(`model-chat-adapter.ts`)

缺 timeout / cost budget / JSON schema / abortSignal 与 turn 取消同步。补:
- **timeout**:extraction/synthesis 调用带超时(默认 30s),超时 fail-open 到 heuristic。
- **cost budget**:单 turn extraction 最多调 LLM N 次,超 budget fail-open。
- **JSON schema 校验**:LLM 返回的 JSON 用 zod 校验,非法 → fail-open。
- **abortSignal 同步**:用户取消 turn → abortSignal 触发 → extraction 中止,不继续后台跑。

### H2. Pulse 默认 no-op → 真实化

`pipeline.ts` Pulse 默认 research 返回 disabled 占位。runtime-factory 已注入 `pulseResearch`(用 modelClient 的 chat 做研究摘要)。补:
- **digest UI**:夜间异步研究产出的可浏览摘要(dashboard 区)。
- **调度**:定时 tick(对齐 dreaming scheduler,后台不阻塞)。

### H3. embedding baseUrl 配置

`config.ts:47` `baseUrl` 默认空 → 缺省全程走 HashEmbedder(伪语义)。具体处理:
- **默认方案**:`baseUrl` 留空时,EmbeddingRouter 从 qwicks model-client 继承已配置的 baseUrl(若 model-client 配了 embedding 端点)。
- **兜底**:若继承后仍为空 → 在 `config.example.json` 与 shipped 默认里显式配 `BAAI/bge-m3` 端点(与现有 `config.example.json:112` dream backend 示例并列),避免「语义检索」名不副实。
- **运行时可观测**:设置页/诊断面板显示当前 embedding 后端(http vs hash fallback),让用户知道是否真语义检索。

### H4. eval 进 CI 门禁

harness/tierVerdict 完整,540 case 走 `loadExternalDataset` 外部加载。补:
- **CI job**:加载 540 dataset → 跑 → 断言 Tier A 通过(f1≥0.85, recall≥0.85, staleRate≤0.01)。
- **门禁**:Tier A 不通过 → CI 红,阻止合并(对齐 master spec §6)。

### H5. fail-open 可观测面板

`failures[]` + `dream_stage_failed` 事件都有,但无运行时面板。补:
- **诊断面板**(设置页或开发者区):展示「近 N 次 Dream 失败」(stage + 原因 + 时间),对齐 runbook。

### H6. 两条已解决审计项确认(防回退)

- Node 版本:`.nvmrc` + `qwicks/.nvmrc` 已有 → 确认未回退。
- conflict location-supersede 测试:确认已提交(audit 当时未提交)。

### H7. 组件边界

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| model-chat-adapter 加固 | dream/chat/model-chat-adapter.ts | timeout/budget/schema/abort |
| Pulse digest UI | renderer | 可浏览摘要 |
| embedding baseUrl | config / shipped config | 确认配 bge-m3 |
| eval CI job | `.github/workflows` 或等价 | 加载 540 + Tier A 门禁 |
| fail-open 面板 | renderer / 设置页 | 近 N 次失败展示 |

---

## 9. 跨批次依赖图与实施顺序

```
A(主链路)─────┬──→ C(透明度/脱敏) ←── B(敏感分级)
              └──→ G(身份/同步)
B(敏感分级)──┬──→ D(容量管理)
              └──→ E(改写过滤)  ←─ E 内含 Connectors UX + OAuth 安全
F(数据控制)─── 独立,可任意时点
H(P2)──────── 依赖全部,最后
```

**推荐实施顺序**:A → B → C → D → E → F → G → H。每批独立 spec→plan→实现→双 agent 验证,任一 agent 打回则继续完善再派两个 agent,都判「完美实现、零问题」才汇报该批完成。

---

## 10. 验收标准(全局,对照 master spec §7)

本 spec 聚焦产品化补齐,master spec §7.1–7.5 的数据模型/后台 Dreaming/检索策略/用户控制/评估指标验收清单仍适用。本 spec 新增的验收点:

- [ ] **A**:dream 切换 + 迁移后,老记忆零丢失,可切回 file 不退化
- [ ] **B**:高敏感 draft 不直接落库,需确认;物理隔离(pending 不进任何记忆机制);sticky dismiss 永久生效
- [ ] **C**:MemorySourcesPanel 可点开逐条操作;share 链接零来源归因;export 全保真;属性测试通过
- [ ] **D**:超 softLimit 自动 demote;RESTRICTED 永不降;background 可检索不主动注入
- [ ] **E**:可连接/撤权 Gmail+Drive;生产拒绝默认 key;health slot 不进 query,location slot 进
- [ ] **F**:两数据控制开关默认关;关时零外发,本地能力不受影响
- [ ] **G**:userId 不再硬编码;private scope 无 grant 不外发;多账号隔离
- [ ] **H**:LLM 调用带 timeout/budget/abort;embedding 配 bge-m3;eval Tier A 进 CI;fail-open 面板可见

---

## 11. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 迁移脚本误删老 JSON | 非破坏:只读 JSON、写 SQLite,老文件原样保留 |
| pending 表无限堆积 | 30 天老化清理 + 双向去重 + sticky dismiss |
| 容量 demote 误降高价值记忆 | RESTRICTED 永不降 + SENSITIVE 惩罚 + 保护期 + top_of_mind 豁免 |
| OAuth token 明文泄露 | 生产拒绝默认 key + safeStorage 系统密钥库 |
| share 漏过 connector 来源 | sourceType 驱动(ingest 时不可变)+ 属性测试锁边界 + sensitivityCategories override |
| identity resolver 误判 → 记忆串号 | 兜底 'default'(单机现状不退化)+ 多账号物理隔离 |
| LLM extraction 拖慢热路径 | timeout/budget + abortSignal 同步取消 + fail-open heuristic |
