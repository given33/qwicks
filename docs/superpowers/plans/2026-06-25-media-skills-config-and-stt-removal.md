# 媒体 Skill 化 + 通用 Skill Config + 删除 STT — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 4 个媒体生成功能（image/TTS/music/video）的配置从「媒体」设置分类移到每个内置 skill 自带的配置面板，建立通用 skill config 机制，并彻底删除 STT 功能与 provider speech 能力体系。

**Architecture:** skill.json 声明 `configSchema`（只读 schema，描述需要哪些字段），「Skills」设置页按声明渲染配置面板，填写的值**写回 `settings.agents.qwicks.*` 原位置**，底层完全复用现有 `resolveQWicks*Settings` 链与 provider 继承（不动 14 个读取点）。STT 连功能、IPC、服务、provider `speech` 能力、`SpeechToTextProtocol` 类型、presets、i18n 一起删。

**Tech Stack:** TypeScript, React, Electron, Zod, Vitest。两个独立测试套件：根 `src/**`（`npm test` / `npm run typecheck`）与 qwicks 子项目（`npm --prefix qwicks test` / `npm --prefix qwicks run typecheck`）。

**关键约束（执行前必读）：**
- `qwicks/` 是**独立子项目**：自己的 tsconfig、vitest、构建。根 `tsconfig.web/node.json` **不含** qwicks/，根 `src/` **不直接 import** qwicks 源码。改 qwicks 代码用 qwicks 自己的 typecheck/test 验证。
- 根项目 `src/` 改动用 `npm run typecheck`（= `tsc --noEmit -p tsconfig.web.json && tsconfig.node.json`）+ `npm test`。
- `SkillManifest`（`qwicks/src/skills/skill-runtime.ts:17`）是 zod `.strict()`，加字段必须改 schema。
- 4 个媒体 settings 字段与类型**保留**（它们是值源），只删 UI 和 STT。

**参考设计文档：** `docs/superpowers/specs/2026-06-25-media-skills-config-and-stt-removal-design.md`

---

## 阶段 1（工作 C）：通用 Skill Config 机制

### Task C-1: 扩展 SkillManifest 支持 configSchema

**Files:**
- Modify: `qwicks/src/skills/skill-runtime.ts:11-28`（schema 定义）
- Test: `qwicks/src/skills/skill-manifest-config.test.ts`（新建）

**背景：** `SkillManifest` 是 zod `.strict()` schema。运行时**不读** configSchema（设计 C.5），但 `.strict()` 会在出现未知字段时拒绝解析，所以必须加可选字段。`LoadedSkill` 不需要透传 configSchema（运行时不用）。

- [ ] **Step 1: 写失败测试**

创建 `qwicks/src/skills/skill-manifest-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { SkillManifest } from './skill-runtime.js'

describe('SkillManifest configSchema', () => {
  it('parses a manifest without configSchema (backwards compatible)', () => {
    const parsed = SkillManifest.parse({
      name: 'demo',
      version: '1.0.0',
      entry: 'SKILL.md',
      triggers: { commands: [], promptPatterns: [], fileTypes: [] },
      allowedTools: []
    })
    expect(parsed.configSchema).toBeUndefined()
  })

  it('parses a manifest with a configSchema', () => {
    const parsed = SkillManifest.parse({
      name: 'demo',
      configSchema: {
        fields: [
          { key: 'apiKey', type: 'secret', label: 'API Key', required: true, settingsPath: 'a.b.apiKey' },
          { key: 'model', type: 'string', label: 'Model', required: false, default: 'gpt' },
          { key: 'count', type: 'number', label: 'Count', required: false, default: 3 },
          { key: 'enabled', type: 'boolean', label: 'Enabled', required: false, default: false },
          {
            key: 'proto',
            type: 'enum',
            label: 'Protocol',
            required: false,
            options: [{ value: 'a', label: 'A' }]
          }
        ]
      }
    })
    expect(parsed.configSchema?.fields).toHaveLength(5)
    expect(parsed.configSchema?.fields[0]?.type).toBe('secret')
  })

  it('rejects an invalid field type', () => {
    expect(() => SkillManifest.parse({
      name: 'demo',
      configSchema: { fields: [{ key: 'x', type: 'bogus', label: 'X' }] }
    })).toThrow()
  })

  it('rejects an unknown top-level field (strict)', () => {
    expect(() => SkillManifest.parse({
      name: 'demo',
      bogusTopLevel: true
    })).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix qwicks test -- src/skills/skill-manifest-config.test.ts`
Expected: FAIL — "configSchema" 未知字段被 `.strict()` 拒绝。

- [ ] **Step 3: 扩展 schema**

修改 `qwicks/src/skills/skill-runtime.ts`，在 `SkillTriggerManifest` 定义之后、`SkillManifest` 之前插入 configSchema 相关 schema，并给 `SkillManifest` 加字段：

```ts
const SkillConfigField = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'secret', 'number', 'enum', 'boolean']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
  placeholder: z.string().optional(),
  settingsPath: z.string().min(1).optional()
}).strict()

const SkillConfigSchema = z.object({
  fields: z.array(SkillConfigField)
}).strict()
```

然后修改 `SkillManifest`，在 `priority` 字段后加一行：

```ts
export const SkillManifest = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.0.0'),
  entry: z.string().min(1).default('SKILL.md'),
  triggers: SkillTriggerManifest,
  allowedTools: z.array(z.string().min(1)).default([]),
  assets: z.array(z.string().min(1)).default([]),
  priority: z.number().int().default(0),
  configSchema: SkillConfigSchema.optional()
}).strict()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix qwicks test -- src/skills/skill-manifest-config.test.ts`
Expected: PASS（4 个测试全过）。

- [ ] **Step 5: qwicks typecheck**

Run: `npm --prefix qwicks run typecheck`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add qwicks/src/skills/skill-runtime.ts qwicks/src/skills/skill-manifest-config.test.ts
git commit -m "feat(skills): extend SkillManifest with optional configSchema"
```

---

### Task C-2: loadSkillSummary 读取 configSchema 并加入 GuiSkillSummary

**Files:**
- Modify: `src/main/services/skill-service.ts:16-26`（类型）、`385-415`（loadSkillSummary）
- Test: `src/main/services/skill-service.test.ts`

**背景：** `loadSkillSummary` 是 GUI 侧轻量解析器，目前只读 `id/name/description/entry`。需扩展读取 `configSchema`，加入 `GuiSkillSummary` 类型，让 `skill:list` IPC 能带出。

- [ ] **Step 1: 写失败测试**

`skill-service.test.ts` 现有测试把 builtin root mock 成不存在的路径（20-22 行）。要测 builtin skill 的 configSchema，需用一个**指向真实临时目录**的 builtin root。在该文件 `describe('skill-service', ...)` 内追加（复用现有 `tempRoot`/`createSettings`/`listGuiSkills` import）：

```ts
it('surfaces configSchema from a built-in skill.json', async () => {
  // Override the builtin-skills mock to a real temp dir for this test.
  const builtinDir = join(tempRoot, 'builtin-skills')
  const demoDir = join(builtinDir, 'demo')
  await mkdir(demoDir, { recursive: true })
  await writeFile(join(demoDir, 'skill.json'), JSON.stringify({
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    entry: 'SKILL.md',
    configSchema: {
      fields: [
        { key: 'apiKey', type: 'secret', label: 'Key', required: true, settingsPath: 'a.b.apiKey' },
        { key: 'model', type: 'string', label: 'Model', required: false }
      ]
    }
  }), 'utf8')
  await writeFile(join(demoDir, 'SKILL.md'), 'Demo body', 'utf8')
  // Re-mock builtinSkillsTargetDir to the real temp builtin dir for this case.
  vi.doMock('./builtin-skills-service', () => ({ builtinSkillsTargetDir: () => builtinDir }))
  vi.resetModules()
  const { listGuiSkills: listFresh } = await import('./skill-service')

  const result = await listFresh(createSettings(tempRoot), tempRoot)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const demo = result.skills.find((s) => s.id === 'demo')
  expect(demo?.builtin).toBe(true)
  expect(demo?.configSchema?.fields).toHaveLength(2)
  expect(demo?.configSchema?.fields[0]).toMatchObject({ key: 'apiKey', type: 'secret', settingsPath: 'a.b.apiKey' })
  vi.doUnmock('./builtin-skills-service')
})
```

> **测试要点：** 因为顶层 `vi.mock('./builtin-skills-service', ...)`（20 行）把 builtin root 指向不存在路径，本测试用 `vi.doMock` + `vi.resetModules` + 动态 import 覆盖它指向真实 `builtinDir`。若该动态 mock 方式在项目 vitest 版本不稳定，备选方案：把顶层 mock 改成 `builtinSkillsTargetDir: () => process.env.QWICKS_BUILTIN_TEST_DIR || join(tmpdir(), 'does-not-exist')`，测试里设置环境变量后调用——选其一使测试通过即可。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/services/skill-service.test.ts`
Expected: FAIL — `configSchema` 属性不存在于 summary。

