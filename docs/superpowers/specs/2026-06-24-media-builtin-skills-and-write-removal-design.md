# 内置媒体 Skill 化 + 删除 Write 工作区外壳 — 设计文档

- 日期: 2026-06-24
- 范围: 两项独立但相邻的工作
  - **工作 A — 任务5**: 把 4 个生成类媒体工具做成内置 skill，整合语音输入配置，移除媒体专属设置 UI。
  - **工作 B**: 删除 Write **工作区外壳**（保留 Plan、SDD 和共享 write 编辑器库）。

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

4. **Write 功能分层**：Write 工作区外壳（侧边栏/工作区视图/助手面板等独立 route）与 write 编辑器库是两层。编辑器库被 **Plan**（依赖 WriteMarkdownEditor/WriteRichEditor/store 3 个）和 **SDD**（依赖全部 11 个）深度共享。

### 已确认的用户决策（最终）

| 决策点 | 选择 |
|---|---|
| **Write 功能处理** | **只删 Write 工作区外壳，保留 Plan + SDD + 共享 write 编辑器库** |
| 媒体配置归属 | 方案1：媒体做成 skill，保留**一个**统一媒体卡片（5 子区块全字段保留） |
| 语音输入 | 保留麦克风按钮，配置并入统一卡片 |
| 内置 skill 实现机制 | **方案A：物化到磁盘**——启动时同步 4 个内置 skill 包到 `<userData>/builtin-skills/`，加入 skill 扫描根 |

> **决策演进**：最初考虑「连 Plan/SDD 一起删」，但摸清 Plan/SDD 与 write 编辑器库紧耦合（SDD 是 write 编辑器的二次封装），全删会损失两个核心功能（合计约 5500 行）。最终决定缩小到只删 Write 工作区外壳——这正是用户唯一要下架的「写作模式」入口。

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
新文件 `settings-section-media.tsx`，渲染**一个**卡片「媒体能力」，内含 5 个可折叠子区块（图片 / 语音合成 / 音乐 / 视频 / 语音输入），每个子区块**保留全部原有配置字段**（enabled / providerId / protocol / baseUrl / apiKey / model / 各自特有字段如 voice/format/defaultSize/defaultResolution 等）。

**配置数据流不变**：仍读 `ctx.qwicks.imageGeneration` / `textToSpeech` / `musicGeneration` / `videoGeneration` / `speechToText`，仍写 `updateQWicks({...})`。只是 UI 从 4 个分散面板合并成 1 个卡片。

在 `SettingsSidebar.tsx` 增加 `media` 分类按钮（图标用媒体/调色板），`SettingsView.tsx` 路由到新卡片。同时移除 `mediaGeneration`/`speechToText`/`imageGeneration` 三个旧分类。3 处 `SettingsCategory` 类型定义同步更新。

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
- 源：打包资源 `<resourcesPath>/builtin-skills/`（生产）或源码相对路径（开发）。
- 目标：`<userData>/builtin-skills/<skill-id>/`。
- 逻辑：遍历 4 个 skill id；若目标不存在或其 `skill.json.version` < 打包版本，则整目录覆盖；否则跳过。失败只记日志、不阻塞启动。
- 在 `app-main.ts` / `index.ts` 的启动序列里、QWicks 进程启动**之前**调用（因为运行时要读这些根）。
- 打包方式：electron-builder `extraResources` 把 `resources/builtin-skills/` 复制到 `<appRoot>/resources/builtin-skills/`。比 `asarUnpack` 更简单，skill 包是纯静态 markdown/json。

### A.7 Skill 根注入

`skillCapabilityConfigForRuntime()`（`qwicks-process.ts:582`）修改：
- 在现有 roots 列表末尾追加 `<userData>/builtin-skills`（始终加入，不受 `disabledDirs` 影响，类似 pluginRoots 的处理）。
- 该根的 skill 即使媒体卡片里某工具 disabled，也仍会被发现（无害——`allowedTools` 指向的工具若不可用，运行时自然调用失败，模型会收到错误并告知用户去配置）。

### A.8 数据迁移 / 向后兼容

- 旧的 `imageGeneration` / `textToSpeech` / `musicGeneration` / `videoGeneration` / `speechToText` 设置字段**全部保留**（app-settings-types.ts 不动）——它们仍是配置数据源，只是 UI 入口变了。
- 用户已有配置无缝迁移到新卡片，零数据丢失。

---

## 三、工作 B：删除 Write 工作区外壳（保留 Plan/SDD）

### B.0 核心原则

