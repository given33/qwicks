# Teamflow Agent Runtime - Kun 功能迁移设计文档

**日期：** 2026-06-20  
**方案：** 渐进式迁移（方案 A）  
**目标：** 将 Kun 项目的完整后端运行时功能迁移到 Teamflow，适配 Teamflow 架构，替换所有 Kun 相关命名

---

## 一、迁移范围

### 1.1 缺失模块清单

Teamflow 当前仅有 `kun/src/contracts` 目录，缺少以下核心模块：

| 模块 | 功能描述 | 优先级 |
|------|---------|--------|
| `domain` | Thread、Turn、Item、Event、Approval、Usage 实体定义 | P0 |
| `ports` | ModelClient、ToolHost、stores、EventBus、ApprovalGate 接口 | P0 |
| `adapters` | 模型客户端、工具宿主、存储实现、工作区检查器 | P0 |
| `services` | 线程与回合编排服务 | P0 |
| `loop` | Cache-first agent loop 与 inflight 辅助逻辑 | P0 |
| `cache` | LRU/TTL 缓存与不可变前缀工具 | P0 |
| `server` | HTTP 路由、鉴权、SSE 与响应辅助 | P0 |
| `cli` | 命令行入口（serve, run, chat, exec） | P1 |
| `skills` | Skill 运行时支持 | P1 |
| `memory` | 内存存储与管理 | P1 |
| `hooks` | Hook 引擎与配置 | P1 |
| `delegation` | 子代理委托与执行 | P1 |
| `review` | 代码审查功能 | P1 |
| `quality` | 质量检测与规则 | P2 |
| `prompt` | 系统提示词管理 | P2 |
| `attachments` | 附件存储与管理 | P1 |
| `telemetry` | 用量、缓存与成本指标 | P1 |
| `config` | 运行时配置管理 | P0 |

### 1.2 迁移批次规划

**第一批（P0 - 核心契约层）：**
- contracts（已存在，需补充缺失文件）
- domain
- ports
- config
- cache

**第二批（P0 - 工具与适配器）：**
- adapters/model（模型客户端）
- adapters/tool（工具实现）
- adapters/file（文件存储）
- adapters/hybrid（混合存储）
- adapters/workspace（工作区检查）

**第三批（P0 - 服务层）：**
- services
- loop
- telemetry

**第四批（P1 - 高级功能）：**
- skills
- memory
- hooks
- delegation
- review
- attachments

**第五批（P1-P2 - CLI 与服务端）：**
- server
- cli
- quality
- prompt

---

## 二、命名替换规则

### 2.1 核心命名映射

| 原名称（Kun） | 新名称（Teamflow） |
|--------------|-------------------|
| `kun` | `teamflow-agent` |
| `Kun` | `Teamflow Agent` |
| `KUN` | `TEAMFLOW_AGENT` |
| `~/.deepseekgui/kun` | `~/.teamflowgui/teamflow-agent` |
| `deepseekgui` | `teamflowgui` |

### 2.2 环境变量映射

| 原变量 | 新变量 |
|--------|--------|
| `KUN_CONFIG` | `TEAMFLOW_AGENT_CONFIG` |
| `KUN_HOST` | `TEAMFLOW_AGENT_HOST` |
| `KUN_PORT` | `TEAMFLOW_AGENT_PORT` |
| `KUN_DATA_DIR` | `TEAMFLOW_AGENT_DATA_DIR` |
| `KUN_RUNTIME_TOKEN` | `TEAMFLOW_AGENT_RUNTIME_TOKEN` |
| `KUN_BASE_URL` | `TEAMFLOW_AGENT_BASE_URL` |
| `KUN_MODEL` | `TEAMFLOW_AGENT_MODEL` |
| `DEEPSEEK_API_KEY` | 保留（模型 API Key） |
| `DEEPSEEK_BASE_URL` | 保留（模型 Base URL） |

### 2.3 端口与路径配置

| 配置项 | 原值 | 新值 |
|--------|------|------|
| 默认端口 | 8899 | 8898 |
| 数据目录 | `~/.deepseekgui/kun` | `~/.teamflowgui/teamflow-agent` |
| 配置文件 | `config.json` | `config.json`（保持） |
| 日志文件 | `*.jsonl` | `*.jsonl`（保持） |

### 2.4 代码中的替换模式

