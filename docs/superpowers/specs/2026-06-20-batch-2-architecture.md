# QWicks Runtime - 第二批迁移架构文档

**日期：** 2026-06-20  
**状态：** 规划中  
**依赖：** 第一批迁移已完成

---

## 一、当前状态

### 已完成（第一批）

| 模块 | 文件数 | 状态 |
|------|--------|------|
| contracts | 17 | ✅ 完成 |
| domain | 10 | ✅ 完成 |
| ports | 12 | ✅ 完成 |
| config | 3 | ✅ 完成 |
| cache | 6 | ✅ 完成 |
| shared | 1 | ✅ 完成 |
| **总计** | **49** | ✅ 类型检查通过 |

### 待迁移（第二批）

| 模块 | 预估文件数 | 复杂度 | 关键挑战 |
|------|-----------|--------|---------|
| adapters/model | 7 | ⭐⭐⭐⭐⭐ | 多 API 格式、proxy-agent |
| adapters/tool | 30+ | ⭐⭐⭐⭐⭐ | MCP SDK、系统命令 |
| adapters/file | 3 | ⭐ | 简单文件 I/O |
| adapters/hybrid | 2 | ⭐⭐⭐⭐ | better-sqlite3 原生模块 |
| adapters/workspace | 1 | ⭐ | git 命令调用 |
| services | 6 | ⭐⭐⭐ | 服务层整合 |
| loop | 20+ | ⭐⭐⭐⭐⭐ | AgentLoop 核心 |
| telemetry | 3 | ⭐ | 简单 |
| server | 15+ | ⭐⭐⭐ | Node http 模块 |
| cli | 4 | ⭐ | 可选 |
| **总计** | **~90+** | - | - |

---

## 二、原生模块解决方案

### 问题分析

QWicks 使用了两个关键原生 Node.js 模块：

| 模块 | 用途 | QWicks 位置 | 困难 |
|------|------|---------|------|
| `better-sqlite3` | SQLite 数据库 | adapters/hybrid | 需要 Node.js 绑定，Electron 中需要重新编译 |
| `proxy-agent` | HTTP 代理 | adapters/model | Node.js 特定，依赖 `http`/`https` 模块 |

### QWicks 现有方案

QWicks 已在 Tauri/Rust 后端使用 `rusqlite`：

```toml
# src-tauri/Cargo.toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

### 解决方案对比

#### 方案 A：Tauri IPC 桥接（推荐）

**架构：**
```
┌─────────────────────────────────────────────────────┐
│                    QWicks                    │
│  (TypeScript/Node.js 兼容层)                         │
├─────────────────────────────────────────────────────┤
│                 Tauri IPC Bridge                     │
│  (@tauri-apps/api invoke)                            │
├─────────────────────────────────────────────────────┤
│                 Tauri Rust Backend                   │
│  (rusqlite + native filesystem)                     │
└─────────────────────────────────────────────────────┘
```

**优点：**
- 利用现有 Tauri 后端
- 不需要 Electron 原生模块重新编译
- Rust 性能优秀
- 安全性更好（Tauri 沙箱）

**缺点：**
- 需要修改 hybrid-thread-store 调用方式
- IPC 通信开销（但可忽略）
- 需要在 Rust 端实现相同逻辑

**实施步骤：**
1. 在 `src-tauri/src/lib.rs` 中暴露 SQLite 操作 API
2. 创建 TypeScript 封装层调用 Tauri IPC
3. 修改 `hybrid-thread-store.ts` 使用新接口

#### 方案 B：better-sqlite3 Electron 适配

**架构：**
```
┌─────────────────────────────────────────────────────┐
│                    QWicks                    │
│  (TypeScript)                                        │
├─────────────────────────────────────────────────────┤
│                 better-sqlite3                       │
│  (Electron rebuild required)                        │
├─────────────────────────────────────────────────────┤
│                 Electron/Node.js                     │
└─────────────────────────────────────────────────────┘
```

**优点：**
- 保持 QWicks 原有代码不变
- 直接复用 hybrid-thread-store

**缺点：**
- 需要 `electron-rebuild`
- 打包复杂度增加
- 与 Tauri 架构冲突
- 违背 QWicks 技术栈统一性

#### 方案 C：sql.js 内存 SQLite

**架构：**
```
┌─────────────────────────────────────────────────────┐
│                    QWicks                    │
│  (TypeScript)                                        │
├─────────────────────────────────────────────────────┤
│                 sql.js                               │
│  (纯 JavaScript SQLite，WebAssembly)                │
└─────────────────────────────────────────────────────┘
```

**优点：**
- 无原生依赖
- 跨平台兼容

**缺点：**
- 性能较差
- 数据库在内存中，持久化需手动处理
- 不适合大量数据

### 推荐方案

**采用方案 A：Tauri IPC 桥接**

理由：
1. QWicks 已有 Tauri 后端和 rusqlite
2. 避免引入新的原生依赖
3. 与 QWicks 整体架构一致
4. 安全性和性能更优

---

## 三、proxy-agent 解决方案

### 问题分析

`proxy-agent` 用于支持 HTTP 代理，依赖 Node.js 特定模块：
- `http`/`https` - Node.js 内置
- `child_process` - 系统命令

### 解决方案

#### 方案 A：移除代理支持（推荐初期）

第一阶段移除 `proxy-agent` 依赖，直接使用 `fetch`：

```typescript
// 简化版本
const response = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(data)
})
```

**适用场景：** 
- 无代理环境
- 后续可扩展

#### 方案 B：Tauri 代理

在 Tauri Rust 端实现代理：

```rust
// src-tauri/src/proxy.rs
use reqwest::Proxy;