- [ ] **Step 3: 扩展类型与解析**

修改 `src/main/services/skill-service.ts`。先在 `GuiSkillSummary` 类型（约 16-26 行）加字段：

```ts
export type GuiSkillConfigField = {
  key: string
  type: 'string' | 'secret' | 'number' | 'enum' | 'boolean'
  label: string
  description?: string
  required: boolean
  default?: string | number | boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  settingsPath?: string
}

export type GuiSkillSummary = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: GuiSkillScope
  legacy: boolean
  builtin?: boolean
  configSchema?: { fields: GuiSkillConfigField[] }
}
```

然后在 `loadSkillSummary`（约 385 行）的 `if (existsSync(manifestPath))` 分支里，解析 manifest 时读出 configSchema：

```ts
async function loadSkillSummary(root: string, scope: GuiSkillScope): Promise<GuiSkillSummary | null> {
  const manifestPath = join(root, 'skill.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const name = stringValue(manifest.name) || titleFromSlug(basename(root))
    const entry = stringValue(manifest.entry) || 'SKILL.md'
    const summary: GuiSkillSummary = {
      id: slug(stringValue(manifest.id) || name || basename(root)),
      name,
      ...(stringValue(manifest.description) ? { description: stringValue(manifest.description) } : {}),
      root,
      entryPath: join(root, entry),
      scope,
      legacy: false
    }
    if (isObject(manifest.configSchema) && Array.isArray(manifest.configSchema.fields)) {
      const fields = (manifest.configSchema.fields as unknown[])
        .map(parseConfigField)
        .filter((f): f is GuiSkillConfigField => f !== null)
      if (fields.length > 0) summary.configSchema = { fields }
    }
    return summary
  }
  // ... 保留原有 SKILL.md legacy 分支不变
```

在文件底部辅助函数区添加：

```ts
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConfigField(raw: unknown): GuiSkillConfigField | null {
  if (!isObject(raw)) return null
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const type = raw.type
  if (!key || !label) return null
  if (type !== 'string' && type !== 'secret' && type !== 'number' && type !== 'enum' && type !== 'boolean') return null
  const field: GuiSkillConfigField = {
    key,
    type,
    label,
    required: raw.required === true
  }
  if (typeof raw.description === 'string' && raw.description.trim()) field.description = raw.description.trim()
  if (typeof raw.default === 'string' || typeof raw.default === 'number' || typeof raw.default === 'boolean') {
    field.default = raw.default
  }
  if (typeof raw.placeholder === 'string' && raw.placeholder.trim()) field.placeholder = raw.placeholder.trim()
  if (typeof raw.settingsPath === 'string' && raw.settingsPath.trim()) field.settingsPath = raw.settingsPath.trim()
  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map((o): { value: string; label: string } | null => {
        if (!isObject(o)) return null
        const value = typeof o.value === 'string' ? o.value.trim() : ''
        const optionLabel = typeof o.label === 'string' ? o.label.trim() : ''
        return value && optionLabel ? { value, label: optionLabel } : null
      })
      .filter((o): o is { value: string; label: string } => o !== null)
    if (options.length > 0) field.options = options
  }
  return field
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/services/skill-service.test.ts`
Expected: PASS。

- [ ] **Step 5: 根 typecheck**

Run: `npm run typecheck`
Expected: 无错误（`GuiSkillConfigField` 等类型在 src/ 范围内）。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/skill-service.ts src/main/services/skill-service.test.ts
git commit -m "feat(skills): surface configSchema in GuiSkillSummary"
```

---

### Task C-3: 通用 skill config 存储（给无 settingsPath 的第三方 skill 用）

**Files:**
- Modify: `src/shared/app-settings-types.ts`（类型）
- Modify: `src/main/ipc/app-ipc-schemas.ts`（zod schema）
- Modify: `src/shared/app-settings-qwicks.ts`（default + normalize）
- Test: `src/shared/app-settings.test.ts`

**背景：** 媒体 skill 用 `settingsPath` 映射到 `agents.qwicks.*`，不需要这个存储。但通用机制要支持任意第三方 skill（无 settingsPath 时）存值。新增 `agents.qwicks.skillConfigs: Record<skillId, Record<fieldKey, value>>`。

- [ ] **Step 1: 写失败测试**

在 `src/shared/app-settings.test.ts` 找到 qwicks 默认值/normalize 的测试区，追加：

```ts
describe('skillConfigs store', () => {
  it('defaults to empty object', () => {
    const settings = defaultSettings() // 用文件已有的默认 settings 构造函数
    expect(settings.agents.qwicks.skillConfigs).toEqual({})
  })

  it('normalize preserves provided skillConfigs', () => {
    const normalized = normalizeAppSettings({
      ...defaultSettings(),
      agents: { qwicks: { ...defaultSettings().agents.qwicks, skillConfigs: { 'my-skill': { token: 'abc' } } } }
    })
    expect(normalized.agents.qwicks.skillConfigs).toEqual({ 'my-skill': { token: 'abc' } })
  })

  it('normalize tolerates missing skillConfigs (defaults to {})', () => {
    const settings = defaultSettings()
    delete (settings.agents.qwicks as any).skillConfigs
    const normalized = normalizeAppSettings(settings)
    expect(normalized.agents.qwicks.skillConfigs).toEqual({})
  })
})
```

> 用文件里已有的 `defaultSettings`/`normalizeAppSettings` 函数名（先 grep 确认确切导出名）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/shared/app-settings.test.ts`
Expected: FAIL — `skillConfigs` 属性不存在。

- [ ] **Step 3: 加类型**

在 `src/shared/app-settings-types.ts` 的 `QWicksSettingsV1`（含 `imageGeneration`/`textToSpeech` 等的那个类型，约 218 行附近）加成员：

```ts
/** Per-skill config values for skills without a settingsPath mapping. Keyed by skillId then fieldKey. */
skillConfigs: Record<string, Record<string, string | number | boolean>>
```

同时在 qwicks patch 类型（约 469 行）加：

```ts
skillConfigs?: Record<string, Record<string, string | number | boolean>>
```

- [ ] **Step 4: 加 default + normalize**

在 `src/shared/app-settings-qwicks.ts` 的 default 对象（约 156 行 `defaultQWicksSpeechToTextSettings` 附近，default qwicks 对象）加：

```ts
skillConfigs: {}
```

在 normalize 函数（约 1047 行 `speechToText: normalizeQWicksSpeechToTextSettings(...)` 附近）加：

```ts
skillConfigs: normalizeSkillConfigs(input.skillConfigs)
```

并在文件辅助区加：

```ts
function normalizeSkillConfigs(
  input: Record<string, Record<string, string | number | boolean>> | undefined
): Record<string, Record<string, string | number | boolean>> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, Record<string, string | number | boolean>> = {}
  for (const [skillId, fields] of Object.entries(input)) {
    if (!fields || typeof fields !== 'object') continue
    const clean: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v
    }
    out[skillId] = clean
  }
  return out
}
```

