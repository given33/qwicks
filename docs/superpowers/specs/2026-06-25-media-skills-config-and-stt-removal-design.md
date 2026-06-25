# 媒体功能 Skill 化 + 通用 Skill Config 机制 + 删除 STT — 设计文档

- 日期: 2026-06-25
- 取代: `2026-06-24-media-builtin-skills-and-write-removal-design.md` 中「工作 A」关于媒体 UI 与 STT 的部分（工作 A.1~A.4/A.7 关于内置 skill 包物化的结论仍然有效且已落地，本文在其之上）

---

## 一、背景：为什么设置里"还有"媒体功能

用户问：「设置里的媒体功能为什么还没全部变成内置 skill？」

**事实根因**：4 个生成类媒体功能（image/TTS/music/video）**早就已经是内置 skill 了**——`resources/builtin-skills/` 下 4 个 skill 包已存在，`builtin-skills-service.ts` 在启动时物化到 `userData/builtin-skills`，被 skill 发现机制拾取。但**旧的 2026-06-24 设计**对媒体 UI 的结论是「保留一个统一媒体卡片」，因此：

- `settings-section-image-generation.tsx` / `settings-section-media-generation.tsx` / `settings-section-speech-to-text.tsx` **至今未被删除**，仍作为「媒体」设置分类存在。
- 旧设计**没有** skill config 概念——skill 被明确定义为「只是说明书，不含配置」。

所以"还没变"的精确答案：**内置 skill 化的"发现层"已完成，但"把配置搬进 skill + 删掉设置 UI"这一步从未执行**——因为旧设计根本没打算删 UI。

本设计推翻旧设计的媒体处理方向，改为用户现在要的：**媒体 UI 全删，每个媒体功能 = 一个自带配置入口的内置 skill，并建立通用 skill config 机制；STT 连功能带 provider speech 能力一起删。**

---

## 二、已确认的用户决策（最终）

| 决策点 | 选择 |
|---|---|
| 媒体设置 UI | **彻底删除**「媒体」侧栏分类及全部媒体设置面板文件 |
| STT（语音转文字） | **直接删除**功能 + provider `speech` 能力体系 + `SpeechToTextProtocol` + presets speech + i18n |
| 凭据落点 | 配置面板存的值**写回 `settings.agents.qwicks.*` 原位置**，底层仍走 `resolveQWicks*Settings` 链 + provider 继承（**不**改 14 个读取点） |
| skill config 通用性 | **通用机制**：任何 skill 都能在 skill.json 声明 `configSchema`；媒体 skill 是首个使用者 |
| 配置面板位置 | 「设置 → Skills」页，给每个声明了 configSchema 的内置 skill 渲染一个配置面板 |
| 4 个生成类 skill | 已存在的 4 个内置 skill 包保留，各自在 skill.json 补 `configSchema` |

---

## 三、核心架构决策：skill config 的"声明"与"值"分离

这是整个设计的关键洞察。skill 包（SKILL.md + skill.json）是**只读静态资源**，无法持有用户配置值。因此 config 机制天然分两层：

```
skill.json (只读, 打包资源)          app-settings (用户数据, 可持久化)
┌──────────────────────────┐         ┌────────────────────────────────┐
│ configSchema: {           │         │ agents.qwicks.imageGeneration: {│
│   fields: [               │  渲染→  │   apiKey, baseUrl, model, ...   │
│     {key, type, label,    │  ←写回  │ }                              │
│      required, default}   │         │ textToSpeech / musicGeneration │
│   ]                       │         │ / videoGeneration              │
│ }                         │         └────────────────────────────────┘
└──────────────────────────┘                      │
       │                                          │ 不变
       ▼                                          ▼
  GUI 配置面板按声明渲染表单 ───────────► resolveQWicks*Settings (不动)
                                            │
                                            ▼
                                  14 个读取点 (不动)
```

- **声明层**（新）：skill.json 的 `configSchema` 描述"这个 skill 需要哪些配置字段、什么类型、什么默认值、是否必填"。它是 schema，不是值。
- **值层**（复用）：配置值仍存在 `settings.agents.qwicks.*`，由现有 resolve 链消费。媒体 skill 的 configSchema 字段与现有 settings 字段一一对应。
- **桥接**（新）：GUI 读 skill.json 的 configSchema → 渲染表单 → 用户填写 → 写回 `settings.agents.qwicks.*`。对用户而言"配置在 skill 详情里"；对底层而言"数据源没变"。

