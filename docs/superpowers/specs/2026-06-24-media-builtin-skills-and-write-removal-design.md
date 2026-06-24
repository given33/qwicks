# 内置媒体 Skill 化 + 彻底删除写作功能 — 设计文档

- 日期: 2026-06-24
- 范围: 两项独立但相邻的工作
  - **工作 A — 任务5**: 把 4 个生成类媒体工具做成内置 skill，整合语音输入配置，移除媒体专属设置 UI。
  - **工作 B**: 彻底删除写作功能代码（连同 Plan、SDD 一起删）。

---

## 一、背景与已确认决策

经探查，代码现状如下（关键事实）：

1. **4 个生成类媒体工具已经是模型工具**，存在于 QWicks 运行时：
   - `generate_image` (`qwicks/src/adapters/tool/image-gen-tool-provider.ts`)
   - `generate_speech` / `generate_music` / `generate_video` (`qwicks/src/adapters/tool/media-gen-tool-provider.ts`)
   - 它们由 `runtime-factory.ts:282-305` 装配，配置由 `qwicks-process.ts:513-516` 从 app-settings 桥接过来。
   - **所谓"skill 化"本质上是给已有工具包一层内置 skill，让模型在 skill 列表里看到它们并知道何时调用。**

2. **语音输入（speech-to-text / 麦克风按钮）结构上不同**：它是渲染进程的录音器 + 主进程 IPC 服务，不是模型能调用的工具。它不能按同样方式 skill 化。**决策：保留麦克风按钮**，配置并入统一卡片。

3. **Skill 系统完全是基于文件系统扫描的**（无内置注册机制）：
   - `SkillManifest` (zod schema) 位于 `qwicks/src/skills/skill-runtime.ts:17-27`，支持 `id/name/description/version/entry/triggers/allowedTools/assets/priority`。
   - 发现链：`guiSkillRootsForRuntime()` → `skillCapabilityConfigForRuntime()` → 写入 `<dataDir>/config.json` 的 `capabilities.skills.roots` → 运行时 `discoverSkills()` 扫描这些根目录里的 `skill.json` + `SKILL.md` 包。
   - 扫描根约定在 `src/shared/skill-dirs.ts`：项目级（`.agents/skills` 等）+ 全局级（`~/.qwicks/skills` 等）。

4. **写作功能代码量巨大且与 Plan/SDD 紧耦合**：约 50+ 文件，SDD 招牌功能依赖全部 11 个 write 编辑器模块，Plan 依赖其中 3 个。

### 已确认的用户决策

| 决策点 | 选择 |
|---|---|
| 写作功能依赖处理 | **连 Plan/SDD 一起删**（全部删除，最快最彻底） |
| 媒体配置归属 | 方案1：媒体做成 skill，保留**一个**精简的统一配置卡片 |
| 语音输入 | 保留麦克风按钮，配置并入统一卡片 |
| 内置 skill 实现机制 | **方案A：物化到磁盘**——启动时同步 4 个内置 skill 包到 `<userData>/builtin-skills/`，加入 skill 扫描根 |

---

## 二、工作 A：内置媒体 Skill 化

### A.1 架构总览

```
启动时
  └─ ensureBuiltinMediaSkills()   [新增, src/main/services/builtin-skills-service.ts]
       └─ 把 4 个 skill 包(skill.json+SKILL.md)从打包资源同步到 <userData>/builtin-skills/<skill-id>/
       └─ 幂等：比对 version，版本变了才覆盖

Skill 扫描根
  └─ skillCapabilityConfigForRuntime() 增加内置根 <userData>/builtin-skills
  └─ 该根不可在 UI 中被用户禁用（always-on，类似 Codex 插件缓存根）

Skill 包内容（物化到磁盘）
  builtin-skills/
    qwicks-image-generation/
      skill.json   # name, triggers(promptPatterns), allowedTools:[generate_image]
      SKILL.md     # 告诉模型何时调用 generate_image，参数说明
    qwicks-text-to-speech/
      skill.json   # allowedTools:[generate_speech]
      SKILL.md
    qwicks-music-generation/
      skill.json   # allowedTools:[generate_music]
      SKILL.md
    qwicks-video-generation/
      skill.json   # allowedTools:[generate_video]
      SKILL.md
```