- [ ] **Step 5: 加 zod schema**

在 `src/main/ipc/app-ipc-schemas.ts` 找到 qwicks settings schema（约 383 行 `speechToText` 块附近），加：

```ts
skillConfigs: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))).optional()
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/shared/app-settings.test.ts`
Expected: PASS。

- [ ] **Step 7: typecheck**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 8: 提交**

```bash
git add src/shared/app-settings-types.ts src/shared/app-settings-qwicks.ts src/main/ipc/app-ipc-schemas.ts src/shared/app-settings.test.ts
git commit -m "feat(settings): add qwicks.skillConfigs generic per-skill config store"
```

---

### Task C-4: Skills 设置页渲染内置 skill 配置面板

**Files:**
- Modify: `src/renderer/src/components/settings-section-agents.tsx`（skill 卡片，约 725-832）
- 可能新增辅助组件或直接内联

**背景：** skill 卡片目前只列根目录。需在下方加「内置技能配置」区块：列出 `builtin === true && configSchema` 的 skill，每个一张可折叠卡，按 `configSchema.fields` 渲染表单。

> **依赖：** 此任务需要 GUI 能拿到 builtin skill 列表。`listGuiSkills` 返回的 `GuiSkillSummary[]` 已带 `builtin` 和（C-2 后）`configSchema`。需确认 `SettingsView.tsx` 是否已把 skill **列表**（不只是 roots）通过 ctx 传给 agents section。先探查。

- [ ] **Step 1: 让 ctx 提供 builtin skill 列表**

`SettingsView.tsx` 目前只调 `listSkillRoots`（382-393），没调 `listSkills`。preload 已暴露 `window.qwicksGui.listSkills(workspaceRoot)`（`src/shared/qwicks-gui-api.ts:307`）。新增：

修改 `src/renderer/src/components/SettingsView.tsx`：
- 加 import：`import type { GuiSkillSummary } from '@shared/qwicks-gui-api'`（确认该类型是否已从 qwicks-gui-api 导出；若否，从 `SkillListResult` 推导或新增导出）。
- 加 state（109 行附近）：`const [builtinSkills, setBuiltinSkills] = useState<GuiSkillSummary[]>([])`
- 扩展 `refreshSkillRoots`（或新建 `refreshBuiltinSkills`），在 agents 分类进入时一并调用 `listSkills`：

```ts
const refreshBuiltinSkills = useCallback(async (): Promise<void> => {
  if (typeof window.qwicksGui?.listSkills !== 'function') return
  try {
    const workspaceRoot = normalizeWorkspaceRoot(expandHomePath(formWorkspaceRoot ?? ''))
    const result = await window.qwicksGui.listSkills(workspaceRoot || undefined)
    if (result.ok) setBuiltinSkills(result.skills.filter((s) => s.builtin && s.configSchema))
  } catch {
    /* best-effort */
  }
}, [expandHomePath, formWorkspaceRoot])

useEffect(() => {
  if (category !== 'agents') return
  void refreshBuiltinSkills()
}, [category, refreshBuiltinSkills])
```

- 在 `settingsSectionContext`（920 行附近，`skillRoots` 同级）加：`builtinSkills,`

Run: `npm run typecheck` 确认无类型错误。

- [ ] **Step 2: 写 read/write helper（含动态 enum options）**

在 `settings-section-agents.tsx` 底部辅助组件区之前，新增纯函数 helper（无 React 依赖，便于理解）。这些 helper 处理 settingsPath 读写与 enum 动态 options。

```ts
import {
  IMAGE_GENERATION_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  MUSIC_GENERATION_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS,
  CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID
} from '@shared/app-settings'

// protocol settingsPath 后缀 -> 对应协议常量
const PROTOCOL_SOURCES: Record<string, readonly string[]> = {
  'imageGeneration.protocol': IMAGE_GENERATION_PROTOCOLS,
  'textToSpeech.protocol': TEXT_TO_SPEECH_PROTOCOLS,
  'musicGeneration.protocol': MUSIC_GENERATION_PROTOCOLS,
  'videoGeneration.protocol': VIDEO_GENERATION_PROTOCOLS
}

// media type 前缀 -> custom provider id
const CUSTOM_PROVIDER_IDS: Record<string, string> = {
  imageGeneration: CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  textToSpeech: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  musicGeneration: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  videoGeneration: CUSTOM_VIDEO_GENERATION_PROVIDER_ID
}

// media type -> 4 个之一, 或 undefined
function mediaTypeFromSettingsPath(settingsPath: string): string | undefined {
  const match = /^agents\.qwicks\.(imageGeneration|textToSpeech|musicGeneration|videoGeneration)\./.exec(settingsPath)
  return match?.[1]
}

/**
 * 字段当前值。settingsPath 形如 "agents.qwicks.imageGeneration.apiKey"——
 * ctx.qwicks 即 settings.agents.qwicks, 所以去掉 "agents.qwicks." 前缀后按点取值。
 */
function readFieldValue(
  qwicks: Record<string, any>,
  skillId: string,
  field: GuiSkillConfigField
): string | number | boolean | undefined {
  if (field.settingsPath) {
    const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
    const parts = localPath.split('.')
    let node: any = qwicks
    for (const part of parts) {
      node = node?.[part]
      if (node === undefined) break
    }
    if (node !== undefined) return node as string | number | boolean
  } else {
    const stored = qwicks.skillConfigs?.[skillId]?.[field.key]
    if (stored !== undefined) return stored
  }
  return field.default
}

/**
 * 构造写回 patch。settingsPath -> 嵌套 qwicks patch;
 * 无 settingsPath -> skillConfigs[skillId][key] patch。
 * 返回可直接传给 updateQWicks 的对象。
 */
function buildFieldPatch(
  qwicks: Record<string, any>,
  skillId: string,
  field: GuiSkillConfigField,
  value: string | number | boolean
): Record<string, unknown> {
  if (field.settingsPath) {
    const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
    const parts = localPath.split('.')
    // 构造嵌套对象 { imageGeneration: { apiKey: value } }
    const patch: Record<string, unknown> = {}
    let node: Record<string, unknown> = patch
    for (let i = 0; i < parts.length - 1; i++) {
      const next: Record<string, unknown> = {}
      node[parts[i]!] = next
      node = next
    }
    node[parts[parts.length - 1]!] = value
    return patch
  }
  const existing = (qwicks.skillConfigs ?? {}) as Record<string, Record<string, string | number | boolean>>
  return {
    skillConfigs: {
      ...existing,
      [skillId]: { ...(existing[skillId] ?? {}), [field.key]: value }
    }
  }
}

/**
 * enum 字段的可选值。有静态 options 用静态;
 * 否则按 settingsPath 后缀动态生成(protocol 常量 / provider 列表)。
 */
function resolveEnumOptions(
  field: GuiSkillConfigField,
  providers: ModelProviderProfileV1[]
): { value: string; label: string }[] {
  if (field.options && field.options.length > 0) return field.options
  if (!field.settingsPath) return []
  // protocol 字段
  const localPath = field.settingsPath.replace(/^agents\.qwicks\./, '')
  const protocolSource = PROTOCOL_SOURCES[localPath]
  if (protocolSource) {
    return protocolSource.map((p) => ({ value: p, label: p }))
  }
  // providerId 字段
  const mediaType = mediaTypeFromSettingsPath(field.settingsPath)
  if (mediaType && localPath.endsWith('.providerId')) {
    const opts = providers
      .filter((p) => Boolean((p as any)[mediaType]))  // 该 provider 有对应能力
      .map((p) => ({ value: p.id, label: p.name }))
    opts.push({ value: CUSTOM_PROVIDER_IDS[mediaType] ?? 'custom', label: 'custom' })
    return opts
  }
  // format 字段 (audio/video) — 用常见值
  if (localPath.endsWith('.format')) {
    return [{ value: 'mp3', label: 'mp3' }, { value: 'wav', label: 'wav' }, { value: 'flac', label: 'flac' }]
  }
  if (localPath.endsWith('.defaultResolution')) {
    return [{ value: '768P', label: '768P' }, { value: '1080P', label: '1080P' }]
  }
  return []
}

/**
 * 该 media skill 当前是否选了真实 provider(非 custom)。
 * 用于决定 apiKey/baseUrl/model 是否只读(provider 继承)。
 */
function isUsingRealProvider(qwicks: Record<string, any>, field: GuiSkillConfigField): boolean {
  if (!field.settingsPath) return false
  const mediaType = mediaTypeFromSettingsPath(field.settingsPath)
  if (!mediaType) return false
  const providerId = (qwicks[mediaType] as any)?.providerId ?? ''
  const customId = CUSTOM_PROVIDER_IDS[mediaType]
  return Boolean(providerId) && providerId !== customId
}
```

