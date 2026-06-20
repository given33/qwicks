# Teamflow Agent Runtime 第一批迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 迁移 Kun 项目第一批核心模块（contracts、domain、ports、config、cache）到 Teamflow，完成命名替换和架构适配

**Architecture:** 
- 将 Kun 源代码复制到 Teamflow 的 kun 目录（后续重命名为 teamflow-agent）
- 使用自动化替换脚本处理命名变更
- 保持 Zod schema 和 TypeScript 类型定义的完整性
- 确保与现有前端代码的兼容性

**Tech Stack:** TypeScript 5.8+, Zod 4.4+, Vitest 4.1+, Node.js 20+

---

## 文件结构映射

### Contracts 层文件清单

**源路径：** `C:\Users\given\Desktop\Kun-master\kun\src\contracts\`  
**目标路径：** `D:\teamflow-desktop-v2\kun\src\contracts\`

需要迁移的文件：
```
contracts/
  threads.ts        → threads.ts
  turns.ts          → turns.ts
  items.ts          → items.ts
  review.ts         → review.ts
  events.ts         → events.ts
  approvals.ts      → approvals.ts
  attachments.ts    → attachments.ts
  usage.ts          → usage.ts
  policy.ts         → policy.ts
  workspace.ts      → workspace.ts
  errors.ts         → errors.ts
  capabilities.ts   → capabilities.ts
  runtime-info.ts   → runtime-info.ts
  memory.ts         → memory.ts
  model-endpoint-format.ts → model-endpoint-format.ts
  index.ts          → index.ts（更新）
```

### Domain 层文件清单

**源路径：** `C:\Users\given\Desktop\Kun-master\kun\src\domain\`  
**目标路径：** `D:\teamflow-desktop-v2\kun\src\domain\`（新建目录）

需要迁移的文件：
```
domain/
  thread.ts         → thread.ts
  turn.ts           → turn.ts
  item.ts           → item.ts
  event.ts          → event.ts
  approval.ts       → approval.ts
  usage.ts          → usage.ts
  session.ts        → session.ts
  model-history-repair.ts → model-history-repair.ts
  runtime-event-reducer.ts → runtime-event-reducer.ts
  index.ts          → index.ts
```

### Ports 层文件清单

**源路径：** `C:\Users\given\Desktop\Kun-master\kun\src\ports\`  
**目标路径：** `D:\teamflow-desktop-v2\kun\src\ports\`（新建目录）

需要迁移的文件：
```
ports/
  model-client.ts   → model-client.ts
  tool-host.ts      → tool-host.ts
  web-provider.ts   → web-provider.ts
  thread-store.ts   → thread-store.ts
  session-store.ts  → session-store.ts
  event-bus.ts      → event-bus.ts
  approval-gate.ts  → approval-gate.ts
  user-input-gate.ts → user-input-gate.ts
  workspace-inspector.ts → workspace-inspector.ts
  clock.ts          → clock.ts
  id-generator.ts   → id-generator.ts
  index.ts          → index.ts
```

### Config 层文件清单

**源路径：** `C:\Users\given\Desktop\Kun-master\kun\src\config\`  
**目标路径：** `D:\teamflow-desktop-v2\kun\src\config\`（新建目录）

需要迁移的文件：
```
config/
  kun-config.ts     → teamflow-agent-config.ts（重命名）
  kun-config.test.ts → teamflow-agent-config.test.ts（重命名）
  secret-redaction.ts → secret-redaction.ts
  index.ts          → index.ts
```

### Cache 层文件清单

**源路径：** `C:\Users\given\Desktop\Kun-master\kun\src\cache\`  
**目标路径：** `D:\teamflow-desktop-v2\kun\src\cache\`（新建目录）

需要迁移的文件：
```
cache/
  lru-cache.ts      → lru-cache.ts
  ttl-lru-cache.ts  → ttl-lru-cache.ts
  immutable-prefix.ts → immutable-prefix.ts
  prefix-volatility.ts → prefix-volatility.ts
  tool-catalog-fingerprint.ts → tool-catalog-fingerprint.ts
  index.ts          → index.ts