**关键点**：内置 skill 只是「指引模型调用已存在的工具」的说明书，不包含任何生成逻辑。生成逻辑仍在原有的 tool provider 里。skill 让这 4 个工具在 skill 列表里可见、可被模型按需激活。

### A.2 内置 Skill 包设计

每个 skill 包含 `skill.json`（manifest）+ `SKILL.md`（说明）。

#### skill.json 通用结构（以图片生成为例）
```json
{
  "id": "qwicks-image-generation",
  "name": "图像生成",
  "description": "根据文本描述生成图片，支持文生图与图生图（参考图）。",
  "version": "1.0.0",
  "entry": "SKILL.md",
  "triggers": {
    "commands": ["/image"],
    "promptPatterns": ["生成图|画一|画个|画张|插图|图片|配图|生成图片|文生图|图生图"]
  },
  "allowedTools": ["generate_image"],
  "priority": 100
}
```

#### 4 个 skill 的 allowedTools / 触发词
| Skill id | allowedTools | 触发 promptPattern（中文） | slash 命令 |
|---|---|---|---|
| qwicks-image-generation | generate_image | 生成图\|画一\|画个\|画张\|插图\|配图\|文生图\|图生图 | /image |
| qwicks-text-to-speech | generate_speech | 朗读\|配音\|说一段\|语音合成\|文字转语音\|念\|TTS | /tts |
| qwicks-music-generation | generate_music | 作曲\|写歌\|配乐\|生成音乐\|背景音乐\|BGM\|纯音乐 | /music |
| qwicks-video-generation | generate_video | 生成视频\|做视频\|短视频\|视频片段\|文生视频 | /video |

#### SKILL.md 内容规范（每个 skill 一份）
结构统一：
1. **何时使用**（用户意图识别）
2. **如何调用工具**（参数说明 + 示例）
3. **参数详解**（每个 input 字段的含义、类型、约束）
4. **输出处理**（生成的文件路径、如何在回复中引用）
5. **失败处理**（工具返回错误时的建议）

### A.3 统一媒体配置卡片（替换 4 个独立设置面板）

#### 移除的设置 UI
- `settings-section-image-generation.tsx`（整文件删）
- `settings-section-media-generation.tsx`（整文件删）
- `settings-section-speech-to-text.tsx`（整文件删）
- `SettingsView.tsx` 中的 `mediaGeneration` / `speechToText` / `imageGeneration` 分类路由分支
- `SettingsSidebar.tsx` 中的 `mediaGeneration` / `speechToText` 按钮
- `use-settings-gui-update.ts` 中的对应分类

#### 新增的统一卡片
新文件 `settings-section-media.tsx`，渲染**一个**卡片「媒体能力」，内含 5 个可折叠子区块（图片 / 语音合成 / 音乐 / 视频 / 语音输入），每个子区块保留原有的配置字段（enabled / providerId / protocol / baseUrl / apiKey / model / 各自特有字段）。

**配置数据流不变**：仍读 `ctx.qwicks.imageGeneration` / `textToSpeech` / `musicGeneration` / `videoGeneration` / `speechToText`，仍写 `updateQWicks({...})`。只是 UI 从 4 个分散面板合并成 1 个卡片。

在 `SettingsSidebar.tsx` 增加 `media` 分类按钮（图标用媒体/调色板），`SettingsView.tsx` 路由到新卡片。同时移除 `mediaGeneration`/`speechToText`/`imageGeneration` 三个旧分类。

### A.4 Skill 设置 UI 适配

内置 skill 会在 skill 列表里显示。需要让 UI 区分「内置 skill」与「用户/插件 skill」：

- `GuiSkillSummary` 增加 `builtin?: boolean` 字段（基于 root 是否为 `<userData>/builtin-skills` 判定）。
- skill 列表 UI（`settings-section-agents.tsx`）给内置 skill 加一个「内置」标签，且**不显示禁用开关**（内置 skill 始终启用，但其底层工具的 `enabled` 由统一媒体卡片控制）。
- 内置 skill 根不进入 `listGuiSkillRoots()` 的可切换列表（与 Codex 插件缓存根同等对待）。

### A.5 语音输入整合（保留功能，并入卡片）

- `use-voice-dictation.ts`、`FloatingComposer.tsx` 麦克风按钮（2251-2274）、`speech:transcribe` IPC、`speech-to-text-service.ts` —— **全部保留，不动逻辑**。
- 唯一变化：speech-to-text 的配置 UI 从独立面板移到统一媒体卡片的「语音输入」子区块。

