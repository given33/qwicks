# 工作流渐进式折叠（L2 按工具类型分组）— 设计文档

- 日期: 2026-06-25
- 目标: 把工作流时间线的 L2（执行流层）从「时序混合分组 + 串接文案」改造为「按工具类型分组 + 图标 + 计数文案 + 状态/时长徽标」，对标 Codex 的渐进式信息暴露。

---

## 一、背景与已确认决策

经探查，三层渐进式折叠的**骨架已存在**，本次是改造 L2 的分组逻辑，而非从零搭建：

| 层 | 现有组件 | 现状 | 本次改动 |
|---|---|---|---|
| L1 结果层 | `WorkMetaRow`（`message-timeline-cards.tsx:323`） | ✅ turn 级「已处理 44m 26s >」折叠 | 基本不动 |
| L2 执行流层 | `groupProcessSections` + `ProcessSectionRow`（`message-timeline-process.tsx:23,109`） | ⚠️ 连续工具合并成**一个** execution section + 「· A · B · C」串接文案 | **核心改造**：按工具类型分组 |
| L3 原始日志层 | `ProcessEntryRow` / `ProcessStackRows`（`:275,390`） | ✅ 单步折叠，展开看命令 + 输出 | 加状态/时长徽标 |

### 已确认的用户决策
1. **核心改进**：L2 按类型分组 + L2 图标文案优化 + 加时长/状态徽标（三项全选）。
2. **默认折叠行为**：保持现有（处理中/有错误自动展开，否则默认折叠），不调整。
3. **分组粒度**：方案 A，按工具类型拆多个节点，**保留时序顺序**（连续同类合并、不同类型分开）。
4. **分组类目**：底层 `meta.toolName` **映射到 7 个语义大类**作为分组键，不原样用 toolName。
5. **碎节点处理**：严格按 toolName（映射后的大类）——`read→read→edit→read` = 3 个节点。

---

## 二、L2 分组逻辑（核心）

### 2.1 七个语义大类（toolName → 类别映射）

新纯函数 `classifyToolCategory(toolName, meta)`，放 `message-timeline-process.tsx`，与现有 `builtInToolLabel` 相邻：

| 类别 id | 图标 (lucide) | 包含的 toolName | 折叠文案（N=计数） |
|---|---|---|---|
| `terminal` | `Terminal` | bash, shell, exec, run | 运行了 N 条命令 |
| `search` | `SearchCode` | grep, find, rg, search | 搜索了 N 次 |
| `read` | `FileText` | read, read_file, ls, list, cat | 读取了 N 个文件 |
| `edit` | `FileEdit` | edit, edit_file, patch | 修改了 N 个文件 |
| `write` | `FilePlus` | write, write_file, create | 写入了 N 个文件 |
| `web` | `Globe` | web_search, web_fetch, fetch（含 sources） | 搜索了 N 个网页 |
| `other` | `Wrench` | 其余所有 | 调用了 N 次工具（复用现有 groupUsedTool） |

映射表集中一处，`other` 兜底，新工具不会漏。

### 2.2 分组算法（改造 `groupProcessSections`）

- **现状**：连续工具块合并成**一个** execution section。
- **改造后**：遍历 process blocks，按 toolName 大类断段：
  - 连续**同大类**的 tool 块 → 合并进同一节点（3 个连续 read → 一个 `read` 节点，计数 3）。
  - 下个块是**不同大类**（或非 tool 块如 reasoning）→ 当前节点收尾，开新节点。
  - `read→read→edit→read` = 3 个 execution section：`read`(2)、`edit`(1)、`read`(1)，保留时序。
- reasoning / output section 逻辑不变。

### 2.3 数据结构

`ProcessSection` 扩展一个可选字段：
```ts
type ProcessSection = {
  kind: 'reasoning' | 'execution' | 'output'
  blocks: ChatBlock[]
  /** execution section 的语义类别（仅 kind==='execution' 时有意义）。 */
  category?: ToolCategory
}
```

---

## 三、徽标显示规则（核心，按状态 + 类型）

**核心原则：运行中显示持续时间，结束后显示结果状态。** 复用 `MessageTimeline` 现有的 1 秒 `setInterval` tick，让运行中徽标实时更新。

### 3.1 L2 组节点徽标（右侧）

| 组状态 | 显示 |
|---|---|
| 组内有**正在运行**的工具 | 持续时间（实时跳动，如「12s」「2m 3s」） |
| 组内**全部结束**且**有失败** | 「执行失败」红色，不显示总时长 |
| 组内**全部结束**且**全成功** | 不显示（保持干净） |

### 3.2 L3 单步徽标（按工具类型差异化）

**终端命令类（terminal）**：
- 运行中 → 持续时间（如「12s」）
- 结束 → 退出状态：「成功」(exit 0 绿) 或「退出码 N」(非 0 红)，**不显示时长**

