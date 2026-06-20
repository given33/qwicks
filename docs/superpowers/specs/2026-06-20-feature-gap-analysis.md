# QWicks vs QWicks - 功能差距分析报告

**日期：** 2026-06-20  
**对比对象：**
- 源项目：QWicks (C:\Users\given\Desktop\QWicks-master)
- 目标项目：QWicks (D:\qwicks-desktop-v2\qwicks)

---

## 1. 总体概览

| 指标 | QWicks 源 | QWicks | 差异 |
|------|--------|----------------|------|
| **总代码行数（含测试）** | 40,762 | 37,988 | -2,774 (-6.8%) |
| **非测试代码行数** | 38,505 | 35,757 | -2,748 (-7.1%) |
| **测试文件数** | 54 | 0 | -54 (-100%) |
| **缺失依赖数** | - | 4 | 关键问题 |

**结论：** 约 93% 的源代码已迁移，但有 4 个关键问题需要解决。

---

## 2. 完整度评分

| 类别 | 完整度 | 状态 |
|------|--------|------|
| contracts (合约) | 100% | ✅ 完整 |
| domain (领域) | 100% | ✅ 完整 |
| ports (接口) | 100% | ✅ 完整 |
| adapters/file (文件存储) | 100% | ✅ 完整 |
| adapters/in-memory (内存存储) | 100% | ✅ 完整 |
| adapters/workspace (工作区) | 100% | ✅ 完整 |
| adapters/computer-use | 100% | ✅ 完整 |
| adapters/tool (工具) | 100% | ✅ 完整（38 个工具文件） |
| adapters/hybrid (混合存储) | 95% | ⚠️ 代码完整但缺依赖 |
| **adapters/model (模型客户端)** | **3%** | **❌ 严重 stub** |
| services (服务) | 100% | ✅ 完整 |
| loop (Agent 循环) | 100% | ✅ 完整（核心 2820 行） |
| server (服务端) | 100% | ✅ 完整 |
| server/routes (路由) | 100% | ✅ 完整（18 个路由） |
| hooks (钩子) | 100% | ✅ 完整 |
| delegation (代理) | 100% | ✅ 完整 |
| memory, attachments, skills, review | 100% | ✅ 完整 |
| telemetry (遥测) | 100% | ✅ 完整 |
| quality, prompt | 100% | ✅ 完整 |
| **cli (命令行)** | **95%** | ⚠️ hooks 配置无效 |
| **tests (测试)** | **0%** | **❌ 全部缺失** |
| **package.json exports** | **43%** | ⚠️ 只暴露 6/14 子包 |
| **index.ts 公共导出** | **43%** | ⚠️ 只导出 6/14 模块 |

---

## 3. 关键缺失功能（按优先级）

### 🔴 P0 - 阻止运行的核心问题

#### 1. CompatModelClient 是 Stub
- **位置：** `D:\qwicks-desktop-v2\qwicks\src\adapters\model\compat-model-client.ts`
- **现状：** 63 行 stub
- **QWicks 原始：** 2,602 行完整实现
- **影响：** **所有模型调用都会失败**，返回 `{kind: 'error', message: 'CompatModelClient is a stub...'}`
- **需要：**
  - 完整移植 OpenAI Chat Completions / OpenAI Responses / Anthropic Messages 协议
  - DeepSeek 推理翻译（`reasoning_content`）
  - MiniMax 成本计算
  - 工具调用修复
  - 图片输入处理
  - 流式空闲超时
  - 代理/端点格式支持

#### 2. better-sqlite3 未声明为依赖
- **位置：** `D:\qwicks-desktop-v2\qwicks\package.json` `dependencies` 缺少 `better-sqlite3`
- **影响：** HybridThreadStore 会失败，运行时静默回退到 JSONL，丢失索引和快速查询
- **需要：** 添加 `better-sqlite3: ^12.10.0` 到 dependencies

#### 3. @computer-use/nut-js 和 jimp 未声明
- **影响：** image-gen-tool-provider 和 computer-use-tool-provider 会失败
- **需要：**
  - `better-sqlite3: ^12.10.0`
  - `@computer-use/nut-js: ^4.2.0`
  - `jimp: ^1.6.0`
  - `proxy-agent: ^8.0.2`

#### 4. proxy-agent 未声明
- **影响：** HTTP 代理支持失效
- **需要：** 添加 `proxy-agent: ^8.0.2`

---

### 🟡 P1 - 重要但非阻塞

#### 5. 整个测试套件缺失
- **QWicks：** 54 个测试文件，5,500+ 行
- **QWicks：** 0 个测试文件
- **关键测试：**
  - `agent-loop.test.ts`
  - `hybrid-store.test.ts`
  - `model-client.test.ts`
  - `mcp-tool-provider.test.ts`
  - `hooks-lifecycle.test.ts`
  - `http-server.test.ts`
  - `loop.test.ts`
  - `runtime-factory.test.ts`
  - 等等