```

---

## 命名替换规则

在所有迁移的文件中，应用以下替换规则：

### 字符串替换映射表

| 原字符串 | 替换为 | 说明 |
|---------|--------|------|
| `kun`（小写，在路径/变量中） | `teamflow-agent` | 运行时名称 |
| `Kun`（大写开头，在类名/标题） | `Teamflow Agent` | 显示名称 |
| `KUN`（全大写，常量） | `TEAMFLOW_AGENT` | 环境变量/常量 |
| `deepseekgui` | `teamflowgui` | 数据目录名 |
| `deepseek-gui` | `teamflow-gui` | GUI 名称 |
| `~/.deepseekgui/kun` | `~/.teamflowgui/teamflow-agent` | 数据路径 |
| `8899`（端口） | `8898` | 默认端口 |
| `deepseek-v4-pro` | 保持不变 | 模型名称保留 |
| `deepseek-v4-flash` | 保持不变 | 模型名称保留 |
| `北冥有鱼` | 删除注释 | 移除 Kun 特有描述 |

### 文件名替换规则

| 原文件名 | 新文件名 |
|---------|---------|
| `kun-config.ts` | `teamflow-agent-config.ts` |
| `kun-config.test.ts` | `teamflow-agent-config.test.ts` |
| `kun-system-prompt.ts` | `teamflow-agent-system-prompt.ts` |
| `kun-*.ts` | `teamflow-agent-*.ts` |

---

## 详细任务分解

---

### Task 1: 准备目录结构

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\`
- Create: `D:\teamflow-desktop-v2\kun\src\ports\`
- Create: `D:\teamflow-desktop-v2\kun\src\config\`
- Create: `D:\teamflow-desktop-v2\kun\src\cache\`

- [ ] **Step 1: 创建 domain 目录**

```bash
mkdir -p "D:\teamflow-desktop-v2\kun\src\domain"
```

Expected: 目录创建成功

- [ ] **Step 2: 创建 ports 目录**

```bash
mkdir -p "D:\teamflow-desktop-v2\kun\src\ports"
```

Expected: 目录创建成功

- [ ] **Step 3: 创建 config 目录**

```bash
mkdir -p "D:\teamflow-desktop-v2\kun\src\config"
```

Expected: 目录创建成功

- [ ] **Step 4: 创建 cache 目录**

```bash
mkdir -p "D:\teamflow-desktop-v2\kun\src\cache"
```

Expected: 目录创建成功

- [ ] **Step 5: 验证目录结构**

```bash
ls "D:\teamflow-desktop-v2\kun\src"
```

Expected: 显示 contracts, domain, ports, config, cache 目录

---

### Task 2: 迁移 policy.ts（Contracts 层基础）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\policy.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\policy.ts`

- [ ] **Step 1: 读取源文件内容**

Run: Read the source file and prepare for adaptation

- [ ] **Step 2: 创建 policy.ts 文件**

```typescript
import { z } from 'zod'

export const ApprovalPolicySchema = z.enum(['on-request', 'untrusted', 'suggest', 'auto', 'never'])
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'auto'

export const SandboxModeSchema = z.enum([
  'read-only',
  'workspace-write',
  'danger-full-access',
  'external-sandbox'
])
export type SandboxMode = z.infer<typeof SandboxModeSchema>

export const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write'

export const InsecureSchema = z.boolean().default(false)
export type Insecure = z.infer<typeof InsecureSchema>

export const StorageBackendSchema = z.enum(['memory', 'file', 'hybrid'])
export type StorageBackend = z.infer<typeof StorageBackendSchema>

export const DEFAULT_STORAGE_BACKEND: StorageBackend = 'hybrid'
```

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\policy.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit policy.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\policy.ts"
git commit -m "feat(contracts): add policy schema definitions"
```

---

### Task 3: 迁移 errors.ts（Contracts 层基础）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\errors.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\errors.ts`

- [ ] **Step 1: 读取源文件并创建 errors.ts**

从 Kun 源文件读取完整内容，创建目标文件（内容无需替换，仅包含错误类型定义）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\errors.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit errors.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\errors.ts"
git commit -m "feat(contracts): add error type definitions"
```

---

### Task 4: 迁移 usage.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\usage.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\usage.ts`

- [ ] **Step 1: 读取源文件并创建 usage.ts**

从 Kun 源文件读取内容，创建目标文件（定义用量统计 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\usage.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit usage.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\usage.ts"
git commit -m "feat(contracts): add usage snapshot schema"
```

---

### Task 5: 迁移 capabilities.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\capabilities.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\capabilities.ts`

- [ ] **Step 1: 读取源文件并创建 capabilities.ts**

从 Kun 源文件读取内容，创建目标文件（定义能力配置 schema）

**注意：** 文件中可能包含 `KUN_` 常量，需要替换为 `TEAMFLOW_AGENT_`

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\capabilities.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit capabilities.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\capabilities.ts"
git commit -m "feat(contracts): add capabilities configuration schema"
```

---

### Task 6: 迁移 model-endpoint-format.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\model-endpoint-format.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\model-endpoint-format.ts`

- [ ] **Step 1: 读取源文件并创建 model-endpoint-format.ts**

从 Kun 源文件读取内容，创建目标文件（定义模型端点格式）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\model-endpoint-format.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit model-endpoint-format.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\model-endpoint-format.ts"
git commit -m "feat(contracts): add model endpoint format definitions"
```

---

### Task 7: 迁移 workspace.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\workspace.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\workspace.ts`

- [ ] **Step 1: 读取源文件并创建 workspace.ts**

从 Kun 源文件读取内容，创建目标文件（定义工作区配置 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\workspace.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit workspace.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\workspace.ts"
git commit -m "feat(contracts): add workspace configuration schema"
```

---

### Task 8: 迁移 items.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\items.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\items.ts`
- Modify: `D:\teamflow-desktop-v2\kun\src\contracts\items.ts`（需要处理导入依赖）

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 items.ts 的完整内容

- [ ] **Step 2: 创建 items.ts 文件**