```typescript
// 文件名替换
kun-*.ts → teamflow-agent-*.ts
kun*.ts → teamflow-agent*.ts

// 代码内容替换
'kun' → 'teamflow-agent'
'Kun' → 'Teamflow Agent'
'KUN_' → 'TEAMFLOW_AGENT_'
'deepseekgui' → 'teamflowgui'

// 注释和文档替换
'Kun 是' → 'Teamflow Agent 是'
'北冥有鱼' → 移除或替换为 Teamflow 相关描述
```

---

## 三、架构适配策略

### 3.1 目录结构

**迁移后的 Teamflow 目录结构：**

```
D:\teamflow-desktop-v2\
├── kun\                          # 重命名为 teamflow-agent
│   ├── src\
│   │   ├── contracts\            # 已存在，补充缺失文件
│   │   ├── domain\               # 新增
│   │   ├── ports\                # 新增
│   │   ├── adapters\             # 新增
│   │   ├── services\             # 新增
│   │   ├── loop\                 # 新增
│   │   ├── cache\                # 新增
│   │   ├── server\               # 新增
│   │   ├── cli\                  # 新增
│   │   ├── skills\               # 新增
│   │   ├── memory\               # 新增
│   │   ├── hooks\                # 新增
│   │   ├── delegation\           # 新增
│   │   ├── review\               # 新增
│   │   ├── quality\              # 新增
│   │   ├── prompt\               # 新增
│   │   ├── attachments\          # 新增
│   │   ├── telemetry\            # 新增
│   │   ├── config\               # 新增
│   │   └── index.ts              # 更新导出
│   ├── package.json              # 更新名称和配置
│   └── tsconfig.json             # 保持或调整
├── web\
│   ├── src\
│   │   ├── agent\                # 更新引用
│   │   └── ...                   # 其他前端代码
│   └── shared\                   # 更新 kun-endpoints 等
└── src-tauri\                    # Tauri 后端保持不变
```

### 3.2 模型预设策略

采用**混合支持**策略：

1. **保留 Teamflow 现有模型配置：**
   - MiMo (Xiaomi)
   - GPT (OpenAI 兼容)

2. **添加 Kun 模型预设：**
   - DeepSeek (deepseek-v4-pro, deepseek-v4-flash)
   - MiniMax (多模态、媒体生成)

3. **统一模型 Provider 接口：**
   - 支持多 Provider 配置
   - 支持自动路由
   - 支持成本计算

### 3.3 与 Tauri 后端的集成

**Teamflow Tauri 后端职责：**
- 任务调度与管理
- SQLite 数据库管理
- Codex/Claude Code 进程管理
- 实时事件广播

**Teamflow Agent Runtime 职责：**
- Agent 循环执行
- 模型调用
- 工具执行
- 会话管理
- 审批流程

**集成方式：**
- Tauri 后端通过 HTTP/SSE 调用 Agent Runtime
- Agent Runtime 作为独立进程运行（端口 8898）
- 前端通过 `runtime-client.ts` 统一调用

---

## 四、第一批迁移详细设计

### 4.1 Contracts 层补充

**当前状态：** `kun/src/contracts` 已存在但内容不完整

**需要补充的文件：**
- `threads.ts` - 线程合约
- `turns.ts` - 回合合约
- `items.ts` - 消息项合约
- `review.ts` - 审查合约
- `events.ts` - 事件合约
- `approvals.ts` - 审批合约
- `attachments.ts` - 附件合约
- `usage.ts` - 用量合约
- `policy.ts` - 策略合约
- `workspace.ts` - 工作区合约
- `errors.ts` - 错误合约
- `capabilities.ts` - 能力合约
- `runtime-info.ts` - 运行时信息
- `memory.ts` - 内存合约
- `model-endpoint-format.ts` - 模型端点格式

### 4.2 Domain 层迁移

**需要迁移的文件：**
- `thread.ts` - 线程实体
- `turn.ts` - 回合实体
- `item.ts` - 消息项实体
- `event.ts` - 事件实体
- `approval.ts` - 审批实体
- `usage.ts` - 用量实体
- `session.ts` - 会话实体
- `model-history-repair.ts` - 模型历史修复
- `runtime-event-reducer.ts` - 运行时事件归约