**为什么不另起炉灶存值？** 因为 14 个读取点（含 `app-settings-prompts.ts` 往 Claw 提示词注入指令、`workflow-runtime.ts`、`write-infographic-service.ts` 等）都依赖 `resolveQWicks*Settings`，且 provider 继承链（选 provider 一键带凭据）是用户在用的能力。另建值源 = 重写 14 处 + 丢弃 provider 继承，风险极高、收益为零（用户看不到差别）。

---

## 四、工作 C：通用 Skill Config 机制

### C.1 skill.json manifest 扩展

在 `SkillManifest`（`qwicks/src/skills/skill-runtime.ts:17-27`，zod `.strict()`）新增可选字段：

```ts
const SkillConfigField = z.object({
  key: z.string().min(1),                 // 配置键，如 "apiKey"
  type: z.enum(['string', 'secret', 'number', 'enum', 'boolean']),
  label: z.string().min(1),               // 显示名（i18n key 或字面量）
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(), // 仅 enum
  placeholder: z.string().optional(),
  // 媒体专用：把本字段映射到 settings 路径，让 GUI 知道写回哪里
  settingsPath: z.string().optional()     // 如 "agents.qwicks.imageGeneration.apiKey"
}).strict()

const SkillConfigSchema = z.object({
  fields: z.array(SkillConfigField)
}).strict()

// SkillManifest 增加：
configSchema: SkillConfigSchema.optional()
```

- `type: 'secret'` → GUI 渲染 `SecretInput`（带显隐切换），值脱敏展示。
- `settingsPath` 是"软映射"：GUI 用它定位写回点；运行时不读它（运行时只读已 resolve 的 settings）。对**非媒体**的第三方 skill，`settingsPath` 可缺省——此时值存到一个新的通用 skill config 存储（见 C.4）。

### C.2 GUI 侧 manifest 读取扩展

`src/main/services/skill-service.ts` 的 `loadSkillSummary`（385-415）目前只读 `id/name/description/entry`。扩展为也读 `configSchema`，加入 `GuiSkillSummary`：

```ts
type GuiSkillConfigField = {
  key: string; type: string; label: string; description?: string
  required: boolean; default?: string | number | boolean
  options?: Array<{ value: string; label: string }>; placeholder?: string
  settingsPath?: string
}
type GuiSkillSummary = {
  ... // 现有字段
  configSchema?: { fields: GuiSkillConfigField[] }
}
```

`skill:list` IPC payload 自动带上（它是 `listGuiSkills` 的返回，已序列化整个 summary）。

### C.3 Skills 设置页渲染配置面板

`settings-section-agents.tsx` 的 skill 卡片（725-832）目前只列 skill 根目录。需要新增**内置 skill 的配置面板**：

- 在现有 skill 根列表下方，新增「内置技能配置」区块，列出所有 `builtin === true && configSchema` 的 skill。
- 每个 skill 一张可折叠卡（`AdvancedSettingsDisclosure` 或类似），标题 = skill.name，展开后按 `configSchema.fields` 渲染表单：
  - `string` → `<input>`
  - `secret` → `<SecretInput>`
  - `number` → `<input type="number">`
  - `enum` → `<select>`（options）
  - `boolean` → `<Toggle>`
- 字段值来源：优先读 `settingsPath` 指向的 settings 字段；无 `settingsPath` 则读通用 skill config 存储（C.4）。
- 写回：有 `settingsPath` → `update(setPathValue(...))`；无 → 写通用存储。
- 配置不完整时（必填字段空），在该 skill 卡上显示「未配置」提示与快捷跳转（指向自身展开），符合用户"启用 skill 时提示需配置"的要求。

### C.4 通用 skill config 存储（给非媒体第三方 skill 用）

为支持"任何 skill 都能声明 configSchema"，新增一个通用存储键，用于**没有 settingsPath 映射**的第三方 skill：

```ts
// app-settings-types.ts
type SkillConfigStoreV1 = Record<string, Record<string, string | number | boolean>>
// app-settings 顶层（或 claw.skills 下）新增：
// agents.qwicks.skillConfigs: SkillConfigStoreV1  —— key = skillId, value = { fieldKey: value }
```