#### 6. hooks 配置 schema 是 stub
- **位置：** `D:\qwicks-desktop-v2\qwicks\src\config\qwicks-config.ts` line 25
- **现状：** `const HooksConfigSchema = z.object({}).optional()`
- **QWicks 原始：** 完整的 `HooksConfigSchema` from `hooks/hook-config.js`（已存在 141 行）
- **影响：** `config.json#hooks` 被解析为 unknown，运行时类型检查丢失

#### 7. package.json exports 减少
- **当前导出：** contracts, domain, ports, config, cache, adapters
- **应添加：** loop, server, services, hooks, telemetry, memory, skills, attachments, cli, delegation

#### 8. index.ts 公共导出减少
- **当前导出：** 6 个模块
- **应添加：** 14 个模块的完整导出

---

### 🟢 P2 - 改进项

#### 9. 命名差异（已大部分修复，但有小遗漏）
- `agent-loop.ts` 仍有 "QWicks turn failed" 日志字符串
- "You are QWicks" 系统提示词
- `QWicksAgent/QWicks#370` issue 链接

#### 10. 默认值差异
- **端口：** QWicks=8899, QWicks=8898
- **模型：** QWicks=deepseek-v4-pro, QWicks=mimo-v2.5-pro
- **影响：** CLI flag 和 schema 默认值不一致

#### 11. 文件结尾换行
- 大多数迁移文件缺少结尾换行符

#### 12. 某些导出类型丢失
- `DeepseekCurrencyCosts` (deepseek-pricing.ts)
- `MiniMaxCurrencyCosts` (minimax-pricing.ts)

---

## 4. 已完整迁移的模块（无需处理）

| 模块 | 状态 | 备注 |
|------|------|------|
| **contracts/** | ✅ 100% | 15 个文件，包含所有 Zod schemas |
| **domain/** | ✅ 100% | 10 个实体辅助文件 |
| **ports/** | ✅ 100% | 12 个接口定义 |
| **cache/** | ✅ 100% | LRU、TTL、不可变前缀等 |
| **shared/** | ✅ 100% | gui-plan, todos |
| **adapters/file/** | ✅ 100% | atomic-write, file-thread-store, file-session-store |
| **adapters/in-memory/** | ✅ 100% | 5 个内存适配器 |
| **adapters/workspace/** | ✅ 100% | local-workspace-inspector |
| **adapters/computer-use/** | ✅ 100% | host-control |
| **adapters/tool/** | ✅ 100% | 38 个工具 + 10,741 LOC |
| **services/** | ✅ 100% | thread, turn, usage, review, event-recorder, llm-debug |
| **loop/** | ✅ 100% | agent-loop 2,820 行 + 19 个支持文件 |
| **server/** | ✅ 100% | http-server, router, sse, auth, runtime-factory |
| **server/routes/** | ✅ 100% | 18 个路由处理器 |
| **hooks/** | ✅ 100% | hook-config, hook-engine, builtins/design-quality |
| **delegation/** | ✅ 100% | 4 个文件 |
| **memory, attachments, skills, review** | ✅ 100% | 全部完整 |
| **telemetry/** | ✅ 100% | usage-counter, cache-telemetry |
| **quality, prompt** | ✅ 100% | 全部完整 |
| **config/secret-redaction** | ✅ 100% | 密钥脱敏功能 |

---

## 5. 优先级行动计划

### 立即处理（使运行时可用）
1. **移植 compat-model-client.ts**（2,539 行）
2. **添加 4 个缺失依赖**：better-sqlite3, @computer-use/nut-js, jimp, proxy-agent
3. **恢复 HooksConfigSchema** 导入

### 短期处理（提升质量）
4. **迁移 tests/** 目录（54 个测试文件）
5. **扩展 package.json exports**（添加 8 个子包）
6. **扩展 src/index.ts**（添加 8 个模块导出）

### 中期处理（完善功能）
7. **恢复 DeepseekCurrencyCosts 和 MiniMaxCurrencyCosts 类型**
8. **统一默认端口和模型**
9. **清理剩余命名引用**

---

## 6. 关键统计

| 项目 | QWicks | QWicks | 状态 |
|------|-----|----------------|------|
| TypeScript 源文件 | 196 | 199 | ✅ +3 (新 index.ts) |
| 测试文件 | 54 | 0 | ❌ 缺失 |
| dist JS 文件 | - | 218 | ✅ 编译成功 |
| 编译错误 | - | 0 | ✅ |
| 严重 stub 数 | 0 | 1 | ⚠️ compat-model-client |
| 缺失依赖 | 0 | 4 | ❌ better-sqlite3 等 |
| 完整度 | 100% | ~93% | ⚠️ 主要缺模型客户端和测试 |

---

## 7. 结论

**QWicks 已经迁移了 QWicks 93% 的功能**，核心架构（AgentLoop、Services、Server、Hooks、Tools、Adapters）全部完整。

**主要问题集中在**：
1. 模型 HTTP 客户端（compat-model-client）是 stub，导致**运行时无法与模型对话**
2. 4 个原生模块依赖未声明
3. 整个测试套件未迁移
4. 公共 API 表面（package.json exports 和 index.ts）减少

**修复路径清晰**：按照上述 P0/P1/P2 优先级，2-3 天可以补齐所有缺失。