- [ ] **Step 3: 写 SkillConfigFieldRow 组件**

在 helper 之后新增逐字段渲染组件：

```tsx
function SkillConfigFieldRow(input: {
  field: GuiSkillConfigField
  skill: GuiSkillSummary
  qwicks: Record<string, any>
  providers: ModelProviderProfileV1[]
  providerName: string | undefined
  t: (key: string, values?: Record<string, unknown>) => string
  onWrite: (patch: Record<string, unknown>) => void
}): ReactElement {
  const { field, skill, qwicks, providers, providerName, t, onWrite } = input
  const value = readFieldValue(qwicks, skill.id, field)
  const label = t(field.label)  // i18n key; media skill 的 label 都是已有的 i18n 键
  const description = field.description ? t(field.description) : undefined
  // provider 继承时, 凭据字段只读
  const inheritedFromProvider =
    isUsingRealProvider(qwicks, field) &&
    (field.key === 'apiKey' || field.key === 'baseUrl' || field.key === 'model')

  const control = (() => {
    if (inheritedFromProvider) {
      return (
        <div className="flex items-center gap-2">
          <code className="rounded bg-ds-main/60 px-2 py-1 font-mono text-[12px] text-ds-muted">
            {field.type === 'secret' ? '••••' : String(value ?? '')}
          </code>
          <span className="text-[12px] text-ds-faint">
            {t('skillConfigFromProvider', { provider: providerName ?? '' })}
          </span>
        </div>
      )
    }
    switch (field.type) {
      case 'boolean':
        return <Toggle checked={value === true} onChange={(v) => onWrite(buildFieldPatch(qwicks, skill.id, field, v))} />
      case 'secret':
        return (
          <SecretInput
            value={typeof value === 'string' ? value : ''}
            onChange={(v) => onWrite(buildFieldPatch(qwicks, skill.id, field, v))}
            visible={false}
            onToggleVisibility={() => {}}
            showLabel={t('showSecret')}
            hideLabel={t('hideSecret')}
            className="md:max-w-md"
          />
        )
      case 'number':
        return (
          <input
            type="number"
            className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
            value={typeof value === 'number' ? value : Number(value ?? 0)}
            onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, Number(e.target.value)))}
          />
        )
      case 'enum': {
        const options = resolveEnumOptions(field, providers)
        return (
          <select
            className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, e.target.value))}
          >
            <option value="">{t('modelSelectDefaultOption', { model: options[0]?.label ?? '' })}</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )
      }
      default: // 'string'
        return (
          <input
            className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder ?? ''}
            onChange={(e) => onWrite(buildFieldPatch(qwicks, skill.id, field, e.target.value))}
          />
        )
    }
  })()

  return (
    <SettingRow title={label} description={description} control={control} />
  )
}
```

- [ ] **Step 4: 写 BuiltinSkillConfigCard 组件并接入卡片**

```tsx
function BuiltinSkillConfigCard(input: {
  skill: GuiSkillSummary
  qwicks: Record<string, any>
  providers: ModelProviderProfileV1[]
  t: (key: string, values?: Record<string, unknown>) => string
  updateQWicks: (patch: Record<string, unknown>) => void
}): ReactElement {
  const { skill, qwicks, providers, t, updateQWicks } = input
  const [open, setOpen] = useState(false)
  const fields = skill.configSchema?.fields ?? []
  // 该 skill 选中的 provider 名(用于只读标注)
  const providerField = fields.find((f) => f.key === 'providerId')
  const providerId = providerField ? String(readFieldValue(qwicks, skill.id, providerField) ?? '') : ''
  const providerName = providers.find((p) => p.id === providerId)?.name
  // 必填字段是否齐全
  const requiredMissing = fields
    .filter((f) => f.required)
    .some((f) => {
      const v = readFieldValue(qwicks, skill.id, f)
      return v === undefined || v === '' || (typeof v === 'string' && !v.trim())
    })

  return (
    <div className="rounded-xl border border-ds-border bg-ds-card px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
          {skill.name}
          {requiredMissing ? (
            <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
              {t('skillConfigUnconfigured')}
            </span>
          ) : null}
        </span>
        <span className="text-[12px] text-ds-muted">{open ? t('collapse') : t('expand')}</span>
      </button>
      {open ? (
        <div className="mt-3 divide-y divide-ds-border-muted">
          {fields.map((field) => (
            <SkillConfigFieldRow
              key={field.key}
              field={field}
              skill={skill}
              qwicks={qwicks}
              providers={providers}
              providerName={providerName}
              t={t}
              onWrite={updateQWicks}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

然后在 skill 卡片（`<SettingsCard title={t('skill')}>` 内，`skillsActions` SettingRow 之后、`</SettingsCard>` 之前）插入：

```tsx
{builtinSkills.length > 0 ? (
  <SettingRow
    title={t('builtinSkillConfig')}
    description={t('builtinSkillConfigDesc')}
    wideControl
    control={
      <div className="flex w-full flex-col gap-3">
        {builtinSkills.map((skill) => (
          <BuiltinSkillConfigCard
            key={skill.id}
            skill={skill}
            qwicks={qwicks}
            providers={modelProviders}
            t={t}
            updateQWicks={updateQWicks}
          />
        ))}
      </div>
    }
  />
) : null}
```

> `modelProviders` 与 `updateQWicks` 已在组件内解构（372-373 行 `provider`、`updateQWicks`）。从 ctx 解构 `builtinSkills`。补充类型 import：`GuiSkillConfigField`、`GuiSkillSummary`（从 qwicks-gui-api 或 skill-service 类型）。

- [ ] **Step 5: 补 i18n 键**

在 `src/renderer/src/locales/en/settings.json` 和 `zh/settings.json` 加：

```json
"builtinSkillConfig": "Built-in skill configuration" / "内置技能配置",
"builtinSkillConfigDesc": "Configure credentials for built-in skills. Required fields must be filled before the skill works." / "为内置技能配置凭据。必填字段在技能可用前必须填写。",
"collapse": "Collapse" / "收起",
"expand": "Expand" / "展开",
"skillConfigFromProvider": "Inherited from provider {{provider}}" / "来自供应商 {{provider}}",
"skillConfigUnconfigured": "Not configured" / "未配置"
```

> 注：`expand`/`collapse` 可能已存在（先 grep）；media skill 的 `field.label`（如 `imageGenApiKey`）已是现有 i18n 键，直接复用。

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: 无错误。修复 import 与类型（`GuiSkillConfigField`/`ModelProviderProfileV1`/`Toggle`/`SecretInput`/`SettingRow` 均已在文件顶部 import）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/settings-section-agents.tsx src/renderer/src/components/SettingsView.tsx src/renderer/src/locales/en/settings.json src/renderer/src/locales/zh/settings.json
git commit -m "feat(skills): render built-in skill config panel in Skills settings"
```

---

## 阶段 2（工作 D）：4 个媒体 skill 接入 configSchema

### Task D-1: 给 4 个媒体 skill.json 补 configSchema