- 媒体 skill 不用它（有 settingsPath 映射），仅作为通用机制的后备。
- 配套 zod schema（`app-ipc-schemas.ts`）+ normalize（`app-settings-qwicks.ts`）。

### C.5 运行时不感知 configSchema

明确：`configSchema` 是**纯 GUI 概念**。QWicks 运行时（`skill-runtime.ts` 的发现/注入逻辑）**不读 configSchema**——它只读 triggers/allowedTools。运行时只需要 zod 能 parse 过（`.strict()` 已扩展，新增字段允许）。这样运行时零改动，风险最低。

---

## 五、工作 D：4 个媒体 skill 接入 configSchema

### D.1 给 4 个内置 skill.json 补 configSchema

每个 skill 的 configSchema.fields 与现有 `QWicks*SettingsV1` 字段一一对应，`settingsPath` 指向 `agents.qwicks.<type>.<field>`。例（图片生成）：

```json
{
  "id": "qwicks-image-generation",
  "configSchema": {
    "fields": [
      { "key": "enabled", "type": "boolean", "label": "imageGenEnabled", "default": false, "settingsPath": "agents.qwicks.imageGeneration.enabled" },
      { "key": "providerId", "type": "enum", "label": "imageGenProvider", "settingsPath": "agents.qwicks.imageGeneration.providerId", "options": [...] },
      { "key": "protocol", "type": "enum", "label": "imageGenProtocol", "settingsPath": "agents.qwicks.imageGeneration.protocol", "options": [...] },
      { "key": "baseUrl", "type": "string", "label": "imageGenBaseUrl", "settingsPath": "agents.qwicks.imageGeneration.baseUrl" },
      { "key": "apiKey", "type": "secret", "label": "imageGenApiKey", "required": true, "settingsPath": "agents.qwicks.imageGeneration.apiKey" },
      { "key": "model", "type": "string", "label": "imageGenModel", "required": true, "settingsPath": "agents.qwicks.imageGeneration.model" },
      { "key": "defaultSize", "type": "string", "label": "imageGenDefaultSize", "settingsPath": "agents.qwicks.imageGeneration.defaultSize" },
      { "key": "timeoutMs", "type": "number", "label": "imageGenTimeout", "settingsPath": "agents.qwicks.imageGeneration.timeoutMs" }
    ]
  }
}
```

- `providerId`/`protocol` 在 skill.json 里**不带 `options`**（可选值依赖运行时 settings，无法静态枚举）。GUI 渲染 enum 时按 `settingsPath` 判定动态源：`*.protocol` → 用对应 `*_PROTOCOLS` 常量；`*.providerId` → 用当前 provider profiles + custom 项。**规则**：skill.json 声明了 `options` 就用静态值（给第三方固定枚举用）；未声明则按 settingsPath 动态填充。媒体 skill 一律不声明 options，走动态。
- **provider 继承的交互**：当 `providerId` 字段值指向某 provider（非 custom）时，`baseUrl/apiKey/model` 三个字段在面板里**显示为只读**，值标注"来自供应商 {provider.name}"（因为 resolve 链会用 provider 凭据覆盖它们，面板里手填无意义）。切到 custom 模式后这三个字段才可编辑。`defaultSize/voice/format/timeoutMs` 等非凭据字段始终可编辑。
- 4 个 skill 各自补全（TTS 多 voice/format；music 多 format；video 多 defaultDuration/defaultResolution/pollIntervalMs）。版本号从 `1.0.0` → `1.1.0` 触发物化覆盖。

### D.2 凭据写回链路

GUI 配置面板 `update(settingsPath, value)` → 复用现有 `updateQWicks({ imageGeneration: {...patch} })` 等同效果写入 → 现有 debounced save → `resolveQWicks*Settings` 不变 → 14 个读取点不变。

**provider 继承保持工作**：若用户在 skill 配置面板的 providerId 选了某 provider，运行时 resolve 仍会从 provider.image 继承 baseUrl/apiKey/model（现有逻辑）。面板里 custom 模式则用面板填的值。

---

## 六、工作 E：删除「媒体」设置 UI

