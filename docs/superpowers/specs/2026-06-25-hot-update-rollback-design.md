# 热更新撤包（Rollback）功能 — 设计文档

- 日期: 2026-06-25
- 目标: 让发布者（你）能撤回一个有问题的热更新（code update），客户端被动接受回退、用户无选择权。

---

## 一、背景与已确认决策

### 现状（探查结论）
1. **客户端拒绝降级**：`gui-updater.ts:636` 的 `isNewerVersion(manifest.version, currentGuiVersion())` 门控安装——服务器把 `code-latest.json` 指回旧版本，客户端判定「不是更新」直接忽略。
2. **无版本历史**：`installCodeUpdatePackage`（`code-update.ts:256-293`）安装时直接覆盖 `active.json`，不记录上一个版本。但旧版本的 `versions/<id>` 目录物理上还在磁盘（只在 id 冲突时才删，`:276`），**字节还在，缺的是索引和回切逻辑**。
3. **服务器是纯静态 nginx**（`8.138.40.16/qwicks`），客户端被动拉取 `channels/{ch}/latest/code/code-latest.json`。

### 已确认的用户决策
| 决策点 | 选择 |
|---|---|
| 撤包范围 | **只做热更新撤包**（安装器 .exe 回退需手动重装，不做） |
| 撤包触发 | **发布者控制，用户无选择权**（客户端被动接受，不弹窗不询问） |
| 实现方式 | **服务端指针 + 强制标志**：发布者在服务器改 `code-latest.json` 指向旧版 + 设强制标志，客户端检测到后自动下载回退 |

---

## 二、机制总览

```
发布者撤包操作（服务器侧，纯静态文件操作）
  └─ 把 channels/{ch}/latest/code/code-latest.json 改为指向旧版 code.zip
     + 新增 "forceRollback": true 标志 + "rollbackFromVersion": "<当前坏版本>"
     （code.zip 本身若已被覆盖，需重新 SCP 旧版包上去）

客户端（被动）
  └─ checkCodePackageUpdate() 拉 code-latest.json
     └─ 检测到 forceRollback:true
        └─ 绕过 isNewerVersion 门控（即便旧版本号更低也视为「需要安装」）
        └─ 正常下载 + SHA256 校验 + installCodeUpdatePackage()
        └─ 安装前：把当前 active.json 追加进版本历史（回切点）
        └─ 安装后 relaunch —— 用户无感知地回到上个版本
```

**关键**：客户端**不需要知道这是"降级"**——`forceRollback` 标志让它把「服务器指定的版本」当作必须安装的目标，跳过版本比较。用户全程无 UI、无询问。

---

## 三、详细设计

### 3.1 服务端：强制回退标志（manifest 扩展）

`CodeUpdateManifest`（`code-update.ts:22`）扩展两个可选字段：
```ts
export type CodeUpdateManifest = {
  // ... 现有字段 ...
  /** 发布者设为 true 强制客户端回退到本版本（绕过版本比较）。 */
  forceRollback?: boolean
  /** 配合 forceRollback：记录从哪个版本回退（用于日志/历史），客户端不强校验。 */
  rollbackFromVersion?: string
}
```

`normalizeCodeUpdateManifest`（`gui-updater.ts:529`）透传这两个字段（已是宽松解析，加两个可选布尔/字符串读取即可）。

**发布者操作**：撤包时编辑 `code-latest.json`：
```json
{
  "kind": "code",
  "version": "0.2.42",
  "package": { "name": "code.zip", "url": "..." , "sha256": "..." },
  "forceRollback": true,
  "rollbackFromVersion": "0.2.50"
}
```
然后 SCP 覆盖到服务器。客户端下次检查（定时/启动）即触发回退。

### 3.2 客户端：放行降级（改造 checkCodePackageUpdate）

`gui-updater.ts:636` 现状：
```ts
const hasUpdate = isNewerVersion(manifest.version, currentGuiVersion())
```
改造为：
```ts
const hasUpdate =
  manifest.forceRollback === true || isNewerVersion(manifest.version, currentGuiVersion())
```

`forceRollback:true` 时无论版本号高低都视为「需要安装」。下载、SHA256 校验、安装流程完全复用现有路径（不变）。

> **安全考虑**：`forceRollback` 只能让客户端装一个**服务器指定的、SHA256 校验通过**的包，不能任意降级到磁盘上的旧文件。攻击面等同正常更新（都是服务器推什么装什么）。且兼容性门控 `codeUpdateCompatibleWithShell`（`:575`）仍然生效——回退包的 minShellVersion 不能超过当前 shell。