### A.6 启动同步逻辑（ensureBuiltinMediaSkills）

新文件 `src/main/services/builtin-skills-service.ts`：
```ts
export async function ensureBuiltinMediaSkills(userDataDir: string): Promise<void>
```
- 源：打包资源 `resources/builtin-skills/`（electron-builder 配置 `extraResources` 或 `asarUnpack`）。
- 目标：`<userData>/builtin-skills/<skill-id>/`。
- 逻辑：遍历 4 个 skill id；若目标不存在或其 `skill.json.version` < 打包版本，则整目录覆盖；否则跳过。失败只记日志、不阻塞启动。
- 在 `app-main.ts` / `index.ts` 的启动序列里、QWicks 进程启动**之前**调用（因为运行时要读这些根）。

### A.7 Skill 根注入

`skillCapabilityConfigForRuntime()`（`qwicks-process.ts:582`）修改：
- 在现有 roots 列表末尾追加 `<userData>/builtin-skills`（始终加入，不受 `disabledDirs` 影响，类似 pluginRoots 的处理）。
- 该根的 skill 即使媒体卡片里某工具 disabled，也仍会被发现（无害——`allowedTools` 指向的工具若不可用，运行时自然调用失败，模型会收到错误并告知用户去配置）。

### A.8 数据迁移 / 向后兼容

- 旧的 `imageGeneration` / `textToSpeech` / `musicGeneration` / `videoGeneration` / `speechToText` 设置字段**全部保留**（app-settings-types.ts 不动）——它们仍是配置数据源，只是 UI 入口变了。
- 用户已有配置无缝迁移到新卡片，零数据丢失。

---

## 三、工作 B：彻底删除写作功能（含 Plan/SDD）

### B.1 删除范围

按删除顺序（保证每步编译可通过）：

#### 第 1 步：移除入口与路由
- `chat-store-types.ts`：`AppRoute` 删 `'write'`；`SettingsRouteSection` 删 `'write'`；`ChatState` 删 `openWrite`/`ensureWriteThreadForWorkspace`/`createWriteThread`/`selectWriteThread`。
- `Workbench.tsx`：删除 write 路由分支、WriteSidebar/WriteAssistantPanel/WriteWorkspaceView 渲染、openWrite 等 store selector、`route === 'write'` 分支（2518-2532）、write-runtime-banner。
- `Sidebar.tsx`：删 onWriteOpen 传递、Plan 入口（plan 按钮区）、SDD「新建需求」按钮（169-173）。

#### 第 2 步：删除 store actions
- `chat-store-navigation-actions.ts`：删 `openWrite`/`ensureWriteThreadForWorkspace`/`createWriteThread`/`selectWriteThread` 实现（148-282）。
- `chat-store-app-actions.ts`：删 `'openWrite'`（41, 166-167）。
- `chat-store-thread-actions.ts`：删 write route 分支（581-583）。
- `chat-store-runtime.ts`：删 `WriteThreadRegistry`/`isWriteThreadId`/`resolveWriteToolFilePath`/`notifyWriteWorkspaceFileRefresh`（390-443）及相关 import。
- `chat-store-maintenance-actions.ts`：删 `forgetWriteThread`。

#### 第 3 步：删除 IPC 与主进程服务
- `register-app-ipc-handlers.ts`：删所有 `write:*` handler（1167-1221）、`speech:transcribe` 之外的媒体无关项保留。
- `app-ipc-schemas.ts`：删 `writeInlineCompletionPatchSchema` 等所有 write schema（470-523, 1434-1565）。
- `preload/index.ts`：删所有 `write:*` 桥（165-184）。
- `qwicks-gui-api.ts`：删 `requestWriteInlineCompletion` 等接口成员（405-432）、类型 import（63-90）。
- 删除主进程服务文件：`write-infographic-service.ts`(+test)、`write-inline-completion-service.ts`(+test)、`write-retrieval-service.ts`(+test)、`write-export-service.ts`(+test)、`write-pdf-text-service.ts`(+test)。
- 删除 Plan 运行时工具与 SDD 运行时工具（在 qwicks 内，需探查具体位置）。