### E.1 删除的文件

| 文件 | 理由 |
|---|---|
| `src/renderer/src/components/settings-section-image-generation.tsx` | 媒体配置迁入 skill 面板 |
| `src/renderer/src/components/settings-section-media-generation.tsx` | 同上 |
| `src/renderer/src/components/settings-section-speech-to-text.tsx` | STT 删除 |
| 各自 `.test.tsx` | 跟随删除 |

### E.2 修改的文件

- `settings-sections.tsx`：删 3 个 re-export（5-7 行的 Image/Media/SpeechToText）。
- `SettingsSidebar.tsx`：删 `media` 分类按钮（60-65 行）+ `SettingsCategory` 类型去 `'media'`（第 4 行）。
- `SettingsView.tsx`：
  - 删 `MediaGenerationSettingsSection` import（61 行）。
  - 删 category 路由：`imageGeneration/mediaGeneration/speechToText → 'media'`（292-295）、早返回 guard（330-332）、`Exclude<>`（344）。
  - 删渲染分支 `{category === 'media' ? <MediaGenerationSettingsSection/>}`（1033）。
- `chat-store-types.ts:89`：`SettingsRouteSection` 去 `'imageGeneration'|'mediaGeneration'|'speechToText'`。
- `use-settings-gui-update.ts`：删对应分类映射。

### E.3 数据字段保留（不删 settings types）

`QWicksImageGenerationSettingsV1` 等 4 个类型、`settings.agents.qwicks.*` 字段**全部保留**——它们仍是配置值源，只是 UI 入口从"媒体卡片"换成"skill 配置面板"。零数据丢失，用户已有配置无缝迁移。

---

## 七、工作 F：删除 STT 功能 + provider speech 能力

### F.1 删除的文件（STT 专属，可整删）

| 文件 | 理由 |
|---|---|
| `src/main/services/speech-to-text-service.ts` (+test) | STT 服务 |
| `src/shared/speech-to-text.ts` | STT 类型 |
| `src/renderer/src/components/chat/VoiceRecordingStrip.tsx` | 录音波形组件（仅 FloatingComposer 用） |

### F.2 修改的文件

**渲染层（FloatingComposer 去听写）**：
- `FloatingComposer.tsx`：删 `use-voice-dictation`/`VoiceRecordingStrip` import（104-105）、`speechToTextSettings`（521）、`dictation` hook（527-538）、`showVoiceDictation` gate（539-544）、`dictationPrimaryActionRef`（1377）、error toast（2092-2098）、录音工具条（2151-2180）、**麦克风按钮**（2251-2274）。仅删用法，保留 `Mic/Send/Square/Loader2` 图标的其他用法。
- `use-voice-dictation.ts`：整文件删（导出的 `useSpeechToTextSettings`/`useVoiceDictation` 仅 FloatingComposer 用）。

**Preload + IPC**：
- `src/preload/index.ts:173-174`：删 `transcribeSpeech`。
- `src/shared/qwicks-gui-api.ts`：删 `transcribeSpeech`（413-415）+ `SpeechTranscriptionRequest/Result` import（73-74）。
- `src/main/ipc/register-app-ipc-handlers.ts:1184-1189`：删 `speech:transcribe` handler。
- `src/main/ipc/app-ipc-schemas.ts`：删 `speechTranscribePayloadSchema`（1564-1571）+ `speechToTextSettingsSchema`（225-234）+ `speechToTextProtocolSchema`（221）+ 相关 import（41, 51）。