文件内容需要确保导入路径正确：
- `./review.js` → `./review.js`（相对路径保持）
- `./errors.js` → `./errors.js`（相对路径保持）

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\items.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit items.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\items.ts"
git commit -m "feat(contracts): add turn item schemas"
```

---

### Task 9: 迁移 review.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\review.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\review.ts`

- [ ] **Step 1: 读取源文件并创建 review.ts**

从 Kun 源文件读取内容，创建目标文件（定义审查输出 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\review.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit review.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\review.ts"
git commit -m "feat(contracts): add review output schemas"
```

---

### Task 10: 迁移 attachments.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\attachments.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\attachments.ts`

- [ ] **Step 1: 读取源文件并创建 attachments.ts**

从 Kun 源文件读取内容，创建目标文件（定义附件 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\attachments.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit attachments.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\attachments.ts"
git commit -m "feat(contracts): add attachment schemas"
```

---

### Task 11: 迁移 memory.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\memory.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\memory.ts`

- [ ] **Step 1: 读取源文件并创建 memory.ts**

从 Kun 源文件读取内容，创建目标文件（定义内存记录 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\memory.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit memory.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\memory.ts"
git commit -m "feat(contracts): add memory record schemas"
```

---

### Task 12: 迁移 runtime-info.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\runtime-info.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\runtime-info.ts`

- [ ] **Step 1: 读取源文件并创建 runtime-info.ts**

从 Kun 源文件读取内容，创建目标文件（定义运行时信息 schema）

**注意：** 替换端口默认值 8899 → 8898

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\runtime-info.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit runtime-info.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\runtime-info.ts"
git commit -m "feat(contracts): add runtime info schema"
```

---

### Task 13: 迁移 turns.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\turns.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\turns.ts`
- Dependencies: items.ts, policy.ts

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 turns.ts 的完整内容（约 100+ 行）

- [ ] **Step 2: 创建 turns.ts 文件**

确保导入路径正确：
- `./items.js` → `./items.js`
- `../shared/gui-plan.js` → 需要先迁移 shared 目录或调整路径
- `./policy.js` → `./policy.js`

**注意：** 检查是否有 `Kun` 相关注释需要替换

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\turns.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit turns.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\turns.ts"
git commit -m "feat(contracts): add turn schemas"
```

---

### Task 14: 迁移 threads.ts（Contracts 层核心）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\threads.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\threads.ts`
- Dependencies: turns.ts, policy.ts

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 threads.ts 的完整内容（约 150+ 行）

- [ ] **Step 2: 创建 threads.ts 文件**

确保导入路径正确：
- `./turns.js` → `./turns.js`
- `./policy.js` → `./policy.js`

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\threads.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit threads.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\threads.ts"
git commit -m "feat(contracts): add thread schemas"
```

---

### Task 15: 迁移 events.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\events.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\events.ts`
- Dependencies: items.ts, threads.ts, usage.ts, errors.ts, policy.ts, capabilities.ts

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 events.ts 的完整内容（约 100+ 行）

- [ ] **Step 2: 创建 events.ts 文件**

确保所有导入路径正确：
- `./items.js` → `./items.js`
- `./threads.js` → `./threads.js`
- `./usage.js` → `./usage.js`
- `./errors.js` → `./errors.js`
- `./policy.js` → `./policy.js`
- `./capabilities.js` → `./capabilities.js`

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\events.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit events.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\events.ts"
git commit -m "feat(contracts): add runtime event schemas"
```

---

### Task 16: 迁移 approvals.ts（Contracts 层）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\contracts\approvals.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\approvals.ts`

- [ ] **Step 1: 读取源文件并创建 approvals.ts**

从 Kun 源文件读取内容，创建目标文件（定义审批请求/响应 schema）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\contracts\approvals.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit approvals.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\approvals.ts"
git commit -m "feat(contracts): add approval schemas"
```

---

### Task 17: 更新 contracts/index.ts

**Files:**
- Modify: `D:\teamflow-desktop-v2\kun\src\contracts\index.ts`

- [ ] **Step 1: 更新 contracts/index.ts 导出**

```typescript
export * from './threads.js'
export * from './turns.js'
export * from './items.js'
export * from './review.js'
export * from './events.js'
export * from './approvals.js'
export * from './attachments.js'
export * from './usage.js'
export * from './policy.js'
export * from './workspace.js'
export * from './errors.js'
export * from './capabilities.js'
export * from './runtime-info.js'
export * from './memory.js'
export * from './model-endpoint-format.js'
```

- [ ] **Step 2: 验证导出完整性**

```bash
cd "D:\teamflow-desktop-v2\kun"
npx tsc --noEmit src/contracts/index.ts
```

Expected: 类型检查通过（或显示具体错误）

- [ ] **Step 3: Commit contracts/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\index.ts"
git commit -m "feat(contracts): update index exports for all contract modules"
```

---

### Task 18: 迁移 Domain 层 - thread.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\thread.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\thread.ts`

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 domain/thread.ts 的完整内容

- [ ] **Step 2: 创建 domain/thread.ts 文件**

确保导入路径正确：
- `../contracts/threads.js` → `../contracts/threads.js`
- `../contracts/policy.js` → `../contracts/policy.js`

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\thread.ts"
```

Expected: 文件存在

- [ ] **Step 4: Commit domain/thread.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\thread.ts"
git commit -m "feat(domain): add thread entity helpers"
```