#### 第 4 步：删除共享契约与类型
- 删 `src/shared/write-infographic.ts`、`write-inline-completion.ts`、`write-inline-edit.ts`、`write-export.ts`、`write-retrieval.ts`、`write-prototype.ts`(+test)、`write-markdown-resource.ts`、`write-text-file.ts`(+test)、`sdd.ts`、`sdd-trace.ts`、`app-settings-write.ts`(+test)。
- `app-settings-types.ts`：删 `Write*SettingsV1` 全部类型（1384-1526）、`AppSettingsV1.write` 字段（1592）、patch 中的 `write?`（1612）、`DEFAULT_WRITE_WORKSPACE_ROOT`（65）。
- `app-settings-normalize.ts`：删 `normalizeWriteSettings` import 与调用。
- 删 `src/shared/speech-to-text.ts`？**否**——语音输入保留，此文件留。

#### 第 5 步：删除渲染层组件与库
- 整目录删：`src/renderer/src/write/`（含 `inline-completion/`、`tiptap/`）。
- 整目录删：`src/renderer/src/components/write/`。
- 整目录删：`src/renderer/src/components/plan/`。
- 整目录删：`src/renderer/src/components/sdd/`。
- 整目录删：`src/renderer/src/plan/`（plan store/prompts/todo-sync/tool/command）。
- 整目录删：`src/renderer/src/sdd/`（sdd store/frameworks 等）。
- 删 `settings-section-write.tsx`(+test)、`settings-debug-log.tsx`、`write-runtime-banner.ts`(+test)。
- 删 `src/renderer/src/styles/write-editor.css`（并在 `main.tsx:11` 移除 import）。
- 删 `src/renderer/src/lib/apply-theme.ts` 中的 `applyWriteTypography`。
- `Workbench.tsx`：删所有 Plan/SDD 相关懒加载 import、handlers、effect（约 700 行 SDD 接线 + plan controller 接线）。
- `WorkbenchTopBar.tsx`：删 plan 按钮、`rightPanelMode` 中的 `'plan'`/`'sdd-ai'`。
- `Workbench` 的 `rightPanelMode`：仅保留 `'chat'`（或重构为无需 plan/sdd）。

#### 第 6 步：清理 i18n
- `locales/en|zh/settings.json`：删 `write`、`sectionWrite`、`writeInlineCompletion*`、`writeSelectionAssist*`、`writeInfographic*`、`writeQuickAction*`、`writeWorkspaceRoot*`、`writeTypography*`、`writeFont*`、`writeAgentPresets*`、`writeDebugLog*` 等全部 write 键。
- `locales/en|zh/common.json`：删 `write`、`writeStudio`、`writeSpaces`、`writeWorkspace*`、`writeCreate*`、`writeMode*`、`writeToggleAssistant`、`writeFontSize*`、`writeImage*`、`writePdf*`、`writeExport`、`writeCopyRichText*` 等全部 write 键（grep `^\s*"write` 全量清理）。
- 同步删除 Plan/SDD 相关 i18n 键（`plan*`、`sdd*`、`newRequirement*`、`requirementAi*` 等，需 grep 确认）。

#### 第 7 步：测试更新
- 删所有 write/plan/sdd 相关测试文件。
- 更新用到 `defaultWriteSettings` 的测试 fixture（`qwicks-runtime.test.ts`、`runtime-client.test.ts`、`app-settings.test.ts`）——从 `AppSettingsV1` 构造里移除 `write` 字段。
- 更新 spotlight 计数测试（侧边栏项变化）。

### B.2 不删除的（容易误删的通用项）
- `file:write-workspace` IPC + `writeWorkspaceFile`（通用文件保存）。
- `qwicks:config:write`（配置文件写入）。
- `terminal:write`。
- `workspace-write` sandbox 枚举。
- `writeBrowserStorageItem`（通用 localStorage helper）。
- qwicks 内 `'write'`/`'write_file'` 内置工具名（文件写入工具）。
- `speech-to-text.ts`、`speech-to-text-service.ts`、`use-voice-dictation.ts`（语音输入保留）。
- `prototype-embed-registry.ts`——若仅 SDD 用且 SDD 删除后无人引用，则一并删；需探查确认。

---

## 四、实施顺序（两工作合并）

为降低风险，**先做工作 B（删写作）再做工作 A（媒体 skill 化）**，因为删写作会大改 Workbench/Settings/Sidebar，媒体改动也在这些文件，先稳定基础再叠加。