**Settings 类型 + resolver（删 speechToText 块）**：
- `app-settings-types.ts`：删 `CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID`（40）、`SPEECH_TO_TEXT_PROTOCOLS`（41）、`SpeechToTextProtocol`（42）、`DEFAULT_SPEECH_TO_TEXT_PROTOCOL`（43）、`QWicksSpeechToTextSettingsV1`（290-304）、`speechToText` 成员（220, 470, 461）、`ModelProviderSpeechCapabilityV1`（124-128）、`ModelProviderSpeechCapabilityPatchV1`（166）、provider profile 的 `speech?`（153, 171, 174）。
- `app-settings-provider.ts`：删 `resolveQWicksSpeechToTextSettings`（513-541）、`resolveProviderSpeechBaseUrl`（543-548）、`resolveProviderSpeechModel`（670）、`listSpeechToTextModelIds`（192）、`listSpeechToTextProviderProfiles`（344）、`isSpeechToTextModelId`（268-270）、`SPEECH_TO_TEXT_MODEL_PATTERN`（72-73）、`normalizeSpeechToTextProtocol`（1133,1139-1140）、`getQWicksRuntimeSettings` 里的 `speechToText:` 行（855）、相关 import（8,14,24,48）。
- `app-settings-qwicks.ts`：删 `defaultQWicksSpeechToTextSettings`（156,201-210）、`currentSpeechToText/nextSpeechToText`（395-399,455）、`normalizeQWicksSpeechToTextSettings`（489-503）、`normalizeQWicksSpeechToTextProtocol`（505-507）、normalize 里的行（1047）+ import（32,45）。

**Provider 体系（删 speech 能力，这是 F 的重点）**：
- `model-provider-presets.ts`：删 preset `speech?` 字段（55-58, 101-104）、Xiaomi preset 的 speech（377-381, 409-411）、materialization（620,658-664）、`modelProviderPresetSpeechCapability()`（819-826）+ import（10-13）。
- `settings-section-providers.tsx`：删 `SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS`（85-88）、`defaultSpeechCapability`（176-182）、`presetSpeechCapability`（223-233）、`updateModelProviderSpeech`（589-599）、`removeModelProviderSpeech`（601-609）、`usedBySpeech`（794,805,820,824）、`speech:` 合并（773）、speech model picklist（911-914,926-927,937-938）、`activeSpeechBaseUrlInvalid`（996-997）、`<Mic>` 标记（1051）、token-plan rebind（1309-1311）、**整张语音能力编辑卡**（1443-1505）+ import（14-18）。
- `provider-model-editor.ts`：删 `'speech'` kind（22,24）、`isSpeechToTextModelId` import（11）、`knownSpeechIds`/speech 分类（147,163,165,171,179,201-202）、speech 分支（273-283,341-346）。

**initial-setup（首启自动配置）**：
- `initial-setup-save.ts`：删 `speechUnconfigured`（95）、`speechProviderId`（103-108）、`speechToText` patch（179）。
- `app-settings-prompts.ts`：**保留** 4 个 generate_* 指令注入（204-235），它们不涉及 STT。

### F.3 i18n 清理

**settings.json**（en/zh）：删 `speechToText*` 全块（424-454）+ provider speech 相关：`speechProtocolOpenAi`（425）、`speechProtocolMimoAsr`（426）、`modelProviderSpeechCapability`（416）、`modelProviderSpeechCapabilityDesc`（417）、`modelProviderDeleteInUseSpeech`（407）、`providerModelKindSpeechDesc`（265）、`firstRunAutoWireSpeech`（762）、`firstRunTokenPlanNoSpeech`（764）。
**common.json**（en/zh）：删 `composerVoice*`（969-975）。

**保留**：`textToSpeech*`（属于 TTS 生成，非 STT）、`clawEmptyHeroProfileVoice*`（无关）。

### F.4 测试同步

- 删 `speech-to-text-service.test.ts`。
- `app-settings-provider.test.ts`：删 STT 相关 import/assertion/fixture（13,22,34,643-645,747-748,756-757,868-869,894）。
- `initial-setup-save.test.ts`：删 `runtime.speechToText.*`（161-162,202,206）。
- `settings-section-archives.test.ts:116`：更新注释。
- `settings-section-easter-egg.test.ts:35`：删 `speechToText` 键。

---

## 八、SKILL.md 配置提示文案

4 个媒体 skill 的 SKILL.md「失败处理」一节统一改为指向 skill 配置面板：

> 若提示「provider 未配置 / missing baseUrl / apiKey / model」：这是内置技能尚未配置。前往「设置 → Skills → 内置技能配置」展开本技能，填写 API 凭据后重试；或在凭据字段选择已配置的服务商。

---

## 九、实施顺序