**只删 Write 工作区外壳**（独立 write route + 文件树 + 工作区视图 + 助手面板 + 横幅 + 专属导出/检索服务），**保留**：
- 整个 write 编辑器库（`src/renderer/src/write/` 除 `write-render-safety.ts` 外全部）——Plan/SDD 共享
- Plan 面板 + SDD 编辑器 —— 核心功能
- `WriteMarkdownEditor` / `WriteRichEditor` / `WriteInlineAgent` / `write-workspace-store` / `WriteMarkdownPreview` 等 —— 被 Plan/SDD 引用
- `settings-section-write.tsx` —— 编辑器设置页（不是工作区外壳）
- `write:inline-completion` / `write:generate-infographic` / `write:authorize-prototype` / `write:open-prototype` / `write:inline-completion-debug:*` IPC —— SDD 编辑器调用
- `write-infographic-service.ts` / `write-inline-completion-service.ts` / `prototype-embed-registry.ts` —— SDD 需要

### B.1 删除清单（精确）

#### 删除的渲染组件（13 个文件）
| 文件 | 删除理由 |
|---|---|
| `components/write/WriteSidebar.tsx` | 仅 Workbench write route 引用 |
| `components/write/WriteWorkspaceView.tsx` | 仅 Workbench write route 引用 |
| `components/write/WriteAssistantPanel.tsx` | 仅 Workbench write route 引用 |
| `components/write/WriteFileTree.tsx` | 仅 WriteSidebar 引用 |
| `components/write/WriteWorkspaceToolbar.tsx` | 仅 WriteWorkspaceView 引用 |
| `components/write/WriteWorkspaceStart.tsx` | 仅 WriteWorkspaceDocumentPane 引用 |
| `components/write/WriteWorkspaceEmptyState.tsx` | 仅 WriteWorkspaceView 引用 |
| `components/write/WriteWorkspaceDocumentPane.tsx` | 仅 WriteWorkspaceView 引用 |
| `components/write/WriteImagePreview.tsx` | 仅 WriteWorkspaceDocumentPane 引用 |
| `components/write/WritePdfViewer.tsx` | 仅 WriteWorkspaceDocumentPane 引用 |
| `components/write/WriteFontSizeControl.tsx` | 仅 WriteWorkspaceToolbar 引用 |
| `components/write/WriteMarkdownPreview.tsx` | 仅 WriteWorkspaceDocumentPane + 测试引用（测试要同步处理） |
| `components/write/use-write-split-scroll-sync.ts` | 仅 WriteWorkspaceView 引用 |

> **注意**：`WriteInlineAgent.tsx` 和 `write-workspace-view-utils.ts` 被 SDD 引用，**保留**。

#### 删除的渲染库（2 个文件）
- `src/renderer/src/write/write-render-safety.ts`(+test) —— 仅 WriteWorkspaceView/DocumentPane 引用

#### 删除的运行时横幅（2 个文件）
- `src/renderer/src/lib/write-runtime-banner.ts`(+test) —— 仅 Workbench write route 引用

#### 删除的主进程服务（3 个 + 各自 test）
- `src/main/services/write-export-service.ts` —— 仅 WriteWorkspaceView 引用
- `src/main/services/write-retrieval-service.ts` —— 仅 Workbench sendWritePrompt 引用
- `src/main/services/write-pdf-text-service.ts` —— 仅 write-retrieval-service 引用（删除后成孤儿）

#### 删除的共享契约（1 个）
- `src/shared/write-export.ts` —— 删除前先移除 3 处 `WriteExportFormat` 未用 import（write-workspace-view-utils/WriteWorkspaceToolbar/WriteWorkspaceView）

#### 删除的 IPC（3 个 handler + preload + schema + api member）
- `write:export` / `write:copy-rich-text` —— 仅 WriteWorkspaceView 调用
- `write:retrieve-context` —— 仅 Workbench sendWritePrompt 调用
- 对应 preload 桥（`src/preload/index.ts:165-172`）、`app-ipc-schemas.ts` 中 `writeExportPayloadSchema`/`writeRichClipboardPayloadSchema`/`writeRetrievalPayloadSchema`、`qwicks-gui-api.ts` 中 `exportWriteDocument`/`copyWriteDocumentAsRichText`/`retrieveWriteContext` 成员及类型 import

### B.2 修改的文件（store actions + route）

#### 类型
- `chat-store-types.ts`：`AppRoute` 删 `'write'`；`SettingsRouteSection` 删 `'write'`；`ChatState` 删 `openWrite`/`ensureWriteThreadForWorkspace`/`createWriteThread`/`selectWriteThread`（231-235）

#### Store actions
- `chat-store-navigation-actions.ts`：删 `openWrite`/`ensureWriteThreadForWorkspace`/`createWriteThread`/`selectWriteThread` 实现（148-282）、`wasWriteRoute` 分支（504-506）、write-thread-registry import（60）
- `chat-store-app-actions.ts`：删 `'openWrite'`（41, 166-167）
- `chat-store-thread-actions.ts`：删 `route==='write'` 分支（581-584）