---

### Task 19: 迁移 Domain 层 - turn.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\turn.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\turn.ts`

- [ ] **Step 1: 读取源文件并创建 domain/turn.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\turn.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/turn.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\turn.ts"
git commit -m "feat(domain): add turn entity helpers"
```

---

### Task 20: 迁移 Domain 层 - item.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\item.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\item.ts`

- [ ] **Step 1: 读取源文件并创建 domain/item.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\item.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/item.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\item.ts"
git commit -m "feat(domain): add item entity helpers"
```

---

### Task 21: 迁移 Domain 层 - event.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\event.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\event.ts`

- [ ] **Step 1: 读取源文件并创建 domain/event.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\event.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/event.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\event.ts"
git commit -m "feat(domain): add event entity helpers"
```

---

### Task 22: 迁移 Domain 层 - approval.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\approval.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\approval.ts`

- [ ] **Step 1: 读取源文件并创建 domain/approval.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\approval.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/approval.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\approval.ts"
git commit -m "feat(domain): add approval entity helpers"
```

---

### Task 23: 迁移 Domain 层 - usage.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\usage.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\usage.ts`

- [ ] **Step 1: 读取源文件并创建 domain/usage.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\usage.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/usage.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\usage.ts"
git commit -m "feat(domain): add usage entity helpers"
```

---

### Task 24: 迁移 Domain 层 - session.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\session.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\session.ts`

- [ ] **Step 1: 读取源文件并创建 domain/session.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\session.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/session.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\session.ts"
git commit -m "feat(domain): add session entity helpers"
```

---

### Task 25: 迁移 Domain 层 - model-history-repair.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\model-history-repair.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\model-history-repair.ts`

- [ ] **Step 1: 读取源文件并创建 domain/model-history-repair.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\model-history-repair.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit model-history-repair.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\model-history-repair.ts"
git commit -m "feat(domain): add model history repair utilities"
```

---

### Task 26: 迁移 Domain 层 - runtime-event-reducer.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\runtime-event-reducer.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\domain\runtime-event-reducer.ts`

- [ ] **Step 1: 读取源文件并创建 domain/runtime-event-reducer.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\runtime-event-reducer.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit runtime-event-reducer.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\runtime-event-reducer.ts"
git commit -m "feat(domain): add runtime event reducer"
```

---

### Task 27: 创建 Domain 层 index.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\domain\index.ts`

- [ ] **Step 1: 创建 domain/index.ts 导出文件**

```typescript
export * from './thread.js'
export * from './turn.js'
export * from './item.js'
export * from './event.js'
export * from './approval.js'
export * from './usage.js'
export * from './session.js'
export * from './model-history-repair.js'
export * from './runtime-event-reducer.js'
```

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\domain\index.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit domain/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\domain\index.ts"
git commit -m "feat(domain): add domain layer exports"
```

---

### Task 28: 迁移 Ports 层 - model-client.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\model-client.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\model-client.ts`

- [ ] **Step 1: 读取源文件并创建 ports/model-client.ts**

从 Kun 源文件读取内容，创建目标文件（定义模型客户端接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\model-client.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/model-client.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\model-client.ts"
git commit -m "feat(ports): add model client interface"
```

---

### Task 29: 迁移 Ports 层 - tool-host.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\tool-host.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\tool-host.ts`

- [ ] **Step 1: 读取源文件并创建 ports/tool-host.ts**

从 Kun 源文件读取内容，创建目标文件（定义工具宿主接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\tool-host.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/tool-host.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\tool-host.ts"
git commit -m "feat(ports): add tool host interface"
```

---

### Task 30: 迁移 Ports 层 - web-provider.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\web-provider.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\web-provider.ts`

- [ ] **Step 1: 读取源文件并创建 ports/web-provider.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\web-provider.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/web-provider.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\web-provider.ts"
git commit -m "feat(ports): add web provider interface"
```

---

### Task 31: 迁移 Ports 层 - thread-store.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\thread-store.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\thread-store.ts`

- [ ] **Step 1: 读取源文件并创建 ports/thread-store.ts**

从 Kun 源文件读取内容，创建目标文件（定义线程存储接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\thread-store.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/thread-store.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\thread-store.ts"
git commit -m "feat(ports): add thread store interface"
```

---

### Task 32: 迁移 Ports 层 - session-store.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\session-store.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\session-store.ts`

- [ ] **Step 1: 读取源文件并创建 ports/session-store.ts**

从 Kun 源文件读取内容，创建目标文件（定义会话存储接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\session-store.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/session-store.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\session-store.ts"
git commit -m "feat(ports): add session store interface"
```

---

### Task 33: 迁移 Ports 层 - event-bus.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\event-bus.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\event-bus.ts`

- [ ] **Step 1: 读取源文件并创建 ports/event-bus.ts**

从 Kun 源文件读取内容，创建目标文件（定义事件总线接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\event-bus.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/event-bus.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\event-bus.ts"
git commit -m "feat(ports): add event bus interface"
```

---

### Task 34: 迁移 Ports 层 - approval-gate.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\approval-gate.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\approval-gate.ts`