**阶段 1 — 通用 skill config 机制（工作 C）**，独立、低风险，先落地：
1. C-1：扩展 `SkillManifest`（skill-runtime.ts）加 `configSchema` 字段 + LoadedSkill 透传。
2. C-2：扩展 `loadSkillSummary`（skill-service.ts）+ `GuiSkillSummary` + IPC payload。
3. C-3：通用 skill config 存储（app-settings types + schema + normalize）。
4. C-4：Skills 设置页配置面板渲染（settings-section-agents.tsx）。
5. C-5：typecheck + test。

**阶段 2 — 4 个媒体 skill 接 configSchema（工作 D）**：
1. D-1：4 个 skill.json 补 configSchema + 版本号升 1.1.0。
2. D-2：SKILL.md 失败处理文案更新。
3. D-3：typecheck + 验证物化覆盖。

**阶段 3 — 删 STT + provider speech（工作 F）**，范围最大，集中处理：
1. F-1：删 STT 服务/类型/组件/use-voice-dictation + FloatingComposer 接线。
2. F-2：删 preload/IPC/shared types。
3. F-3：删 settings 类型 + resolver + provider presets + provider 编辑器 speech。
4. F-4：删 initial-setup speech。
5. F-5：i18n 清理 + 测试同步。
6. F-6：typecheck + test。

**阶段 4 — 删媒体设置 UI（工作 E）**，最后做（依赖阶段 1/2 的配置面板已就位，避免配置无处可填）：
1. E-1：删 3 个媒体设置面板文件 + test。
2. E-2：改 settings-sections/SettingsView/SettingsSidebar/chat-store-types/use-settings-gui-update。
3. E-3：typecheck + test + 提交。

---

## 十、测试策略

- **单元测试**：
  - `SkillManifest` 能 parse 带 configSchema 的 skill.json（含非法字段拒绝）。
  - `loadSkillSummary` 正确带出 configSchema。
  - 通用 skill config 存储的 normalize。
  - `resolveQWicks*Settings` 4 个媒体 resolver **行为不变**（回归保护，确认删 STT 没误伤）。
- **集成**：
  - Skills 设置页对内置媒体 skill 渲染配置面板，填写后写回 settings 且 resolve 链读到正确值。
  - provider 继承：选 provider 后 skill 面板字段反映 provider 凭据。
- **手动验证**：
  - 设置侧栏无「媒体」分类。
  - 4 个内置 skill 在 Skills 页可见，各自配置面板字段齐全，可配置并通过 `/image` 等命令实际生成。
  - **麦克风按钮完全消失**（无 VoiceRecordingStrip、无听写 toast）。
  - provider 编辑器无「语音能力」卡。
  - 首启流程不再尝试配 speech。
  - typecheck 通过；`npm run test:ci` 通过。

---

## 十一、风险与缓解

| 风险 | 缓解 |
|---|---|
| 删 provider speech 牵连 presets/editor 广 | 探查已精确到行号；每阶段 typecheck 验证；`SpeechToTextProtocol` 是 load-bearing 类型，删除前先确认所有引用已清 |
| 14 个媒体读取点被误伤 | **不动** resolve 链与 settings 字段；阶段 3 后跑媒体 resolver 回归测试 |
| configSchema 的 enum options 依赖运行时 provider | GUI 渲染时对 providerId/protocol 动态填充；skill.json 不硬编码可选值 |
| 通用 config 存储与 settingsPath 映射并存导致混淆 | 媒体 skill 一律用 settingsPath；通用存储仅给无映射的第三方 skill；文档与代码注释明确 |
| 删媒体 UI 后用户配置无处填 | 阶段 4 必须在阶段 1/2 完成后；阶段 4 前手动验证 skill 面板可配置 |
| 旧设计文档与新冲突 | 本文档顶部声明取代关系；不修改旧文档（保留历史） |

---

## 十二、范围边界（明确不做）

- **不**改 QWicks 运行时的 skill 发现/注入逻辑（configSchema 纯 GUI）。
- **不**改 14 个媒体凭据读取点、不改 resolve 链、不改 config.json 桥接。
- **不**删除 `settings.agents.qwicks.{imageGeneration,textToSpeech,musicGeneration,videoGeneration}` 字段与类型（保留为值源）。
- **不**碰 generate_image/speech/music/video 工具实现。
- **不**给 STT 造模型可调工具（直接删，不 skill 化）。
- 工作区 Write 外壳删除（旧设计工作 B）**不在本次范围**，独立进行。