**Files:**
- Modify: `resources/builtin-skills/qwicks-image-generation/skill.json`
- Modify: `resources/builtin-skills/qwicks-text-to-speech/skill.json`
- Modify: `resources/builtin-skills/qwicks-music-generation/skill.json`
- Modify: `resources/builtin-skills/qwicks-video-generation/skill.json`

**背景：** 每个字段加 `settingsPath` 指向 `agents.qwicks.<type>.<field>`。`providerId`/`protocol` 不带静态 options（GUI 动态填充）。版本号升 `1.1.0` 触发 `ensureBuiltinMediaSkills` 覆盖。

- [ ] **Step 1: 图片生成 skill.json**

把 `resources/builtin-skills/qwicks-image-generation/skill.json` 的 `version` 改 `"1.1.0"`，并在 `allowedTools` 后、`priority` 前插入 `configSchema`：

```json
  "configSchema": {
    "fields": [
      { "key": "enabled", "type": "boolean", "label": "imageGenEnabled", "default": false, "settingsPath": "agents.qwicks.imageGeneration.enabled" },
      { "key": "providerId", "type": "enum", "label": "imageGenProvider", "settingsPath": "agents.qwicks.imageGeneration.providerId" },
      { "key": "protocol", "type": "enum", "label": "imageGenProtocol", "settingsPath": "agents.qwicks.imageGeneration.protocol" },
      { "key": "baseUrl", "type": "string", "label": "imageGenBaseUrl", "settingsPath": "agents.qwicks.imageGeneration.baseUrl" },
      { "key": "apiKey", "type": "secret", "label": "imageGenApiKey", "required": true, "settingsPath": "agents.qwicks.imageGeneration.apiKey" },
      { "key": "model", "type": "string", "label": "imageGenModel", "required": true, "settingsPath": "agents.qwicks.imageGeneration.model" },
      { "key": "defaultSize", "type": "string", "label": "imageGenDefaultSize", "settingsPath": "agents.qwicks.imageGeneration.defaultSize" },
      { "key": "timeoutMs", "type": "number", "label": "imageGenTimeout", "settingsPath": "agents.qwicks.imageGeneration.timeoutMs" }
    ]
  },
```

- [ ] **Step 2: TTS skill.json**

`resources/builtin-skills/qwicks-text-to-speech/skill.json`，version→`1.1.0`，configSchema 字段：

```json
  "configSchema": {
    "fields": [
      { "key": "enabled", "type": "boolean", "label": "textToSpeechEnabled", "default": false, "settingsPath": "agents.qwicks.textToSpeech.enabled" },
      { "key": "providerId", "type": "enum", "label": "textToSpeechProvider", "settingsPath": "agents.qwicks.textToSpeech.providerId" },
      { "key": "protocol", "type": "enum", "label": "textToSpeechProtocol", "settingsPath": "agents.qwicks.textToSpeech.protocol" },
      { "key": "baseUrl", "type": "string", "label": "textToSpeechBaseUrl", "settingsPath": "agents.qwicks.textToSpeech.baseUrl" },
      { "key": "apiKey", "type": "secret", "label": "textToSpeechApiKey", "required": true, "settingsPath": "agents.qwicks.textToSpeech.apiKey" },
      { "key": "model", "type": "string", "label": "textToSpeechModel", "required": true, "settingsPath": "agents.qwicks.textToSpeech.model" },
      { "key": "voice", "type": "string", "label": "textToSpeechVoice", "settingsPath": "agents.qwicks.textToSpeech.voice" },
      { "key": "format", "type": "enum", "label": "textToSpeechFormat", "settingsPath": "agents.qwicks.textToSpeech.format" },
      { "key": "timeoutMs", "type": "number", "label": "textToSpeechTimeout", "settingsPath": "agents.qwicks.textToSpeech.timeoutMs" }
    ]
  },
```

- [ ] **Step 3: 音乐 skill.json**

`resources/builtin-skills/qwicks-music-generation/skill.json`，version→`1.1.0`，configSchema：

```json
  "configSchema": {
    "fields": [
      { "key": "enabled", "type": "boolean", "label": "musicGenerationEnabled", "default": false, "settingsPath": "agents.qwicks.musicGeneration.enabled" },
      { "key": "providerId", "type": "enum", "label": "musicGenerationProvider", "settingsPath": "agents.qwicks.musicGeneration.providerId" },
      { "key": "protocol", "type": "enum", "label": "musicGenerationProtocol", "settingsPath": "agents.qwicks.musicGeneration.protocol" },
      { "key": "baseUrl", "type": "string", "label": "musicGenerationBaseUrl", "settingsPath": "agents.qwicks.musicGeneration.baseUrl" },
      { "key": "apiKey", "type": "secret", "label": "musicGenerationApiKey", "required": true, "settingsPath": "agents.qwicks.musicGeneration.apiKey" },
      { "key": "model", "type": "string", "label": "musicGenerationModel", "required": true, "settingsPath": "agents.qwicks.musicGeneration.model" },
      { "key": "format", "type": "enum", "label": "musicGenerationFormat", "settingsPath": "agents.qwicks.musicGeneration.format" },
      { "key": "timeoutMs", "type": "number", "label": "musicGenerationTimeout", "settingsPath": "agents.qwicks.musicGeneration.timeoutMs" }
    ]
  },
```

- [ ] **Step 4: 视频 skill.json**

`resources/builtin-skills/qwicks-video-generation/skill.json`，version→`1.1.0`，configSchema：

```json
  "configSchema": {
    "fields": [
      { "key": "enabled", "type": "boolean", "label": "videoGenerationEnabled", "default": false, "settingsPath": "agents.qwicks.videoGeneration.enabled" },
      { "key": "providerId", "type": "enum", "label": "videoGenerationProvider", "settingsPath": "agents.qwicks.videoGeneration.providerId" },
      { "key": "protocol", "type": "enum", "label": "videoGenerationProtocol", "settingsPath": "agents.qwicks.videoGeneration.protocol" },
      { "key": "baseUrl", "type": "string", "label": "videoGenerationBaseUrl", "settingsPath": "agents.qwicks.videoGeneration.baseUrl" },
      { "key": "apiKey", "type": "secret", "label": "videoGenerationApiKey", "required": true, "settingsPath": "agents.qwicks.videoGeneration.apiKey" },
      { "key": "model", "type": "string", "label": "videoGenerationModel", "required": true, "settingsPath": "agents.qwicks.videoGeneration.model" },
      { "key": "defaultDuration", "type": "number", "label": "videoGenerationDefaultDuration", "settingsPath": "agents.qwicks.videoGeneration.defaultDuration" },
      { "key": "defaultResolution", "type": "enum", "label": "videoGenerationDefaultResolution", "settingsPath": "agents.qwicks.videoGeneration.defaultResolution" },
      { "key": "timeoutMs", "type": "number", "label": "videoGenerationTimeout", "settingsPath": "agents.qwicks.videoGeneration.timeoutMs" },
      { "key": "pollIntervalMs", "type": "number", "label": "videoGenerationPollInterval", "settingsPath": "agents.qwicks.videoGeneration.pollIntervalMs" }
    ]
  },
```

- [ ] **Step 5: 验证 skill.json 合法且能被 parse**

Run: `node -e "const f=['qwicks-image-generation','qwicks-text-to-speech','qwicks-music-generation','qwicks-video-generation']; for(const s of f){const m=require('./resources/builtin-skills/'+s+'/skill.json'); if(!m.configSchema) throw new Error(s+' missing configSchema'); console.log(s, m.version, m.configSchema.fields.length, 'fields')}"`
Expected: 4 行输出，每行 version `1.1.0` 且 fields 数 > 0。

- [ ] **Step 6: 提交**

```bash
git add resources/builtin-skills/qwicks-image-generation/skill.json resources/builtin-skills/qwicks-text-to-speech/skill.json resources/builtin-skills/qwicks-music-generation/skill.json resources/builtin-skills/qwicks-video-generation/skill.json
git commit -m "feat(skills): add configSchema to 4 built-in media skills"
```