#### Workbench.tsx（行级精确）
**删除 import**：`:56` WriteWorkspaceView、`:57` WriteAssistantPanel、`:58` WriteSidebar、`:111` write-runtime-banner、`:23` WriteRetrievalContext、`:62` composeWritePrompt、`:63` resolveWriteAgentPreset
**保留 import**（SDD 用）：`:64` useWriteWorkspaceStore、`:65` isWriteThreadId、`:74` PENDING_INFOGRAPHIC_PROTOCOL
**删除 selectors**：`:356-358` openWrite/ensureWriteThreadForWorkspace/createWriteThread、`:416-418` 对应 selector
**保留 state**（SDD 助手面板用）：`:479-512` writeAssistantOpen/writeAssistantModel 等
**删除函数**：`sendWritePrompt`(1173-1239)、`openWriteMode`(2121-2124)、`startNewWriteAssistantConversation`(2168-2174)、`pickWriteAssistantWorkspace`(2176-2193)、`writeRuntimeBannerMessage`(2216-2220)
**修改分支**：sidebarView(2147-2156) 删 write arm；closeRightPanel(2158-2166) 删 write 块；selectedComposerModel(960-969) 删 `route==='write' ||`；activeComposerWorkspace(1009-1010) 删 write 分支；handleSendAsync(1901) 改为仅 chat；handleSendAsync(1976-1979) 删 write 分支
**删除 render JSX**：右面板 write 分支(2250-2287，保留 sdd-ai 分支)、侧边栏 write 分支(2434-2442 收缩为 Sidebar)、主区 write route(2518-2532)

#### write-thread-registry（可选深度清理）
`write-thread-registry.ts`（`isWriteThreadId`/`WriteThreadRegistry` 等）是 Write 线程持久化机制，**无** Plan/SDD 依赖，可整文件删除——但牵涉 5 个 store 文件 + Workbench + 3 个测试的 mock。作为可选深度清理项；若要最小改动可只删 4 个 actions + route 分支，保留 registry（不影响功能，只是留少量死代码）。**本次执行：完整删除 registry，保证干净。**

涉及：`chat-store-runtime.ts:29-31,390-443,741,1199`、`chat-store-maintenance-actions.ts:76-85,634`、`chat-store-navigation-actions.ts:51-60`、`chat-store-thread-actions.ts:65-74`、`chat-store.ts:71-80`、`Workbench.tsx:65,847`、测试 `chat-store-navigation-actions.test.ts:73`/`chat-store-side-actions.test.ts:156-160`/`chat-store-thread-actions.test.ts:232`

### B.3 i18n 清理（仅工作区相关键）

删除 `locales/{en,zh}/common.json` 中**仅工作区使用**的键：
- `writeWorkspace*`、`writeMode*`、`writeToggleAssistant`、`writeFontSize*`、`writeImage*`、`writePdf*`、`writeExport*`、`writeCopyRichText*`、`writeCreate*`、`writeSpaces`、`writeStudio`、`writeModeRich`、`writeUnsupportedFileType`、`writeLargeFile*`、`writeSaveFile`、`writeNoFileOpen`、`writeChooseFile*`、`writeEmpty*`、`writeStart*`、`writeUntitledDraft` 等

删除 `locales/{en,zh}/settings.json` 中**仅工作区使用**的键：
- `writeWorkspaceRoot*` 等

**保留**编辑器/设置相关键（settings-section-write.tsx 仍用）：`writeInlineCompletion*`、`writeSelectionAssist*`、`writeInfographic*`、`writeQuickAction*`、`writeTypography*`、`writeFont*`、`writeAgentPresets*`、`writeDebugLog*`、`sectionWrite`、`write`(设置导航标签)

### B.4 不删除的（关键保留项，避免误删）
- `WriteInlineAgent.tsx`（SDD）、`write-workspace-view-utils.ts`（SDD）、`WriteMarkdownEditor.tsx`（Plan/SDD）、`WriteRichEditor`、`WriteMarkdownPreview` 的依赖
- `inline-edit.ts`、`write-file-watch.ts`、`quick-actions.ts`、`infographic-pending.ts`、`agent-presets.ts`（SDD + 编辑器设置）
- `write-infographic-service.ts`、`write-inline-completion-service.ts`、`prototype-embed-registry.ts`
- `write:inline-completion`/`write:generate-infographic`/`write:authorize-prototype`/`write:open-prototype`/`write:inline-completion-debug:*` IPC
- `write-workspace-store` 全家（共享编辑器 store）
- `quoted-selection.ts`、`selected-image.ts`、`recent-edits.ts` 等（共享编辑器/chat 库）
- `settings-section-write.tsx`（编辑器设置页）
- 通用项：`file:write-workspace`、`qwicks:config:write`、`terminal:write`、`writeBrowserStorageItem`、qwicks 内 `'write'` 文件写入工具、语音输入相关文件
- Plan 面板 + SDD 编辑器 + 所有 plan/sdd 目录代码

