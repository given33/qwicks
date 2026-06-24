# 热更新撤包操作手册（发布者用）

> 当一个已发布的热更新（code update）出现问题，发布者可通过本流程撤回——客户端会自动回退到指定旧版本，用户无感知、无选择权。

## 适用范围
- **仅热更新（code update）**：即只替换 renderer/preload/qwicks 代码的轻量更新。
- 安装器更新（.exe 全量）的回退需手动重装旧版安装器，不在本流程内。

## 前置条件
- 服务器 `8.138.40.16`，更新文件根目录 `/www/wwwroot/update/qwicks/`（nginx 静态服务）。
- 你有服务器的 SSH/SCP 访问权限。
- 旧版本的 `code.zip` 仍在服务器或本地有备份（CI 每次发布会覆盖，**请平时保留旧包备份**）。

## 撤包步骤

### 1. 准备旧版 code.zip
确认要回退到的旧版本 `code.zip`（含正确 sha256）。若服务器上的已被覆盖，从本地备份重新上传：
```bash
scp /path/to/old-code.zip user@8.138.40.16:/www/wwwroot/update/qwicks/channels/stable/latest/code/code.zip
```

### 2. 编辑 code-latest.json，加 forceRollback 标志
SSH 到服务器，编辑 `channels/stable/latest/code/code-latest.json`：
```json
{
  "kind": "code",
  "version": "0.2.42",
  "package": {
    "name": "code.zip",
    "url": "code.zip",
    "sha256": "<旧版 code.zip 的 sha256，必须与实际文件一致>"
  },
  "forceRollback": true,
  "rollbackFromVersion": "0.2.50",
  "releaseNotes": "紧急撤包：回退到稳定版本 0.2.42。"
}
```
关键字段：
- `version`：要回退到的旧版本号（**低于**当前客户端版本）。
- `package.sha256`：**必须**与旧 code.zip 实际 sha256 一致（客户端会校验，不符则拒绝安装）。
- `forceRollback: true`：让客户端跳过版本比较，即便旧版本号更低也强制安装。
- `rollbackFromVersion`：记录从哪个版本回退（仅供日志/历史，客户端不强校验）。

### 3. 等待客户端自动回退
客户端在下次检查更新时（启动时 + 定时检查）会：
1. 拉取 code-latest.json，检测到 `forceRollback:true`。
2. 即便版本更低也判定为「需要安装」。
3. 下载 → SHA256 校验 → 安装（旧版本写入 active.json，被替换的当前版本记入 history.json）。
4. relaunch，用户无感回到旧版本。

**用户全程无弹窗、无询问**（符合「发布者控制、用户无选择权」）。

### 4. （修复后）撤销 forceRollback，让客户端自动升回新版
修好新版后，发布新版热更新，编辑 code-latest.json **去掉** `forceRollback`（或设为 false），指向新版：
```json
{
  "kind": "code",
  "version": "0.2.51",
  "package": { "name": "code.zip", "url": "code.zip", "sha256": "<新版 sha256>" },
  "releaseNotes": "修复了 XX 问题。"
}
```
客户端下次检查会看到新版（0.2.51 > 当前 0.2.42）→ 正常升级。**自动闭环**。

## 注意事项
- `sha256` 必须准确：客户端用 `code-latest.json` 里的 sha256 校验下载的 zip，不符直接拒绝（安全机制，防止包损坏/篡改）。
- 回退包的 `minShellVersion`（若有）不能超过客户端当前 shell 版本，否则兼容性门控会拒绝。
- 客户端本地保留最近 10 个热更新版本的历史（`hot-code/history.json`），作为回切点索引；超过自动清理最旧的。
- `forceRollback` 只影响「是否安装」的判定，不绕过 SHA256 校验和兼容性门控——攻击面等同正常更新。

## 快速对照
| 操作 | code-latest.json 改动 | 客户端行为 |
|---|---|---|
| 正常发布新版 | version 升高，无 forceRollback | 检测到新版 → 升级 |
| 撤包（回退旧版） | version 降低 + forceRollback:true | 强制安装旧版 → 回退 |
| 修好后恢复 | version 升高，去掉 forceRollback | 检测到新版 → 自动升回 |