1. **工作 B-1~B-7**：删除写作/Plan/SDD，每步 typecheck + test，逐步提交。
2. **工作 A-1**：新增 4 个内置 skill 包资源（`resources/builtin-skills/`）。
3. **工作 A-2**：新增 `builtin-skills-service.ts` + 启动同步。
4. **工作 A-3**：`skillCapabilityConfigForRuntime` 注入内置根。
5. **工作 A-4**：新增统一媒体配置卡片 `settings-section-media.tsx`。
6. **工作 A-5**：移除旧媒体设置面板与分类。
7. **工作 A-6**：skill UI 适配内置标签。
8. **工作 A-7**：i18n 补充（媒体卡片新文案 + skill 触发词）。
9. 全量 typecheck + test + 启动验证。

---

## 五、测试策略

- **单元测试**：
  - `ensureBuiltinMediaSkills`：版本比对、覆盖、幂等。
  - `skillCapabilityConfigForRuntime`：内置根被加入且不受 disabledDirs 影响。
  - 删除后 `AppSettingsV1` 不再含 `write`，normalize 不报错。
- **集成/快照**：
  - 设置面板分类数变化后的 spotlight 计数。
  - skill 列表显示 4 个内置 skill。
- **手动验证**：
  - 启动后 `<userData>/builtin-skills/` 出现 4 个目录。
  - skill 设置页显示 4 个内置 skill 且带「内置」标签、无禁用开关。
  - 统一媒体卡片 5 个子区块可独立配置。
  - 麦克风按钮正常工作。
  - 写作功能、Plan、SDD 完全消失（无入口、无残留报错）。
  - typecheck 通过；`npm run test:ci` 通过。

---

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| 删写作牵连面大，遗漏引用导致编译失败 | 分 7 步，每步 typecheck；用 explore agent 全量 grep 复核 |
| Plan/SDD 在 qwicks 运行时也有工具注册 | 第 3 步探查 qwicks 内 plan/sdd 工具并一并移除 |
| 内置 skill 同步失败导致媒体不可用 | 同步失败只记日志不阻塞；工具 provider 仍独立工作（skill 只是说明书） |
| 用户已有 write 设置残留 | 字段直接删，无迁移负担（write 是本地编辑器，无云端数据） |
| i18n 键遗漏导致界面英文 key 泄漏 | 每个 locale 文件 grep `write`/`plan`/`sdd` 全量清理 |

---

## 七、已探查确认的具体落点（实现时遵循）

1. **qwicks 运行时 Plan 工具**：`qwicks/src/adapters/tool/create-plan-tool.ts` 存在；`onPlanWritten` 回调在 `runtime-factory.ts:577`。删除时移除该工具文件、注册点、回调、以及 `gui-plan.ts` / `ports/tool-host.ts` / `contracts/turns.ts` / `loop/agent-loop.ts` 中对 plan 的引用。SDD 在 qwicks 内**无独立工具**（SDD 是纯渲染层 + 共享文件约定），故无需在 qwicks 删 sdd 工具。

2. **`prototype-embed-registry.ts`**：删除 SDD 后引用方仅剩 `app-main.ts:324` 的 webContents 安全守卫 `isAuthorizedPrototypeFileUrl(src)`。该守卫的作用是放行 SDD 原型 HTML 的 file:// URL。SDD 删除后不再有授权原型文件，守卫退化为「永不放行 file://」——这与 `isAllowedDevPreviewUrl` 单独工作时等价（dev preview 仍放行）。**决策：整文件删除 `prototype-embed-registry.ts`，移除 `app-main.ts:45` import 与 `:324` 调用、`index.ts:46` import、`register-app-ipc-handlers.ts:162` import + `write:authorize-prototype`/`write:open-prototype` handler（1203-1208）。**

3. **`RightPanelMode`** 完整取值（`WorkbenchTopBar.tsx:25-32`）：`'todo' | 'changes' | 'browser' | 'file' | 'plan' | 'sdd-ai' | null`。删除后缩减为 `'todo' | 'changes' | 'browser' | 'file' | null`。同时移除 `planPanelEnabled` prop（`:37,:53,:75`）与 items 数组中的 plan 项（`:75`）。

4. **内置 skill 打包**：用 electron-builder `extraResources` 把 `resources/builtin-skills/` 复制到 `<appRoot>/resources/builtin-skills/`，运行时从 `process.resourcesPath`（生产）或源码相对路径（开发）读取。比 `asarUnpack` 更简单，因为 skill 包是纯静态 markdown/json。