pub async fn fetch_with_proxy(url: &str, proxy_url: Option<&str>) -> Result<String> {
    let client = if let Some(proxy) = proxy_url {
        reqwest::Client::builder()
            .proxy(Proxy::all(proxy)?)
            .build()?
    } else {
        reqwest::Client::new()
    };
    let resp = client.get(url).send().await?;
    Ok(resp.text().await?)
}
```

#### 方案 C：系统代理检测

自动检测系统代理设置（Windows/系统级）：

```typescript
// 检测 Windows 系统代理
const proxyConfig = await invoke('get_system_proxy')
```

### 推荐方案

**第一阶段：方案 A（移除代理支持）**
**第二阶段：方案 B（Tauri 代理）**

---

## 四、系统命令解决方案

### 问题模块

| 模块 | 使用的命令 | 用途 |
|------|-----------|------|
| LocalWorkspaceInspector | `git` | 获取工作区状态 |
| BashTool | `bash`/`cmd` | Shell 命令执行 |
| GrepTool | `grep` | 文件搜索 |
| FindTool | `find` | 文件查找 |

### 解决方案

#### Git 命令

**方案：使用 Tauri 命令执行**

```rust
// src-tauri/src/git.rs
use std::process::Command;

pub fn git_status(workspace: &str) -> Result<String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(workspace)
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
```

#### Bash/Shell 命令

**方案：Tauri sidecar 或 shell API**

```typescript
// 使用 Tauri Shell API
import { Command } from '@tauri-apps/plugin-shell'

const result = await Command.create('bash', ['-c', command]).execute()
```

**或使用 Sidecar：**

```rust
// Cargo.toml
[bundle]
externalBin = ["binaries/qwicks-shell"]
```

#### Grep/Find

**方案：纯 TypeScript 实现**

```typescript
// 使用 ripgrep WASM 或纯 JS 实现
import { glob } from 'glob'
import { readFileSync } from 'fs'

async function grep(pattern: string, path: string): Promise<string[]> {
  const files = await glob('**/*', { cwd: path })
  // 实现搜索逻辑
}
```

---

## 五、MCP SDK 兼容性

### 问题分析

QWicks 使用 `@modelcontextprotocol/sdk` 实现 MCP 协议。

### 解决方案

**方案 A：直接使用（推荐）**

MCP SDK 是纯 JavaScript，兼容 Node.js 和浏览器环境：

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
```

**方案 B：Tauri IPC**

如果遇到兼容问题，可以通过 Tauri IPC 在 Rust 端实现。