### 3.3 客户端：版本历史（回切点记录）

**目的**：万一回退后的版本也有问题，或发布者想再切回去，需要有索引知道磁盘上有哪些可用版本。

`installCodeUpdatePackage`（`code-update.ts:256`）在覆盖 `active.json` **之前**（`:291` 之前），把当前 active 快照追加进历史文件：

新文件 `hot-code/history.json`：
```ts
type CodeVersionHistoryEntry = {
  version: string
  root: string            // userData/hot-code/versions/<id>
  sha256?: string
  installedAt: string     // 原安装时间
  rolledBackAt?: string   // 被回退的时间（若有）
}
type CodeVersionHistory = {
  entries: CodeVersionHistoryEntry[]   // 按时间倒序，最新的在前
}
```

`installCodeUpdatePackage` 改造（在写新 active.json 前）：
```ts
// 记录被替换的旧版本到历史
const previous = readActiveCodePackageFromDisk()
if (previous) {
  await appendCodeVersionHistory(previous, reason /* 'update' | 'rollback' */)
}
await writeFile(activeCodePath(), ...)  // 现有逻辑
```

新增 `appendCodeVersionHistory(prev, reason)` 和 `readCodeVersionHistory()` 纯函数。历史文件保留最近 N 条（默认 10），超出删最旧的（同时可清理对应 `versions/<id>` 目录释放空间）。

### 3.4 回退包的特殊处理

`forceRollback` 安装的包，版本号比当前低。安装后 `currentCodeOrShellVersion()` 会变成旧版本号。此时若服务器**撤销了 forceRollback**（发布者把 code-latest.json 改回最新版），客户端会再次看到「有更新」（因为最新版 > 当前旧版），正常升级——**自动恢复**到最新，无需额外操作。

这形成闭环：发布者设 forceRollback → 客户端回退 → 发布者修好新版、撤掉 forceRollback → 客户端自动升回新版。

### 3.5 不做的
- **不做客户端 UI 让用户选版本回退**（你明确：用户无选择权）。
- **不做崩溃自动回退**（发布者控制，非自动）。
- **不做安装器 .exe 回退**（只做热更新）。
- **不做服务端版本归档自动化**（发布者手动 SCP 旧包；CI 工作流可选地保留历史产物，但本次不改 CI）。

---

## 四、实施清单

### 客户端代码（本次实现）
1. `code-update.ts`：扩展 `CodeUpdateManifest`（`forceRollback`/`rollbackFromVersion`）；新增 `history.json` 读写 + `appendCodeVersionHistory` + `readCodeVersionHistory`；`installCodeUpdatePackage` 安装前记录旧版本历史。
2. `gui-updater.ts`：`normalizeCodeUpdateManifest` 透传 forceRollback；`checkCodePackageUpdate:636` 放行降级。
3. 单测：`forceRollback` 透传、降级放行、版本历史追加/读取/上限清理。

### 发布者操作手册（文档，非代码）
在 `docs/` 新增撤包操作说明：如何编辑 `code-latest.json`、如何 SCP 旧包、如何撤销 forceRollback。

---

## 五、测试策略

- **单测**：
  - `normalizeCodeUpdateManifest` 透传 `forceRollback:true`。
  - `checkCodePackageUpdate` 在 `forceRollback:true` 且版本更低时返回 `hasUpdate:true`。
  - `appendCodeVersionHistory` 追加、上限清理（>10 条删最旧 + 删目录）、去重。
  - `installCodeUpdatePackage` 安装前历史已记录旧版本。
- **手动验证**：
  - 服务器设 forceRollback 指向旧版 → 客户端自动回退、relaunch 后版本变旧。
  - 撤销 forceRollback → 客户端自动升回新版。

---

## 六、风险与边界

| 风险 | 缓解 |
|---|---|
| 服务器旧 code.zip 已被覆盖 | 发布者需保留/重新 SCP 旧包；文档说明 |
| 回退包 minShellVersion 超当前 shell | 兼容性门控仍生效，回退被拒（合理，避免装不兼容的） |
| 历史文件无限增长 | 上限 10 条 + 清理对应目录 |
| forceRollback 被恶意服务器滥用 | 攻击面等同正常更新（服务器推什么装什么），SHA256 校验仍在；HTTPS 后可加签名 |

---

## 七、待实现时确认的细节
- 历史上限默认 10 条是否合适（每条对应一个 versions 目录，可能占空间）。
- 回退后是否在「设置→更新」显示一行「已回退到 vX（发布者操作）」让用户知情。倾向：显示一行只读提示（非选择），符合「用户无选择权但知情」。