---

### Task D-2: 更新 4 个 SKILL.md 失败处理文案

**Files:**
- Modify: 4 个 `resources/builtin-skills/qwicks-*/SKILL.md` 的「失败处理」段

**背景：** 设计第八节，统一指向 skill 配置面板。

- [ ] **Step 1: 更新图片 SKILL.md 失败处理段**

把 `resources/builtin-skills/qwicks-image-generation/SKILL.md` 的失败处理里「前往设置 → 媒体能力」改为：

```markdown
## 失败处理
- 若提示「provider 未配置 / missing baseUrl / apiKey / model」：这是内置技能尚未配置。前往「设置 → Skills → 内置技能配置」，展开「图像生成」填写 API 凭据后重试；或在 providerId 字段选择已配置凭据的服务商。
- 网络/超时错误：简要说明并建议重试。
```

- [ ] **Step 2: 同样更新 TTS / 音乐 / 视频 SKILL.md**

分别把对应 SKILL.md 失败处理段的引导文字改为指向「设置 → Skills → 内置技能配置」并展开对应技能名（语音合成/音乐生成/视频生成）。保留各自原有的其他失败处理要点（如 TTS 的分段合成）。

- [ ] **Step 3: 提交**

```bash
git add resources/builtin-skills/qwicks-image-generation/SKILL.md resources/builtin-skills/qwicks-text-to-speech/SKILL.md resources/builtin-skills/qwicks-music-generation/SKILL.md resources/builtin-skills/qwicks-video-generation/SKILL.md
git commit -m "docs(skills): point media skill failure text to Skills config panel"
```

---

## 阶段 3（工作 F）：删除 STT + provider speech 能力

> **范围最大、牵连最广。** 按层自底向上删：渲染 → preload/IPC → types/resolver → provider presets/editor → initial-setup → i18n → 测试。每步 typecheck 验证。`SpeechToTextProtocol` 是 load-bearing 类型，必须等所有引用清完才能删类型本身。

### Task F-1: 删除渲染层 STT（FloatingComposer + use-voice-dictation + VoiceRecordingStrip）

**Files:**
- Delete: `src/renderer/src/components/chat/VoiceRecordingStrip.tsx`
- Delete: `src/renderer/src/components/chat/use-voice-dictation.ts`
- Modify: `src/renderer/src/components/chat/FloatingComposer.tsx`

- [ ] **Step 1: 删 FloatingComposer 的听写接线**

修改 `src/renderer/src/components/chat/FloatingComposer.tsx`：
- 删 import：`useSpeechToTextSettings, useVoiceDictation`（104 行）、`VoiceRecordingStrip`（105 行）。
- 删 `const speechToTextSettings = useSpeechToTextSettings()`（521）。
- 删 `const dictation = useVoiceDictation({...})` 整块（527-538）。
- 删 `const showVoiceDictation = ...`（539-544）。
- 删 `dictationPrimaryActionRef.current = ...`（1377 附近）。
- 删 dictation error toast（2092-2098）。
- 删录音工具条分支（2151-2180，`VoiceRecordingStrip`、stop-insert、stop-send 按钮）。
- 删麦克风按钮（2251-2274）。
- 保留 `Mic`/`Send`/`Square`/`Loader2` 图标的其他用法（grep 确认无残留 `dictation.` 引用）。

Run: `grep -n 'dictation\|voiceDictation\|speechToTextSettings\|VoiceRecordingStrip\|use-voice-dictation' src/renderer/src/components/chat/FloatingComposer.tsx`
Expected: 无输出（全清干净）。

- [ ] **Step 2: 删除两个 STT 专属文件**

```bash
rm src/renderer/src/components/chat/VoiceRecordingStrip.tsx
rm src/renderer/src/components/chat/use-voice-dictation.ts
```

Run: `grep -rn 'use-voice-dictation\|VoiceRecordingStrip\|useVoiceDictation\|useSpeechToTextSettings' src/`
Expected: 无输出（确认无其他引用）。

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 无错误（renderer 部分）。若有残留引用报错，按报错清理。

- [ ] **Step 4: 提交**

```bash
git add -A src/renderer/src/components/chat/FloatingComposer.tsx src/renderer/src/components/chat/VoiceRecordingStrip.tsx src/renderer/src/components/chat/use-voice-dictation.ts
git commit -m "refactor(chat): remove voice dictation UI from FloatingComposer"
```

---

### Task F-2: 删除 preload + IPC + shared speech 类型

**Files:**
- Delete: `src/shared/speech-to-text.ts`
- Delete: `src/main/services/speech-to-text-service.ts` (+test)
- Modify: `src/preload/index.ts`
- Modify: `src/shared/qwicks-gui-api.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/app-ipc-schemas.ts`

- [ ] **Step 1: 删 preload 桥**

修改 `src/preload/index.ts`，删 `transcribeSpeech: (payload) => ipcRenderer.invoke('speech:transcribe', payload)`（173-174）。

- [ ] **Step 2: 删 shared API 类型**

修改 `src/shared/qwicks-gui-api.ts`：
- 删 `SpeechTranscriptionRequest` / `SpeechTranscriptionResult` 的 import（73-74）。
- 删 `transcribeSpeech: (...)` 成员（413-415）。

- [ ] **Step 3: 删 IPC handler**

修改 `src/main/ipc/register-app-ipc-handlers.ts`，删 `ipcMain.handle('speech:transcribe', ...)` 块（1184-1189）及相关 import（`requestSpeechTranscription` 等）。

- [ ] **Step 4: 删 IPC schema**

修改 `src/main/ipc/app-ipc-schemas.ts`：
- 删 import `SPEECH_TRANSCRIPTION_*`（51 行）、`SPEECH_TO_TEXT_PROTOCOLS`（41 行）。
- 删 `speechTranscribePayloadSchema`（1564-1571）。
- 删 `speechToTextProtocolSchema`（221）、`speechToTextSettingsSchema`（225-234）。

- [ ] **Step 5: 删 STT 服务与 shared 类型文件**

```bash
rm src/shared/speech-to-text.ts
rm src/main/services/speech-to-text-service.ts
rm src/main/services/speech-to-text-service.test.ts
```

- [ ] **Step 6: typecheck 并清理残留**

Run: `npm run typecheck`
Expected: 可能报 `speech-to-text` / `SpeechTranscription*` 残留 import。按报错逐一删除对应 import。重复直到无错误。

- [ ] **Step 7: 提交**

```bash
git add -A src/preload/index.ts src/shared/qwicks-gui-api.ts src/shared/speech-to-text.ts src/main/ipc/register-app-ipc-handlers.ts src/main/ipc/app-ipc-schemas.ts src/main/services/speech-to-text-service.ts src/main/services/speech-to-text-service.test.ts
git commit -m "refactor(ipc): remove speech:transcribe IPC and STT service"
```

---

### Task F-3: 删除 settings 类型 + resolver 里的 speechToText

**Files:**
- Modify: `src/shared/app-settings-types.ts`
- Modify: `src/shared/app-settings-provider.ts`
- Modify: `src/shared/app-settings-qwicks.ts`

> **注意：** `SpeechToTextProtocol` 和 `ModelProviderSpeechCapabilityV1` 在本任务**先保留**（provider 体系还引用它们，F-4 才删 provider speech）。本任务只删 STT **settings** 侧（`QWicksSpeechToTextSettingsV1`、`speechToText:` 成员、resolver）。`ModelProviderSpeechCapabilityV1` 因依赖 `SpeechToTextProtocol`，连同 protocol 一起在 F-4 删。

- [ ] **Step 1: 删 app-settings-types 里的 STT settings**

