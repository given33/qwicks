# 统一版本号体系设计(方案 A)

> 日期:2026-06-26
> 状态:待审阅

## 背景

QWicks 当前有两套版本号,导致严重的更新循环 bug:

- **installer 壳版本**:`0.1.x`(`release-windows.yml` 用 `package.json` 的 `0.1.0` + git commit 数)
- **code(热更新)版本**:`0.2.x`(`release-code-update.yml` 用 `0.2.` + git commit 数,刻意分离的 minor)

`currentCodeOrShellVersion()` 混用两者:有 `active.json` 时返回 code 版本(`0.2.N`),没有时返回 `app.getVersion()`(`0.1.M`)。

### 崩坏机制

`checkGuiUpdate` 检查更新时,code feed 和 installer feed 都查:

1. code 检查:`isNewerVersion('0.2.298', '0.2.298')` = false ✓(已是最新)
2. installer 检查(electron-updater):线上 installer `0.1.297` vs `app.getVersion()`(`0.1.0`,本地构建)→ 判定"有更新"
3. 用户下载安装,但 installer 版本号(0.1.x)和 code 版本号(0.2.x)属于不同序列,安装后版本比较仍然混乱 → **永远显示有更新 / 重启循环**

`downloads/` 目录里混着 `0.1.184`、`0.2.292`、`0.2.296`、`0.2.298` 四个版本的包(历史上两个系列混发过),`gui-version-state.json` 的 `pendingUpdate` 卡在 `0.1.297`(installer 版本)而 `lastSeenVersion` 是 `0.2.298`(code 版本)—— 状态机错乱。

## 设计:统一单一版本号

### 核心原则

**一个版本号空间**。QWicks 只有一个版本 `0.2.N`(N = git commit 数),installer 和 code update 共享同一序列。无论用户装了 installer 还是 code update,`app.getVersion()`(壳)和 code 版本号都是同一个递增序列。

### 1. 版本号生成(CI)

**两个 workflow 统一用 `0.2.N` 公式**:

- `release-code-update.yml`:已经用 `$major=0, $codeMinor=2, $patch=commitCount` → `0.2.N`。**保持不变**。
- `release-windows.yml`:从 `$pkg.version.Split('.')`(=`0.1.N`)改成和 code update 完全相同的公式 `0.2.N`。
- `package.json` 的 `version`:`0.1.0` → `0.2.0`(作为本地构建/开发时的壳版本基准)。

**关键约束的天然满足**:下一次 installer 发布的版本必须 ≥ 当前所有 code 版本(即 ≥ `0.2.298`)。因为两者用同一公式 `0.2.{commitCount}`,而 commit 数单调递增 —— 新 installer 总是在更新的 commit 上构建,版本号自然更大。

版本号会从 `0.1.297` 跳到 `0.2.{当前commit数}`(约 0.2.300+),这是合并序列的必要跳号,已确认接受。

### 2. 版本比较逻辑(`currentGuiVersion`)

`currentCodeOrShellVersion()` 当前实现:

```ts
export function currentCodeOrShellVersion(): string {
  return getActiveCodePackageSync()?.version ?? app.getVersion()
}
```

**逻辑不变**,但语义统一:
- 有 active code 包 → 用 code 版本(`0.2.N`)
- 没有(纯 installer,未装过热更新)→ 用 installer 壳版本(`0.2.M`)
- 两者同序列,比较永远正确,不再有 0.1/0.2 混比。

### 3. 兼容性门控(`minShellVersion`)

**保留**,这是壳/code 物理分离唯一真正需要区分两层的逻辑:

- `app.getVersion()` = 壳版本(installer 编译进 app.asar 的 `0.2.M`)
- code 包 manifest 的 `minShellVersion` 声明它需要的最低壳版本
- `codeUpdateCompatibleWithShell` 继续用 `app.getVersion()` 比 `minShellVersion`,**逻辑不变**

作用:防止"新 code 包要求新壳,但用户壳太老"→ 此时正确提示用户装完整 installer(full update),而不是装一个跑不起来的 code 包。

### 4. "重启循环 / 还显示有更新"的消除

统一版本号后:

- code 检查:`isNewerVersion(线上code版本, 当前版本)` —— 同序列,正确,版本相等就不提示
- installer 检查(electron-updater 内部比 `latest.yml` 版本 vs `app.getVersion()`):两者同序列,**只有当 installer 版本 > 当前壳版本才提示**

装了最新 code(`0.2.298`)后,壳还是老的 `0.2.0`(本地构建)或上一次 installer 版本。线上 installer 若更新了 → 提示装 installer(合理,新壳);没更新 → 不提示。循环消除。

## 改动清单

| 文件 | 改动 |
|---|---|
| `package.json` | `version`: `0.1.0` → `0.2.0` |
| `.github/workflows/release-windows.yml` | 版本计算从 `$pkg.version.Split('.')`(`0.1.N`)改成 `0.2.N` 公式(和 code update 一致) |
| `src/main/code-update.ts` | `currentCodeOrShellVersion` 注释更新(说明统一序列);逻辑不变 |
| `src/main/gui-updater.ts` | `currentGuiVersion` / `checkCodePackageUpdate` 相关注释更新;逻辑不变 |

**核心:版本号比较逻辑几乎不用改代码**(已经是 `active.version ?? app.getVersion()`),主要改 CI 生成公式 + package.json 基准,让两个序列合并成一个。

## 用户机器状态清理(一次性,手动精确执行)

用户机器上累积的混乱状态需要在装新版 installer 后清理:

1. **`hot-code/downloads/`**:删除所有历史 code 包 zip(`0.1.184`、`0.2.292`、`0.2.296`、`0.2.298`),让下次更新干净下载。
2. **`hot-code/history.json`**:当前损坏(空/无效 JSON),删除让它重建。
3. **`gui-version-state.json`**:重置 —— 删掉错乱的 `pendingUpdate`(0.1.297)和 `lastSeenVersion`,让新版启动后重新记录。

清理时机:在装新版 installer 后、首次启动前执行,避免被运行中的进程锁文件。

## 验证

- typecheck 通过
- 更新相关测试套件通过(gui-updater / code-update / installer-nsh)
- 构建 NSIS 安装包成功
- 装新版后:版本号显示统一为 `0.2.x`,检查更新不再循环,后端正常起来

## 不在本次范围

- macOS / Linux 的版本号(本次只规范 Windows + code update 的 stable 通道)
- 撤包(forceRollback)机制本身(它在统一版本号下仍正常工作,无需改)