- [ ] **Step 1: 读取源文件并创建 ports/approval-gate.ts**

从 Kun 源文件读取内容，创建目标文件（定义审批门接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\approval-gate.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/approval-gate.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\approval-gate.ts"
git commit -m "feat(ports): add approval gate interface"
```

---

### Task 35: 迁移 Ports 层 - user-input-gate.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\user-input-gate.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\user-input-gate.ts`

- [ ] **Step 1: 读取源文件并创建 ports/user-input-gate.ts**

从 Kun 源文件读取内容，创建目标文件（定义用户输入门接口）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\user-input-gate.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/user-input-gate.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\user-input-gate.ts"
git commit -m "feat(ports): add user input gate interface"
```

---

### Task 36: 迁移 Ports 层 - workspace-inspector.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\workspace-inspector.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\workspace-inspector.ts`

- [ ] **Step 1: 读取源文件并创建 ports/workspace-inspector.ts**

从 Kun 源文件读取内容，创建目标文件

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\workspace-inspector.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/workspace-inspector.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\workspace-inspector.ts"
git commit -m "feat(ports): add workspace inspector interface"
```

---

### Task 37: 迁移 Ports 层 - clock.ts 和 id-generator.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\clock.ts`
- Create: `D:\teamflow-desktop-v2\kun\src\ports\id-generator.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\clock.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\ports\id-generator.ts`

- [ ] **Step 1: 读取源文件并创建 ports/clock.ts**

从 Kun 源文件读取内容，创建目标文件（定义时钟接口）

- [ ] **Step 2: 读取源文件并创建 ports/id-generator.ts**

从 Kun 源文件读取内容，创建目标文件（定义 ID 生成器接口）

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\clock.ts"
ls "D:\teamflow-desktop-v2\kun\src\ports\id-generator.ts"
```

Expected: 两个文件都存在

- [ ] **Step 4: Commit ports 辅助文件**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\clock.ts" "kun\src\ports\id-generator.ts"
git commit -m "feat(ports): add clock and id-generator interfaces"
```

---

### Task 38: 创建 Ports 层 index.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\ports\index.ts`

- [ ] **Step 1: 创建 ports/index.ts 导出文件**

```typescript
export * from './model-client.js'
export * from './tool-host.js'
export * from './web-provider.js'
export * from './thread-store.js'
export * from './session-store.js'
export * from './event-bus.js'
export * from './approval-gate.js'
export * from './user-input-gate.js'
export * from './workspace-inspector.js'
export * from './clock.js'
export * from './id-generator.js'
```

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\ports\index.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ports/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\ports\index.ts"
git commit -m "feat(ports): add ports layer exports"
```

---

### Task 39: 迁移 Config 层 - teamflow-agent-config.ts（核心）

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\config\teamflow-agent-config.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\config\kun-config.ts`

- [ ] **Step 1: 读取源文件完整内容**

从 Kun 源文件读取 kun-config.ts 的完整内容（约 150+ 行）

- [ ] **Step 2: 应用命名替换规则**

在源代码中应用以下替换：
- `KUN_CONFIG_FILENAME` → `TEAMFLOW_AGENT_CONFIG_FILENAME`
- `DEFAULT_KUN_MODEL` → `DEFAULT_TEAMFLOW_AGENT_MODEL`（或保持为 MiMo/GPT）
- `KunCapabilitiesConfig` → `TeamflowAgentCapabilitiesConfig`
- 所有 `'kun'` 字符串 → `'teamflow-agent'`
- `'deepseekgui'` → `'teamflowgui'`
- `8899`（端口） → `8898`
- 导入路径中的 `./kun-config.js` → `./teamflow-agent-config.js`

- [ ] **Step 3: 创建 config/teamflow-agent-config.ts 文件**

将替换后的内容写入目标文件

- [ ] **Step 4: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\config\teamflow-agent-config.ts"
```

Expected: 文件存在

- [ ] **Step 5: Commit teamflow-agent-config.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\config\teamflow-agent-config.ts"
git commit -m "feat(config): add teamflow-agent configuration schema"
```

---

### Task 40: 迁移 Config 层 - secret-redaction.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\config\secret-redaction.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\config\secret-redaction.ts`

- [ ] **Step 1: 读取源文件并创建 config/secret-redaction.ts**

从 Kun 源文件读取内容，创建目标文件（密钥脱敏功能）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\config\secret-redaction.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit secret-redaction.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\config\secret-redaction.ts"
git commit -m "feat(config): add secret redaction utilities"
```

---

### Task 41: 创建 Config 层 index.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\config\index.ts`

- [ ] **Step 1: 创建 config/index.ts 导出文件**

```typescript
export * from './teamflow-agent-config.js'
export * from './secret-redaction.js'
```

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\config\index.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit config/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\config\index.ts"
git commit -m "feat(config): add config layer exports"
```

---

### Task 42: 迁移 Cache 层 - lru-cache.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\lru-cache.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\cache\lru-cache.ts`

- [ ] **Step 1: 读取源文件并创建 cache/lru-cache.ts**