**其他工具类（read/edit/write/search/web/other）**：
- 运行中 → 持续时间（如「1.2s」）
- 成功 → 不显示
- 失败 → 「执行失败」红色

---

## 四、L2 节点渲染（`ProcessSectionRow` 改造）

每个 execution section 节点：
- **图标**：按 `category` 取 lucide 图标（Terminal/SearchCode/FileText/FileEdit/FilePlus/Globe/Wrench）。
- **折叠态文案**：按 category 计数模板（§2.1），不再用「· A · B · C」串接。
- **徽标**：§3.1 规则。
- **折叠箭头**：保持现有 chevron + `userExpanded` 逻辑。
- **展开**：现有 `ProcessStackRows` 列出每个单步。

---

## 五、L3 单步增强（`ProcessEntryRow`）

- 保持现有图标 + 一句话摘要（`summarizeToolBlock`）。
- **新增徽标**：§3.2 规则。
- 展开内容不变（命令 + 原始输出 `<pre>` / DiffView）。

---

## 六、时长计算

- **单步时长**：从 `meta.started_at` / `meta.finished_at` 计算（mapper 已透传，`COMMAND_RESULT_META_KEYS` 含这两个字段）。新 helper `toolDurationMs(meta)`。
- **组时长（运行中）**：组内正在运行的块，从 `started_at` 累计到 `now`。
- **注意**：`duration_ms` 字段 mapper 不写，一律用 started_at/finished_at 差值。非命令类工具可能无时间戳 → 该块时长记 0，不影响。
- **退出码**：`meta.exit_code`（command_execution 类有）。

---

## 七、保持不变

- **L1 `WorkMetaRow`**：turn 级「已处理 Xm Ys」+ 总折叠，不动。
- **默认折叠行为**：保持现有（处理中/有错误自动展开，否则默认折叠）。
- **reasoning / output section**：不动。
- **turn 切分**（`groupTurns` / `deriveTurnSections`）：不动。
- **独立工具块 `ToolEntry`**（气泡路径，罕见）：不动。

---

## 八、i18n

`locales/{en,zh}/common.json` 现有 `group*` 块附近新增：
```
groupTerminal: 运行了 {{count}} 条命令 / Ran {{count}} command(s)
groupSearch:   搜索了 {{count}} 次        / Searched {{count}} time(s)
groupRead:     读取了 {{count}} 个文件     / Read {{count}} file(s)
groupEdit:     修改了 {{count}} 个文件     / Edited {{count}} file(s)
groupWrite:    写入了 {{count}} 个文件     / Wrote {{count}} file(s)
groupWeb:      搜索了 {{count}} 个网页     / Searched {{count}} web page(s)
execFailed:    执行失败                    / Failed
execExitCode:  退出码 {{code}}             / Exit {{code}}
execSuccess:   成功                        / Success
```
（`groupOther` 复用现有 `groupUsedTool`。）

---

## 九、测试

- `MessageTimeline.tool-summary.test.ts`：现有「Used 2 tools」断言因分组变化需更新为按类别的断言。
- 新增 `classifyToolCategory` 单测（纯函数，toolName → 类别）。
- 新增 `toolDurationMs` 单测（started_at/finished_at 差值，缺字段返回 0）。
- 改造 `groupProcessSections` 测试：`read→read→edit→read` → 3 个 execution section。

---

## 十、实施顺序

1. 新增 `classifyToolCategory` + `toolDurationMs` 纯函数 + 单测。
2. 改造 `groupProcessSections`（按类别断段）+ 扩展 `ProcessSection.category` + 测试。
3. 改造 `ProcessSectionRow`（图标 + 文案 + L2 徽标）。
4. 改造 `ProcessEntryRow`（L3 徽标，按类型差异化）。
5. 接入 `MessageTimeline` 的 1s tick，让运行中徽标实时更新。
6. i18n 新增键（中英）。
7. 更新 `MessageTimeline.tool-summary.test.ts` + typecheck + test。

---

## 十一、风险与边界

| 风险 | 缓解 |
|---|---|
| toolName 大类映射不全（新工具） | `other` 兜底；映射表集中一处易扩展 |
| 非命令类工具无 started_at/finished_at | 时长记 0，徽标缺失不报错 |
| 现有 tool-summary 测试断言变化 | 同步更新，不算回归 |
| 1s tick 性能（多个运行中工具） | 复用现有 tick，不新增定时器 |

---

## 十二、待实现时确认的细节

- L3 单步时长精度（运行中显示「12s」整数秒 / 还是「1.2s」带小数）—— 终端类用整数秒更自然，其他类可带 1 位小数。
- `web` 类的判定：仅当 `meta.toolName` 命中 web_search/web_fetch，或任何有 `meta.sources` 的工具都算？倾向前者（显式 toolName）。