### B.5 测试同步
- 删除被删组件/服务/lib 的对应 test
- 处理 `quoted-selection.test.ts:10,12` 对 `WriteMarkdownPreview` 的 import（测试文件保留，移除该 import 或改 stub）
- 更新 store 测试中 openWrite 等 mock
- 更新 spotlight 计数测试（侧边栏 write 入口消失）

---

## 四、实施顺序（两工作合并，先 B 后 A）

先做工作 B（删 Write 外壳）再做工作 A（媒体 skill 化），因为两者都改 Workbench/Settings/Sidebar，先稳定基础。

### 工作 B（删 Write 外壳）
1. **B-1**：删 13 个外壳组件 + `write-render-safety` + `write-runtime-banner`
2. **B-2**：删 Workbench 中 write route 全部接线（import/selector/函数/分支/render）
3. **B-3**：删 store actions + route 类型 + write-thread-registry（含相关 store 文件清理 + 测试）
4. **B-4**：删 3 个主进程服务 + 3 个 IPC handler + preload + schema + api member + `write-export.ts`
5. **B-5**：处理 `quoted-selection.test.ts` import + 更新各 mock 测试 + spotlight 计数
6. **B-6**：清理 i18n 工作区键
7. **B-7**：typecheck + test，提交

### 工作 A（媒体 skill 化）
1. **A-1**：新增 4 个内置 skill 包资源（`resources/builtin-skills/`）
2. **A-2**：新增 `builtin-skills-service.ts` + 启动同步（app-main/index）
3. **A-3**：electron-builder `extraResources` 配置打包
4. **A-4**：`skillCapabilityConfigForRuntime` 注入内置根
5. **A-5**：新增统一媒体配置卡片 `settings-section-media.tsx`（5 子区块全字段）
6. **A-6**：移除旧媒体设置面板 + 分类（3 处 SettingsCategory 同步）
7. **A-7**：skill UI 适配内置标签（`GuiSkillSummary.builtin` + 列表渲染）
8. **A-8**：i18n 补充（媒体卡片文案 + skill 触发词）
9. **A-9**：typecheck + test，提交

---

## 五、测试策略

- **单元测试**：
  - `ensureBuiltinMediaSkills`：版本比对、覆盖、幂等。
  - `skillCapabilityConfigForRuntime`：内置根被加入且不受 disabledDirs 影响。
- **集成/快照**：
  - 设置面板分类数变化后的 spotlight 计数。
  - skill 列表显示 4 个内置 skill + 内置标签。
- **手动验证**：
  - 启动后 `<userData>/builtin-skills/` 出现 4 个目录。
  - skill 设置页显示 4 个内置 skill 且带「内置」标签、无禁用开关。
  - 统一媒体卡片 5 个子区块可独立配置、全字段可见。
  - 麦克风按钮正常工作。
  - **Write 工作区入口完全消失**（无 write route、无侧边栏 write 项、typecheck 无残留引用报错）。
  - **Plan 面板正常打开**（`/plan` 命令、编辑器可用）。
  - **SDD 编辑器正常打开**（侧边栏「新建需求」、富文本编辑可用）。
  - typecheck 通过；`npm run test:ci` 通过。

---

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| 删外壳误伤 Plan/SDD 共享模块 | 已精确摸清每个文件的 importers；保留清单明确；每步 typecheck 验证 |
| `quoted-selection.test.ts` 引用被删的 WriteMarkdownPreview | B-5 显式处理该 import |
| write-thread-registry 牵涉多 store 文件 | B-3 按行号精确编辑，每步 typecheck；必要时用 explore agent 复核 |
| 内置 skill 同步失败导致媒体不可用 | 同步失败只记日志不阻塞；工具 provider 仍独立工作 |
| i18n 键误删（删了编辑器还在用的键） | 只删工作区键，编辑器/设置键明确保留；grep 每个键确认无其他引用再删 |
| 3 处 SettingsCategory 类型不同步 | A-6 显式同步 3 处 |

---

## 七、已探查确认的具体落点

1. **4 个生成工具在运行时已存在**，skill 化只加说明书。
2. **`RightPanelMode`**（`WorkbenchTopBar.tsx:25-32`）：`'todo'|'changes'|'browser'|'file'|'plan'|'sdd-ai'|null`。本次**不删 plan/sdd-ai**（Plan/SDD 保留），无需改此类型。
3. **qwicks 运行时无 write 工作区专属工具**（Plan 工具 `create-plan-tool.ts` 保留）。工作 B 不碰 qwicks 运行时。
4. **内置 skill 打包**：electron-builder `extraResources`。