### 验证步骤

1. 安装 MCP SDK
2. 测试基本连接
3. 验证工具调用

---

## 六、架构决策记录

### ADR-001: 数据库策略

**决策：** 使用 Tauri rusqlite 替代 better-sqlite3

**理由：**
- 现有基础设施
- 无原生模块编译问题
- 性能更优

**影响：**
- hybrid-thread-store 需要重写 IPC 调用
- SQLite 操作集中在 Rust 端

### ADR-002: 代理策略

**决策：** 第一阶段移除 proxy-agent，第二阶段在 Tauri 端实现

**理由：**
- 简化初期迁移
- 保持架构一致性

**影响：**
- 初期不支持 HTTP 代理
- 需要在 Rust 端实现代理支持

### ADR-003: 命令执行策略

**决策：** 使用 Tauri Shell API 和自定义 Rust 命令

**理由：**
- 安全性可控
- 跨平台兼容
- 与 Tauri 架构一致

**影响：**
- BashTool 需要适配 Tauri Shell
- Git 命令通过 Tauri IPC

### ADR-004: HTTP 客户端策略

**决策：** 使用原生 fetch，放弃 Node 特定功能

**理由：**
- fetch 在 Node 18+ 和 Electron 中原生支持
- 减少依赖

**影响：**
- compat-model-client 简化
- 移除 proxy-agent

---

## 七、迁移批次规划

### 批次 1：基础适配器

**目标：** 迁移无原生依赖的适配器

**模块：**
- adapters/model（部分）
- adapters/file
- adapters/workspace

**预计时间：** 1-2 天

### 批次 2：工具层

**目标：** 迁移核心工具实现

**模块：**
- adapters/tool（bash, read, edit, write, grep, find, ls）

**预计时间：** 2-3 天

**关键任务：**
- 适配系统命令到 Tauri Shell
- 实现 MCP 工具提供者

### 批次 3：存储层

**目标：** 实现 SQLite IPC 桥接

**模块：**
- adapters/hybrid（重写为 Tauri IPC）

**预计时间：** 1-2 天

**关键任务：**
- 在 Rust 端实现 SQLite API
- TypeScript 封装层

### 批次 4：服务层

**目标：** 迁移核心服务

**模块：**
- services/*

**预计时间：** 1-2 天

### 批次 5：核心循环

**目标：** 迁移 AgentLoop

**模块：**
- loop/*

**预计时间：** 2-3 天

### 批次 6：HTTP 服务

**目标：** 迁移服务器层

**模块：**
- telemetry
- server
- cli

**预计时间：** 1-2 天

---

## 八、风险评估

### 高风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AgentLoop 复杂度 | 核心功能无法运行 | 逐函数迁移，保留原代码参考 |
| SQLite IPC 性能 | 数据库操作变慢 | 批量操作，缓存策略 |
| MCP SDK 兼容性 | 工具集成失败 | 早期验证，准备备选方案 |

### 中风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 命令执行权限 | 安全问题 | Tauri 权限控制 |
| 大文件迁移遗漏 | 编译错误 | 自动化检查脚本 |

### 低风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 代码风格差异 | 维护困难 | 统一代码规范 |
| 测试覆盖不足 | 质量问题 | 补充测试 |

---

## 九、下一步行动

1. **验证 MCP SDK 兼容性**
   ```bash
   cd D:\qwicks-desktop-v2\qwicks
   npm install @modelcontextprotocol/sdk
   ```

2. **创建 Tauri SQLite API**
   - 在 Rust 端实现基础 CRUD
   - 暴露 IPC 接口

3. **开始批次 1 迁移**
   - adapters/model（简化版）
   - adapters/file
   - adapters/workspace

---

## 十、决策确认

请确认以下关键决策：

1. **数据库方案：** 使用 Tauri rusqlite 通过 IPC 桥接（是/否）
2. **代理方案：** 第一阶段移除 proxy-agent（是/否）
3. **命令执行：** 使用 Tauri Shell API（是/否）
4. **MCP SDK：** 直接使用 TypeScript 版本（是/否）

确认后即可开始批次 1 迁移。