从 Kun 源文件读取内容，创建目标文件（LRU 缓存实现）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\lru-cache.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit lru-cache.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\lru-cache.ts"
git commit -m "feat(cache): add LRU cache implementation"
```

---

### Task 43: 迁移 Cache 层 - ttl-lru-cache.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\ttl-lru-cache.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\cache\ttl-lru-cache.ts`

- [ ] **Step 1: 读取源文件并创建 cache/ttl-lru-cache.ts**

从 Kun 源文件读取内容，创建目标文件（TTL LRU 缓存实现）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\ttl-lru-cache.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit ttl-lru-cache.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\ttl-lru-cache.ts"
git commit -m "feat(cache): add TTL LRU cache implementation"
```

---

### Task 44: 迁移 Cache 层 - immutable-prefix.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\immutable-prefix.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\cache\immutable-prefix.ts`

- [ ] **Step 1: 读取源文件并创建 cache/immutable-prefix.ts**

从 Kun 源文件读取内容，创建目标文件（不可变前缀工具）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\immutable-prefix.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit immutable-prefix.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\immutable-prefix.ts"
git commit -m "feat(cache): add immutable prefix utilities"
```

---

### Task 45: 迁移 Cache 层 - prefix-volatility.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\prefix-volatility.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\cache\prefix-volatility.ts`

- [ ] **Step 1: 读取源文件并创建 cache/prefix-volatility.ts**

从 Kun 源文件读取内容，创建目标文件（前缀易变性检测）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\prefix-volatility.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit prefix-volatility.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\prefix-volatility.ts"
git commit -m "feat(cache): add prefix volatility utilities"
```

---

### Task 46: 迁移 Cache 层 - tool-catalog-fingerprint.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\tool-catalog-fingerprint.ts`
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\cache\tool-catalog-fingerprint.ts`

- [ ] **Step 1: 读取源文件并创建 cache/tool-catalog-fingerprint.ts**

从 Kun 源文件读取内容，创建目标文件（工具目录指纹）

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\tool-catalog-fingerprint.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit tool-catalog-fingerprint.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\tool-catalog-fingerprint.ts"
git commit -m "feat(cache): add tool catalog fingerprint utilities"
```

---

### Task 47: 创建 Cache 层 index.ts

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\src\cache\index.ts`

- [ ] **Step 1: 创建 cache/index.ts 导出文件**

```typescript
export * from './lru-cache.js'
export * from './ttl-lru-cache.js'
export * from './immutable-prefix.js'
export * from './prefix-volatility.js'
export * from './tool-catalog-fingerprint.js'
```

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\cache\index.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit cache/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\cache\index.ts"
git commit -m "feat(cache): add cache layer exports"
```

---

### Task 48: 更新 kun/src/index.ts 主导出文件

**Files:**
- Modify: `D:\teamflow-desktop-v2\kun\src\index.ts`（如果存在）
- Create: `D:\teamflow-desktop-v2\kun\src\index.ts`（如果不存在）

- [ ] **Step 1: 创建或更新 kun/src/index.ts**

```typescript
/**
 * Teamflow Agent Runtime public surface.
 *
 * The package exposes a small set of named entrypoints that the Teamflow
 * main process and CLI use. The submodules contain the actual implementation
 * and additional re-exports.
 */

export * from './contracts/index.js'
export * from './domain/index.js'
export * from './ports/index.js'
export * from './config/index.js'
export * from './cache/index.js'
```

**注意：** 暂不导出 adapters、services、loop 等第二批迁移的模块

- [ ] **Step 2: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\src\index.ts"
```

Expected: 文件存在

- [ ] **Step 3: Commit kun/src/index.ts**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\index.ts"
git commit -m "feat: add main index exports for first batch modules"
```

---

### Task 49: 迁移测试文件（Contracts 层）

**Files:**
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\contracts\*.test.ts`（如果有）
- Target: `D:\teamflow-desktop-v2\kun\src\contracts\*.test.ts`

- [ ] **Step 1: 查找并迁移 contracts 测试文件**

检查 Kun contracts 目录是否有测试文件，如有则迁移

- [ ] **Step 2: 运行测试验证**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm run test -- src/contracts
```

Expected: 测试通过或显示具体失败原因

- [ ] **Step 3: Commit 测试文件**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\contracts\*.test.ts"
git commit -m "test(contracts): add contract layer tests"
```

---

### Task 50: 迁移测试文件（Config 层）

**Files:**
- Source: `C:\Users\given\Desktop\Kun-master\kun\src\config\kun-config.test.ts`
- Target: `D:\teamflow-desktop-v2\kun\src\config\teamflow-agent-config.test.ts`

- [ ] **Step 1: 读取并迁移 kun-config.test.ts**

读取测试文件，应用命名替换后创建 `teamflow-agent-config.test.ts`

- [ ] **Step 2: 运行测试验证**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm run test -- src/config
```

Expected: 测试通过