修改 `src/shared/app-settings-types.ts`：
- 删 `CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID`（40）、`SPEECH_TO_TEXT_PROTOCOLS`（41）、`SpeechToTextProtocol`（42）、`DEFAULT_SPEECH_TO_TEXT_PROTOCOL`（43）——**仅当 F-4 已删 provider speech 后才删这些**。本步**先跳过这 4 个**（它们被 provider 用）。
- 删 `QWicksSpeechToTextSettingsV1`（290-304）。
- 删 `QWicksSettingsV1` 里的 `speechToText:` 成员（220）。
- 删 patch 类型的 `speechToText?:` 成员（470）。

- [ ] **Step 2: 删 app-settings-provider 里的 STT resolver**

修改 `src/shared/app-settings-provider.ts`：
- 删 `resolveQWicksSpeechToTextSettings`（513-541）、`resolveProviderSpeechBaseUrl`（543-548）、`resolveProviderSpeechModel`（670）、`listSpeechToTextModelIds`（192）、`listSpeechToTextProviderProfiles`（344）、`isSpeechToTextModelId`（268-270）、`SPEECH_TO_TEXT_MODEL_PATTERN`（72-73）、`normalizeSpeechToTextProtocol`（1133, 1139-1140）。
- 删 `getQWicksRuntimeSettings` 返回里的 `speechToText: resolveQWicksSpeechToTextSettings(settings)`（855）。
- 删相关 import（8, 14, 24, 48 中 STT 专属的）。
- 注意：`QWicksRuntimeSettingsV1` 类型里有 `speechToText` 成员，也要删（类型定义在 app-settings-types，同步删）。

- [ ] **Step 3: 删 app-settings-qwicks 里的 STT normalize/default**

修改 `src/shared/app-settings-qwicks.ts`：
- 删 default 对象的 `speechToText: defaultQWicksSpeechToTextSettings()`（156）。
- 删 `defaultQWicksSpeechToTextSettings()` 定义（201-210）。
- 删 `applyQWicksRuntimePatch` 里的 `currentSpeechToText/nextSpeechToText`（395-399）和 `speechToText: nextSpeechToText`（455）。
- 删 `normalizeQWicksSpeechToTextSettings`（489-503）、`normalizeQWicksSpeechToTextProtocol`（505-507）。
- 删 normalize 调用里的 `speechToText: normalizeQWicksSpeechToTextSettings(...)`（1047）。
- 删相关 import（32, 45 中 STT 专属的）。

- [ ] **Step 4: typecheck 并清理**

Run: `npm run typecheck`
Expected: 报 `speechToText` 残留引用。按报错清理（可能涉及 `QWicksRuntimeSettingsV1` 类型、各处 `.speechToText` 读取）。`initial-setup-save.ts` 的 STT 引用留到 F-5。

- [ ] **Step 5: 提交**

```bash
git add src/shared/app-settings-types.ts src/shared/app-settings-provider.ts src/shared/app-settings-qwicks.ts
git commit -m "refactor(settings): remove speechToText settings block and resolvers"
```

---

### Task F-4: 删除 provider speech 能力体系

**Files:**
- Modify: `src/shared/app-settings-types.ts`（删 SpeechToTextProtocol + speech capability 类型）
- Modify: `src/shared/model-provider-presets.ts`
- Modify: `src/renderer/src/components/settings-section-providers.tsx`
- Modify: `src/renderer/src/components/provider-model-editor.ts`

> **本任务完成后** `SpeechToTextProtocol` 才真正无引用，可删。

- [ ] **Step 1: 删 provider-model-editor speech**

修改 `src/renderer/src/components/provider-model-editor.ts`：
- 删 `'speech'` 从 `ProviderModelKind`（22）和 `PROVIDER_MODEL_KINDS`（24）。
- 删 `isSpeechToTextModelId` import（11）。
- 删 `knownSpeechIds`/speech 分类逻辑（147, 163, 165, 171, 179, 201-202）。
- 删 `applyProviderModelForm`/`removeProviderModel` 的 speech 分支（273-283, 341-346）。

- [ ] **Step 2: 删 settings-section-providers speech**

修改 `src/renderer/src/components/settings-section-providers.tsx`：
- 删 `SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS`（85-88）、`defaultSpeechCapability`（176-182）、`presetSpeechCapability`（223-233）、`updateModelProviderSpeech`（589-599）、`removeModelProviderSpeech`（601-609）。
- 删 `usedBySpeech`（794, 805, 820, 824）、`speech:` 合并（773）、speech model picklist（911-914, 926-927, 937-938）、`activeSpeechBaseUrlInvalid`（996-997）、`<Mic>` 标记（1051）、token-plan rebind（1309-1311）。
- 删**整张语音能力编辑卡**（`<DetailSection title={t('modelProviderSpeechCapability')}>` ... `</DetailSection>`，1443-1505）。
- 删 import（14-18 中 speech 专属的）。

- [ ] **Step 3: 删 model-provider-presets speech**

修改 `src/shared/model-provider-presets.ts`：
- 删 preset 类型的 `speech?` 字段（55-58, 101-104）。
- 删 Xiaomi preset 的 speech（377-381, 409-411）。
- 删 materialization（620, 658-664）、`modelProviderPresetSpeechCapability()`（819-826）。
- 删 import（10-13 中 speech 专属的）。

- [ ] **Step 4: 删 SpeechToTextProtocol 与 speech capability 类型**

修改 `src/shared/app-settings-types.ts`：
- 删 `CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID`（40）、`SPEECH_TO_TEXT_PROTOCOLS`（41）、`SpeechToTextProtocol`（42）、`DEFAULT_SPEECH_TO_TEXT_PROTOCOL`（43）。
- 删 `ModelProviderSpeechCapabilityV1`（124-128）、`ModelProviderSpeechCapabilityPatchV1`（166）。
- 删 `ModelProviderProfileV1.speech?`（153）、patch 类型的 `speech?`（171, 174）。

- [ ] **Step 5: typecheck 并清理残留**

Run: `npm run typecheck`
Expected: 可能仍有 `speech` / `SpeechToTextProtocol` 残留。逐一清理。

Run: `grep -rn 'SpeechToText\|speechToText\|\.speech\b\|isSpeechToTextModelId\|speech:' src/`
Expected: 仅剩 i18n 键（F-6 处理）和注释。

- [ ] **Step 6: 提交**

```bash
git add src/shared/app-settings-types.ts src/shared/model-provider-presets.ts src/renderer/src/components/settings-section-providers.tsx src/renderer/src/components/provider-model-editor.ts
git commit -m "refactor(providers): remove speech capability and SpeechToTextProtocol"
```

---

### Task F-5: 删除 initial-setup speech 接线

**Files:**
- Modify: `src/renderer/src/components/initial-setup-save.ts`

- [ ] **Step 1: 删 speech 自动配置逻辑**