**适配要点：**
- 将 `kun` 命名替换为 `teamflow-agent`
- 保持 Zod schema 定义
- 保持类型导出

### 4.3 Ports 层迁移

**需要迁移的接口：**
- `ModelClient` - 模型客户端接口
- `ToolHost` - 工具宿主接口
- `ThreadStore` - 线程存储接口
- `SessionStore` - 会话存储接口
- `EventBus` - 事件总线接口
- `ApprovalGate` - 审批门接口
- `UserInputGate` - 用户输入门接口

**适配要点：**
- 接口定义保持不变
- 实现类在 adapters 层提供

### 4.4 Config 层迁移

**需要迁移的文件：**
- `kun-config.ts` - 运行时配置
- `secret-redaction.ts` - 密钥脱敏

**配置结构：**

```typescript
interface TeamflowAgentConfig {
  serve: {
    host: string           // 默认 '127.0.0.1'
    port: number           // 默认 8898
    dataDir: string        // 默认 '~/.teamflowgui/teamflow-agent'
    runtimeToken: string
    apiKey: string
    baseUrl: string
    model: string
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode
    storage: {
      backend: 'memory' | 'file' | 'hybrid'
    }
    insecure: boolean
  }
  contextCompaction: {
    defaultSoftThreshold: number
    defaultHardThreshold: number
    summaryMode: 'heuristic' | 'model'
    summaryTimeoutMs: number
    summaryMaxTokens: number
    summaryInputMaxBytes: number
  }
  // ... 其他配置
}
```

### 4.5 Cache 层迁移

**需要迁移的文件：**
- `lru-cache.ts` - LRU 缓存实现
- `ttl-lru-cache.ts` - TTL LRU 缓存实现
- `immutable-prefix.ts` - 不可变前缀
- `prefix-volatility.ts` - 前缀易变性
- `tool-catalog-fingerprint.ts` - 工具目录指纹

**适配要点：**
- 保持缓存算法实现
- 更新配置参数命名

---

## 五、测试策略

### 5.1 单元测试

- 每个迁移的模块需附带测试文件
- 使用 Vitest 框架（与 Kun 一致）
- 测试覆盖率目标：80%+

### 5.2 集成测试

- 测试 contracts → domain → ports → adapters 的集成
- 测试 HTTP API 端点
- 测试 SSE 事件流

### 5.3 端到端测试

- 测试前端 → runtime → model 的完整流程
- 测试工具执行流程
- 测试审批流程

---

## 六、风险与缓解

### 6.1 风险清单

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 命名替换遗漏 | 运行时错误 | 使用自动化脚本 + 代码审查 |
| 类型不兼容 | 编译错误 | 逐步迁移，保持类型一致 |
| 配置冲突 | 功能异常 | 统一配置管理，明确优先级 |
| 依赖缺失 | 运行时错误 | 完整迁移 package.json 依赖 |
| 测试不足 | 质量风险 | 每批次迁移后运行完整测试 |

### 6.2 回滚策略

- 每批次迁移前创建 Git 分支
- 保留原 Kun 代码作为参考
- 出现问题时可快速回滚到上一批次

---

## 七、验收标准

### 7.1 第一批验收标准

- [ ] contracts 层所有文件迁移完成
- [ ] domain 层所有文件迁移完成
- [ ] ports 层所有文件迁移完成
- [ ] config 层所有文件迁移完成
- [ ] cache 层所有文件迁移完成
- [ ] 所有文件中无 `kun`、`Kun`、`KUN`、`deepseekgui` 字样（除模型相关）
- [ ] TypeScript 编译通过
- [ ] 单元测试通过
- [ ] 导出接口与前端兼容

### 7.2 最终验收标准

- [ ] 所有 18 个模块迁移完成
- [ ] 运行时可通过 `teamflow-agent serve` 启动
- [ ] 前端可连接运行时（端口 8898）
- [ ] 基本对话功能正常
- [ ] 工具执行功能正常
- [ ] 审批流程正常
- [ ] 模型调用正常（DeepSeek、MiMo、MiniMax、GPT）

---

## 八、后续计划

完成第一批迁移后，将依次进行：
1. 第二批：工具与适配器
2. 第三批：服务层
3. 第四批：高级功能
4. 第五批：CLI 与服务端

每批次完成后进行验收，确保功能正常后再进行下一批次。