- [ ] **Step 3: Commit 测试文件**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\src\config\teamflow-agent-config.test.ts"
git commit -m "test(config): add config layer tests"
```

---

### Task 51: 创建/更新 package.json

**Files:**
- Modify: `D:\teamflow-desktop-v2\kun\package.json`（如果存在）
- Create: `D:\teamflow-desktop-v2\kun\package.json`（如果不存在）

- [ ] **Step 1: 创建或更新 kun/package.json**

```json
{
  "name": "teamflow-agent",
  "version": "0.1.0",
  "description": "Teamflow Agent local HTTP/SSE agent runtime",
  "license": "MIT",
  "type": "module",
  "private": true,
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./contracts": {
      "types": "./dist/contracts/index.d.ts",
      "import": "./dist/contracts/index.js"
    },
    "./domain": {
      "types": "./dist/domain/index.d.ts",
      "import": "./dist/domain/index.js"
    },
    "./ports": {
      "types": "./dist/ports/index.d.ts",
      "import": "./dist/ports/index.js"
    },
    "./config": {
      "types": "./dist/config/index.d.ts",
      "import": "./dist/config/index.js"
    },
    "./cache": {
      "types": "./dist/cache/index.d.ts",
      "import": "./dist/cache/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vitest": "^4.1.7",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: 验证 package.json 创建**

```bash
ls "D:\teamflow-desktop-v2\kun\package.json"
```

Expected: 文件存在

- [ ] **Step 3: Commit package.json**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\package.json"
git commit -m "feat: add teamflow-agent package.json for first batch"
```

---

### Task 52: 创建 tsconfig.json

**Files:**
- Create: `D:\teamflow-desktop-v2\kun\tsconfig.json`
- Create: `D:\teamflow-desktop-v2\kun\tsconfig.build.json`

- [ ] **Step 1: 创建 kun/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: 创建 kun/tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false
  }
}
```

- [ ] **Step 3: 验证文件创建**

```bash
ls "D:\teamflow-desktop-v2\kun\tsconfig.json"
ls "D:\teamflow-desktop-v2\kun\tsconfig.build.json"
```

Expected: 两个文件都存在

- [ ] **Step 4: Commit tsconfig 文件**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\tsconfig.json" "kun\tsconfig.build.json"
git commit -m "feat: add TypeScript configuration for teamflow-agent"
```

---

### Task 53: 安装依赖

**Files:**
- Modify: `D:\teamflow-desktop-v2\kun\package-lock.json`（自动生成）

- [ ] **Step 1: 安装 npm 依赖**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm install
```

Expected: 依赖安装成功，生成 package-lock.json

- [ ] **Step 2: 验证安装**

```bash
ls "D:\teamflow-desktop-v2\kun\node_modules"
```

Expected: node_modules 目录存在

- [ ] **Step 3: Commit package-lock.json**

```bash
cd "D:\teamflow-desktop-v2"
git add "kun\package-lock.json"
git commit -m "chore: lock teamflow-agent dependencies"
```

---

### Task 54: 运行 TypeScript 类型检查

**Files:**
- 无文件修改

- [ ] **Step 1: 运行 typecheck**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm run typecheck
```

Expected: 类型检查通过，无错误

- [ ] **Step 2: 如果有类型错误，修复导入路径**

检查并修复可能的导入路径问题：
- `.js` 后缀是否正确
- 相对路径是否正确

- [ ] **Step 3: 再次验证**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm run typecheck
```

Expected: 类型检查通过

---

### Task 55: 构建测试

**Files:**
- Modify: `D:\teamflow-desktop-v2\kun\dist\*`（构建产物）

- [ ] **Step 1: 运行 build**

```bash
cd "D:\teamflow-desktop-v2\kun"
npm run build
```

Expected: 构建成功，dist 目录生成

- [ ] **Step 2: 验证构建产物**

```bash
ls "D:\teamflow-desktop-v2\kun\dist"
```

Expected: 显示 contracts, domain, ports, config, cache, index.js 等产物

- [ ] **Step 3: Commit 构建产物（可选）**

通常不提交 dist 目录，但可以验证构建是否正常

---

### Task 56: 验证导出完整性

**Files:**
- 无文件修改

- [ ] **Step 1: 创建测试脚本验证导出**

```typescript
// test-exports.ts
import * as contracts from './dist/contracts/index.js'
import * as domain from './dist/domain/index.js'
import * as ports from './dist/ports/index.js'
import * as config from './dist/config/index.js'
import * as cache from './dist/cache/index.js'

console.log('Contracts exports:', Object.keys(contracts))
console.log('Domain exports:', Object.keys(domain))
console.log('Ports exports:', Object.keys(ports))
console.log('Config exports:', Object.keys(config))
console.log('Cache exports:', Object.keys(cache))
```

- [ ] **Step 2: 运行验证脚本**

```bash
cd "D:\teamflow-desktop-v2\kun"
node --experimental-specifier-resolution=node test-exports.ts
```

Expected: 显示所有导出的键名

- [ ] **Step 3: 清理测试脚本**

```bash
rm test-exports.ts
```

---

### Task 57: 创建第一批迁移总结文档

**Files:**
- Create: `D:\teamflow-desktop-v2\docs\migration-batch-1-summary.md`

- [ ] **Step 1: 创建总结文档**

记录第一批迁移的完成情况：
- 迁移的文件数量
- 遇到的问题和解决方案
- 未解决的依赖（如 shared/gui-plan.ts）
- 下一步计划

- [ ] **Step 2: Commit 总结文档**

```bash
cd "D:\teamflow-desktop-v2"
git add "docs\migration-batch-1-summary.md"
git commit -m "docs: add first batch migration summary"
```

---

### Task 58: 最终验证和提交

**Files:**
- 无文件修改

- [ ] **Step 1: 检查所有文件是否存在**

```bash
cd "D:\teamflow-desktop-v2"
ls kun/src/contracts
ls kun/src/domain
ls kun/src/ports
ls kun/src/config
ls kun/src/cache
```

Expected: 所有目录包含预期的文件

- [ ] **Step 2: 检查命名替换完整性**

```bash
cd "D:\teamflow-desktop-v2\kun\src"
grep -r "kun" --exclude-dir=node_modules .
grep -r "Kun" --exclude-dir=node_modules .
grep -r "KUN_" --exclude-dir=node_modules .
grep -r "deepseekgui" --exclude-dir=node_modules .
```

Expected: 无结果（或仅显示模型名称等保留项）

- [ ] **Step 3: 创建合并提交**

```bash
cd "D:\teamflow-desktop-v2"
git add kun
git commit -m "feat: complete first batch migration of teamflow-agent runtime

Migrated modules:
- contracts (16 files)
- domain (9 files)
- ports (12 files)
- config (2 files)
- cache (5 files)

Replaced naming:
- kun → teamflow-agent
- Kun → Teamflow Agent
- KUN_ → TEAMFLOW_AGENT_
- deepseekgui → teamflowgui
- port 8899 → 8898

Next: Batch 2 (adapters, services, loop)"
```

---

## 自检清单

在完成所有任务后，执行以下自检：

### 1. 文件完整性检查

- [ ] contracts 目录包含 16 个文件
- [ ] domain 目录包含 9 个文件
- [ ] ports 目录包含 12 个文件
- [ ] config 目录包含 2 个核心文件 + index.ts
- [ ] cache 目录包含 5 个文件 + index.ts
- [ ] kun/src/index.ts 存在且导出正确

### 2. 类型检查

- [ ] `npm run typecheck` 无错误
- [ ] 所有导入路径使用 `.js` 后缀
- [ ] 无循环依赖警告

### 3. 命名替换检查

- [ ] 无 `kun` 字样（除模型名称）
- [ ] 无 `Kun` 字样（除注释中的 Teamflow Agent）
- [ ] 无 `KUN_` 常量（已替换为 `TEAMFLOW_AGENT_`）
- [ ] 无 `deepseekgui` 字样（已替换为 `teamflowgui`）
- [ ] 端口默认值改为 8898

### 4. 导出检查

- [ ] contracts/index.ts 导出所有子模块
- [ ] domain/index.ts 导出所有子模块
- [ ] ports/index.ts 导出所有子模块
- [ ] config/index.ts 导出所有子模块
- [ ] cache/index.ts 导出所有子模块
- [ ] kun/src/index.ts 导出所有顶层模块

### 5. 构建检查

- [ ] `npm run build` 成功
- [ ] dist 目录生成
- [ ] 所有模块有对应的 .js 和 .d.ts 文件

### 6. 测试检查

- [ ] `npm run test` 通过（或有预期的失败需后续修复）
- [ ] 测试文件已迁移

---

## 预期问题与解决方案

### 问题 1: shared/gui-plan.ts 依赖

**现象：** turns.ts 导入 `../shared/gui-plan.js`，但 shared 目录尚未迁移

**解决方案：**
- 选项 A: 先迁移 shared/gui-plan.ts 到 kun/src/shared/
- 选项 B: 暂时注释掉相关导入，第二批迁移时处理
- 选项 C: 创建 stub 文件

### 问题 2: hooks/hook-config.ts 依赖

**现象：** config/teamflow-agent-config.ts 导入 hooks 模块，但 hooks 尚未迁移

**解决方案：**
- 选项 A: 先迁移 hooks/hook-config.ts
- 选项 B: 暂时注释掉 HooksConfigSchema 导入
- 选项 C: 在 config 中定义简化版 schema

### 问题 3: 循环依赖

**现象：** threads.ts 和 turns.ts 可能存在循环导入

**解决方案：**
- 保持现有的导入结构（Kun 已解决此问题）
- 如有警告，检查是否使用了 `import type`

---

## 后续批次预告

**第二批（预计 2-3 天）：**
- adapters/model（模型客户端实现）
- adapters/tool（工具实现）
- adapters/file（文件存储）
- adapters/hybrid（混合存储）
- adapters/workspace（工作区检查）

**第三批（预计 2-3 天）：**
- services（线程/回合编排）
- loop（Agent 循环）
- telemetry（用量统计）

---

## 参考资源

- 设计文档: `docs/superpowers/specs/2026-06-20-teamflow-agent-runtime-migration.md`
- Kun 源码: `C:\Users\given\Desktop\Kun-master\kun\src\`
- Teamflow 目标: `D:\teamflow-desktop-v2\kun\src\`