修改 `src/renderer/src/components/initial-setup-save.ts`：
- 删 `speechUnconfigured` 检查（95）。
- 删 `speechProviderId` 选取（103-108）。
- 删 `speechToText: { enabled: true, providerId: wire.speechProviderId }` patch（179）。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/initial-setup-save.ts
git commit -m "refactor(setup): drop speech auto-wire from initial setup"
```

---

### Task F-6: i18n 清理 + 测试同步

**Files:**
- Modify: `src/renderer/src/locales/en/settings.json`, `zh/settings.json`
- Modify: `src/renderer/src/locales/en/common.json`, `zh/common.json`
- Modify: 各测试文件
- Modify: `src/renderer/src/components/settings-section-archives.test.ts`（注释）
- Modify: `src/renderer/src/components/settings-section-easter-egg.test.ts`

- [ ] **Step 1: 删 settings.json STT i18n 键**

en/zh `settings.json` 删除：`speechToText*` 全块（约 424-454）、`speechProtocolOpenAi`、`speechProtocolMimoAsr`、`modelProviderSpeechCapability`、`modelProviderSpeechCapabilityDesc`、`modelProviderDeleteInUseSpeech`、`providerModelKindSpeechDesc`、`firstRunAutoWireSpeech`、`firstRunTokenPlanNoSpeech`。

> 删前每个键 `grep -rn '<key>' src/` 确认已无代码引用。

- [ ] **Step 2: 删 common.json 听写 i18n 键**

en/zh `common.json` 删除：`composerVoiceStart/Stop/Send/Transcribing/MicDenied/TooShort/Failed`（约 969-975）。

**保留**：`textToSpeech*`（属 TTS）、`clawEmptyHeroProfileVoice*`（无关）。

- [ ] **Step 3: 同步测试**

- `src/shared/app-settings-provider.test.ts`：删 STT import（13, 22, 34）+ assertion（643-645）+ fixture（747-748, 756-757, 868-869, 894）。
- `src/renderer/src/components/initial-setup-save.test.ts`：删 `runtime.speechToText.*`（161-162, 202, 206）。
- `src/renderer/src/components/settings-section-archives.test.ts:116`：更新注释。
- `src/renderer/src/components/settings-section-easter-egg.test.ts:35`：删 `speechToText` 键。

- [ ] **Step 4: 跑全套测试**

Run: `npm test`
Expected: 全过。修复任何 STT 残留导致的失败。

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/locales/ src/shared/app-settings-provider.test.ts src/renderer/src/components/initial-setup-save.test.ts src/renderer/src/components/settings-section-archives.test.ts src/renderer/src/components/settings-section-easter-egg.test.ts
git commit -m "chore(i18n): remove STT and speech-capability i18n keys + sync tests"
```

---

## 阶段 4（工作 E）：删除「媒体」设置 UI

> **必须在阶段 1、2 完成后执行**（skill 配置面板已就位，否则媒体无处配置）。

### Task E-1: 删除 3 个媒体设置面板文件

**Files:**
- Delete: `src/renderer/src/components/settings-section-image-generation.tsx`
- Delete: `src/renderer/src/components/settings-section-image-generation.test.tsx`
- Delete: `src/renderer/src/components/settings-section-media-generation.tsx`
- Delete: `src/renderer/src/components/settings-section-media-generation.test.tsx`
- Delete: `src/renderer/src/components/settings-section-speech-to-text.tsx`（F 阶段已删？确认）

- [ ] **Step 1: 确认 speech-to-text 面板状态**

Run: `ls src/renderer/src/components/settings-section-speech-to-text.tsx 2>/dev/null`
若 F 阶段未删，本步一并删。

- [ ] **Step 2: 删除文件**

```bash
rm -f src/renderer/src/components/settings-section-image-generation.tsx
rm -f src/renderer/src/components/settings-section-image-generation.test.tsx
rm -f src/renderer/src/components/settings-section-media-generation.tsx
rm -f src/renderer/src/components/settings-section-media-generation.test.tsx
rm -f src/renderer/src/components/settings-section-speech-to-text.tsx
```

- [ ] **Step 3: 删 settings-sections re-export**

修改 `src/renderer/src/components/settings-sections.tsx`，删这 3 行：
```ts
export { ImageGenerationSettingsSection } from './settings-section-image-generation'
export { MediaGenerationSettingsSection } from './settings-section-media-generation'
export { SpeechToTextSettingsSection } from './settings-section-speech-to-text'
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(settings): remove media settings panel files"
```

---

### Task E-2: 清理 SettingsView / Sidebar / 类型 / gui-update 的媒体分类

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx`
- Modify: `src/renderer/src/components/SettingsSidebar.tsx`
- Modify: `src/renderer/src/store/chat-store-types.ts`
- Modify: `src/renderer/src/components/use-settings-gui-update.ts`

- [ ] **Step 1: 删 SettingsSidebar media 分类**

修改 `src/renderer/src/components/SettingsSidebar.tsx`：
- `SettingsCategory` 类型（4）去 `'media'`。
- 删 media 按钮（60-65）。
- 删 `Clapperboard` import（若仅此处用，2 行 import 列表）。

- [ ] **Step 2: 删 SettingsView 媒体路由**

修改 `src/renderer/src/components/SettingsView.tsx`：
- 删 `MediaGenerationSettingsSection` import（61）。
- 删 category 路由：`imageGeneration/mediaGeneration/speechToText → 'media'`（292-295）。
- 删早返回 guard 里的这三项（330-332）。
- 删 `Exclude<>` 里的 `'imageGeneration' | 'mediaGeneration' | 'speechToText'`（344）。
- 删渲染分支 `{category === 'media' ? <MediaGenerationSettingsSection ctx={...}/> : null}`（1033）。

- [ ] **Step 3: 删 chat-store-types 媒体路由段**

修改 `src/renderer/src/store/chat-store-types.ts`：`SettingsRouteSection` 去 `'imageGeneration'|'mediaGeneration'|'speechToText'`（89）。

- [ ] **Step 4: 删 use-settings-gui-update 媒体映射**

修改 `src/renderer/src/components/use-settings-gui-update.ts`：删 `imageGeneration/mediaGeneration/speechToText` 的分类映射。

- [ ] **Step 5: typecheck 并清理残留**

Run: `npm run typecheck`
Expected: 可能报 `'media'` category 残留。逐一清理（grep `category === 'media'` / `setCategory('media')`）。

Run: `grep -rn "imageGeneration\|mediaGeneration\|speechToText\|'media'" src/renderer/src/components/SettingsView.tsx src/renderer/src/components/SettingsSidebar.tsx src/renderer/src/store/chat-store-types.ts`
Expected: 无输出（或仅 settings 数据字段引用，非 UI 分类）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/SettingsView.tsx src/renderer/src/components/SettingsSidebar.tsx src/renderer/src/store/chat-store-types.ts src/renderer/src/components/use-settings-gui-update.ts
git commit -m "refactor(settings): remove media category from settings navigation"
```

---

### Task E-3: 全量验证

- [ ] **Step 1: typecheck（根 + qwicks）**

Run: `npm run typecheck`
Run: `npm --prefix qwicks run typecheck`
Expected: 均无错误。

- [ ] **Step 2: 全套测试**

Run: `npm test`
Run: `npm --prefix qwicks test`
Expected: 全过。

- [ ] **Step 3: 手动验证清单**

Run: `npm run dev`，逐项确认：
- [ ] 设置侧栏**无「媒体」分类**。
- [ ] 设置 → Skills 有「内置技能配置」区块，4 个媒体 skill 各自可展开配置面板，字段齐全。
- [ ] 在图片 skill 面板填 apiKey/model，勾选 enabled，输入 `/image 一只猫`，能成功生成。
- [ ] 选 providerId 为某 provider 后，apiKey/baseUrl/model 显示只读且标注"来自供应商"。
- [ ] **麦克风按钮完全消失**（输入框旁无 Mic 图标）。
- [ ] 设置 → 供应商，选中 provider，**无「语音能力」编辑卡**。
- [ ] 首启流程不再尝试配 speech。
- [ ] TTS/音乐/视频 skill 各自可配置并生成。

- [ ] **Step 4: 最终提交（如有未提交的修复）**

```bash
git add -A
git commit -m "test: full verification of media skill config + STT removal"
```

---

## 计划级风险与执行注意事项

| 风险 | 缓解 |
|---|---|
| `SpeechToTextProtocol` 被 provider 类型引用，过早删导致级联错误 | F-3 只删 STT settings，F-4 才删 protocol 与 provider speech，顺序固定 |
| qwicks 子项目测试与根测试是两套，命令易混 | C-1 用 `npm --prefix qwicks`，其余用根 `npx vitest`/`npm test`；每任务注明命令 |
| C-4 配置面板字段读写逻辑复杂（settingsPath 解析 + enum 动态 options） | 先写 read/write helper 与单测，再接 UI；enum 动态 options 按 settingsPath 后缀判断 |
| 删媒体 UI 后用户旧配置"丢失"（视觉上） | settings 字段保留，值仍在；skill 面板从同字段读取，无缝显示 |
| 阶段顺序依赖（E 依赖 C/D） | 严格按 1→2→3→4 顺序；E-1 前确认 C-4/D-1 已合入 |

