# 桌面宠物（QQ 宠物玩法复刻）— 总体设计大纲

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-22 |
| 状态 | Draft（总纲，逐阶段评审） |
| 影响范围 | 全工程：新增 `src/main/pet-*`、`src/renderer-pet/`、`src/shared/pet-*`；改造 `src/main/index.ts`、`src/main/settings-store.ts`、`src/renderer/src/components/chat/AnimatedWorkLogo.tsx`、`src/main/ui-plugin-bundled.ts` 等；替换/删除 `src/asset/img/qwicks_*.png`、`iqwicks_*.png` |
| 关联 spec | 各阶段详细 spec 将分别独立成文：`2026-06-22-desktop-pet-phase1.md` 等 |

## 0. 这份文档是什么

这是「桌面宠物 / QQ 宠物玩法复刻」工程的**总纲**。它固化：整个产品的功能全景、阶段分解、全局架构、模块边界、数据模型、风险清单与验证策略。

**它不是某一阶段的实现 spec。** 每个阶段（P1、P2…）在开工前会各自产出一份独立的详细 spec（模块划分、API、测试点），挂靠到本总纲。本总纲一旦定稿，各阶段按既定顺序推进，互相不阻塞、可独立验证交付。

QQ 宠物是一个由 6+ 个相对独立子系统组成的庞大系统，不可能塞进单次实现。本总纲的第一要务是**把它拆成可独立交付的阶段**。

---

## 1. 目标

把 QWicks 从「一个带吉祥物的 AI 工作流应用」升级为「桌面上活着的、需要照料、会成长的宠物伴侣」，复刻 QQ 宠物的核心体验：

- **桌面精灵**：宠物脱离软件窗口，活在 Windows/macOS 桌面上，可拖拽、会漫步、会撞墙、会摔倒。
- **拟真生命体征**：饥饿、清洁、健康、心情随时间变化，会生病、会索求、会"倒下"，需要玩家照料。
- **完整人生线**：教育、打工、婚育、社区小游戏（后续阶段）。
- **形象统一**：用户提供的暖黄色 Q 版形象（一张 9 行精灵图）成为全应用唯一默认形象，旧的两套美术（qwicks 鸟 / iqwicks 坤鸡）彻底移除。

## 2. 非目标（本工程不做）

- 不做 QQ 宠物原版的**社交裂变**（宠物蛋送 QQ 好友、资料卡同步展示学历职业）。QWicks 是单机本地应用，没有好友社交图谱。
- 不做**付费**（还魂丹、粉红钻石等付费道具）。本地应用，元宝为纯游戏内代币。
- 不做**联网对战的社区小游戏**。P7 的社区/小游戏是单机离线玩法。
- 不复刻 QQ 宠物的**美术风格**。用用户提供的暖黄形象，不复刻企鹅。

## 3. 现状（QWicks 代码基线）

### 3.1 形象系统（要被换掉的部分）

- `src/asset/img/` 下有两套美术：
  - `qwicks_*.png`（蓝色鸟）：`bird/greet/sit/sleep/surf` + `qwicks.png`/`qwicks_mac.png`/`qwicks_tray.png`/`qwicks-icon-transparent.png`
  - `iqwicks_*.png`（橙色坤鸡）：`iqwicks.png`/`iqwicks_run.png`/`iqwicks_boba.png`/`iqwicks_wave.png`/`iqwicks_sleep.png`/`iqwicks_stand.png`
- **UI 插件系统**（`src/shared/ui-plugin.ts`）：声明式形象插件，纯图片 + manifest，禁止 JS/CSS 执行。槽位：`swim/surf/greet/sleep/sit/run/toggleIcon`。
- **预装插件**（`src/main/ui-plugin-bundled.ts`）：`iqwicks` 作为示例插件首次启动播种到 `~/.qwicks/ui-plugins/iqwicks/`。
- **iQWicks 模式**（`src/renderer/src/lib/iqwicks-mode.ts` + `ui-plugin-store.ts`）：激活 `iqwicks` 插件时点亮 `data-iqwicks-mode` CSS 机制，切换整套坤鸡美术 + 橙色氛围。
- **展示载体**（全部在主窗口内）：
  - `AnimatedWorkLogo.tsx`：侧边栏吉祥物 `SidebarMascot`、工作动画 `AnimatedWorkLogo`、彩蛋 `IqwicksCameoLayer`、庆祝 `QWicksCelebrationLayer`、状态图 `QWicksStateFigure`。
  - `base-shell.css`：约 100 处 `data-iqwicks-mode` / `ds-iqwicks-*` 选择器与 keyframes。
- **托盘/图标**（`src/main/index.ts` + `app-icon.ts`）：`qwicks_tray.png`/`qwicks_mac.png` 用于托盘与窗口图标。

**关键事实**：现有形象**全部在主窗口内渲染**。没有任何"桌面悬浮透明窗口"能力。这是本工程最大的能力缺口。

### 3.2 窗口/进程架构（要被扩展的部分）

- 单一 `BrowserWindow`（`mainWindow`），`createWindow()` 在 `src/main/index.ts:1120`。
- `Tray` + `tray-session-menu.ts`：托盘菜单，含会话列表 / 新建 / 打开 / 退出。
- 生命周期：`window-all-closed`（非 mac）→ `app.quit()`；`before-quit` 先停托管 runtime 再退出。
- `settings-store.ts`：JSON 文件（`~/.qwicks/qwicks-settings.json`），`AppSettingsV1` schema，electron-store 风格的读写 + 迁移。

### 3.3 技术栈

Electron 34 + React 19 + Vite 6 + TypeScript 5 + Tailwind 3。测试用 Vitest。`electron-vite` 构建。

---

## 4. 阶段分解（P1–P8）

每个阶段 = 一份独立 spec → 一份实现计划 → 实现 → 验证 → 合入。阶段间有依赖，但每阶段结束都能交付一个"活着的"增量。

| 阶段 | 内容 | 依赖 | 交付物（用户能感知的） |
|---|---|---|---|
| **P1 地基 + 换皮** | 桌面透明 always-on-top 窗口 + 点击穿透 + 多显示器游走（当前屏内）+ 后台保活 + 删除旧美术、全应用换成新形象 | — | 宠物活在桌面上、会漫步；旧形象全部消失 |
| **P2 物理交互** | 拖拽悬空(扑腾) + 松手屁股着地 + 屏幕边缘撞墙 + 跨屏游走 | P1 | 能抓起来、会摔、会撞墙、会跨屏 |
| **P3 生存系统** | 四属性(饥饿/清洁/健康/心情) + 实时衰减 + 离线补算 + 疾病演变 + 状态气泡 + 右键菜单 + 元宝 + 喂食/洗澡/看病/买药/还魂丹复活 | P1 | 宠物会饿、会病、要你照顾 |
| **P4 成长** | 等级/经验 + 智力/魅力/武力 + 学校(幼儿园→大学→考研) + 打工(建筑工→医生→总裁) | P3 | 一条人生成长线 |
| **P5 婚育** | 成年 + 相亲结婚(教堂) + 宠物蛋繁殖（本地，蛋可"送给"另一个本地存档） | P4 | 结婚生子 |
| **P6 社区小游戏** | 2D 大地图社区 + 黄金矿工/连连看/答题等单机小游戏赚道具 | P4 | 独立玩法副系统 |
| **P7 随机事件** | 跳绳/打太极/看书/无故摔倒/感冒打喷嚏震屏 | P2 | "你不理它也会自己玩" |
| **P8 打磨** | 设置面板、性能优化、可访问性、国际化、P2 专用姿态美术补齐 | 全部 | 发布级 |

**本次 brainstorming 已确认的本次范围 = P1 + P2 + P3**（用户选择合并）。P4 之后留待后续。

> **P1–P3 的内部模块映射**：本总纲定 4 个模块。P1 模块 M1（窗口）、M2（换皮）；P2 = M3（物理）；P3 = M4（生存）。详见各模块章节。

---

## 5. 全局架构

### 5.1 进程/窗口拓扑

```
Electron 主进程 (src/main)
├─ mainWindow        （现有，AI 工作流 UI，不变）
├─ petWindow         （新增，透明 always-on-top，承载桌面宠物）   ← M1
├─ Tray              （现有，菜单新增"显示/隐藏桌面宠物"等项）    ← M1
└─ 主进程服务
   ├─ pet-window.ts          窗口生命周期、穿透切换、多屏并集         ← M1
   ├─ pet-state-store.ts     宠物属性持久化（JSON，挂 settings 旁）   ← M4
   └─ settings-store.ts      （现有，AppSettingsV1 新增 pet 段）      ← M1

渲染层
├─ src/renderer/      （现有主窗口，mascot 相关组件换图）          ← M2
└─ src/renderer-pet/  （新增独立入口，宠物专属渲染）                ← M1
   ├─ main.tsx                独立 React 挂载
   ├─ PetSprite.tsx           精灵图裁切 + 姿态切换
   ├─ pet-physics.ts          漫步/拖拽/重力                         ← M3 扩展
   ├─ PetBubble.tsx           状态气泡                              ← M4
   └─ PetStateContext.tsx     属性状态（与主进程 store 同步）        ← M4

共享
└─ src/shared/
   ├─ pet-state.ts            宠物状态类型 + 衰减/疾病纯函数          ← M4
   ├─ pet-sprite-atlas.ts     精灵图裁切映射（行→姿态）              ← M2
   └─ ui-plugin.ts            （现有，槽位语义可能微调）
```

### 5.2 为什么 petWindow 是独立 BrowserWindow + 独立 renderer

- 主窗口可能崩溃/重载/被用户关闭，宠物必须独立存活（后台保活需求）。
- 宠物渲染（物理、姿态机、气泡）与主应用（chat/工作流）领域完全无关，混在一起会让两边都臃肿、且宠物会被主窗口的 React 树拖累性能。
- 独立入口 = 独立打包 chunk、独立加载、独立崩溃隔离。

### 5.3 进程间通信

`mainWindow` ↔ `petWindow` 通过 `ipcMain`/`ipcRenderer`，主进程中转。P1–P3 所需 IPC 频道：

| 频道 | 方向 | 用途 | 阶段 |
|---|---|---|---|
| `pet:set-ignore-mouse-events` | renderer-pet → main | 热区切换点击穿透 | P1 |
| `pet:visibility` | main ↔ renderer-pet | 显隐宠物 | P1 |
| `pet:state-changed` | main → renderer-pet | 属性变化推送 | P3 |
| `pet:perform-action` | renderer-pet → main | 喂食/洗澡/看病等照料动作 | P3 |
| `pet:balance-changed` | main → renderer-pet | 元宝变化 | P3 |
| `pet:request-tray-menu` | renderer-pet → main | 右键唤出原生菜单 | P3 |

### 5.4 坐标系与多显示器

- **虚拟桌面并集**：`screen.getAllDisplays()` 取所有 display bounds 的并集矩形 `(x=min, y=min, w, h)`。petWindow 尺寸 = 并集，定位到并集原点（x/y 可能为负，跨屏在左/上方时）。
- 宠物在"逻辑像素"连续坐标空间移动；渲染时 `displayPosition = petPosition - unionOrigin`。
- DPI：`display.scaleFactor` 仅影响物理像素，逻辑像素一致，移动速度按逻辑像素处理。
- 变化响应：`screen.on('display-metrics-changed')` / `'display-added'` / `'display-removed'` → 重算并集 + 重定位宠物到合法 work area 内。

---

## 6. 数据模型

### 6.1 宠物核心状态（`src/shared/pet-state.ts`，P3 定义，P1 占位）

```ts
type PetVitals = {
  hunger: number       // 0-100, 100=饱, 随时间↓
  cleanliness: number  // 0-100, 100=干净, 随时间↓
  health: number       // 0-100, 100=健康; 饥饿/脏到阈值↓或随机感染↓
  mood: number         // 0-100, 100=开心; 受上述三项影响
}

type PetStatus = 'healthy' | 'hungry' | 'dirty' | 'sick' | 'critical' | 'collapsed'
// collapsed = 倒下,需还魂丹

type PetState = {
  vitals: PetVitals
  status: PetStatus
  coins: number          // 元宝
  inventory: PetItem[]   // 食物/药品/洗浴等
  position: { x: number; y: number; displayId: number }  // 虚拟桌面坐标
  facing: 'left' | 'right'
  lastTickAt: number     // ISO 时间戳,离线补算用
  // P4+: level, exp, stats, education, job, marriage ...
}
```

### 6.2 持久化

- `~/.qwicks/pet-state.json`（独立文件，不混入 settings，避免高频写放大）。
- 写策略：属性变化时 debounce 1s 落盘；`before-quit` 强制 flush；位置变化节流落盘（~500ms）。
- **离线补算**：启动时读 `lastTickAt`，按经过墙钟时间补算衰减，但设**保护上限**（如离线超过 8 小时按 8 小时算），避免长期不开机回来发现宠物饿死。

### 6.3 设置项（`AppSettingsV1.pet`，P1 新增）

```ts
pet?: {
  enabled: boolean        // 桌面精灵总开关,默认 true
  spriteScale: number     // 精灵缩放,默认 1.0
  walkEnabled: boolean    // 随机漫步,默认 true
}
```

---

## 7. 风险清单（全局）

按严重度排序。每条风险都对应一个**验证时机**（在哪个阶段、用什么 spike 验证）。

### R1. 超大透明窗口的合成性能【P1，阻断级】

- **风险**：petWindow 尺寸 = 多屏并集，双 4K 屏可达 7680×2160 透明窗。集显/旧合成器上帧率掉到个位数、或整窗闪烁。
- **验证**：P1 第一个 spike——空白透明窗 + 一个 `<img>`，在双屏（含 4K）+ 集显机器上测帧率与合成延迟。
- **缓解/回退**：若掉帧，回退到方案 B（每屏一窗）或方案 C（精灵大小跟随窗口）。spec 写明三种方案的切换点。

### R2. 点击穿透准确性【P1，阻断级】

- **风险**：`setIgnoreMouseEvents` 的 `{forward:true}` 在 Windows/macOS 行为不一致；精灵边界热区检测不准会导致"点不到宠物"或"宠物区域挡住桌面操作"。
- **验证**：P1 spike——精灵本体可拖拽、本体外的鼠标操作桌面图标正常。
- **缓解**：热区外扩余量可配；macOS 用 `setIgnoreMouseEvents` 的区域 API 替代全窗切换。

### R3. 后台保活与现有退出语义冲突【P1，阻断级】

- **风险**：改造 `window-all-closed`（主窗关→隐藏而非退出）若出错，会导致 app 关不掉、或意外退出丢失宠物状态。
- **验证**：P1 集成测试——主窗关后宠物仍活；托盘"退出"真退；`before-quit` 仍能停 runtime。
- **缓解**：退出路径收敛为两条（托盘退出 / `before-quit`），其余一律不退。

### R4. 换皮遗漏导致残留旧形象【P1，可见级】

- **风险**：~20 处引用旧美术，漏改一处就会出现"鸟/坤鸡"残影。打包后的 `app.asar.unpacked` 旧图也需清理。
- **验证**：P1 全量 `grep` 旧文件名 = 0 命中；构建产物无旧图；启动后全应用肉眼无旧形象。
- **缓解**：删除图片文件而非仅取消引用（用户明确要求），让任何遗漏引用在构建期就编译失败暴露。

### R5. 精灵图裁切的姿态映射不准【P1，可见级】

- **风险**：AI 分析的"9 行姿态"行列数可能不准，裁错行 → 漫步时显示睡觉帧。
- **验证**：P1 写一个裁切预览页（dev only），逐帧肉眼核对每个槽位。
- **缓解**：裁切坐标集中在 `pet-sprite-atlas.ts` 一个文件，易调。

### R6. 离线补算的公平性【P3，体验级】

- **风险**：补算过狠 → 用户出差一周回来宠物饿死，劝退；补算过轻 → 属性无意义。
- **验证**：P3 单测覆盖 1h/8h/7d/30d 离线场景的衰减结果。
- **缓解**：保护上限 + 默认温和衰减曲线；collapsed 可用还魂丹无损恢复。

### R7. macOS 透明置顶窗的全屏/Spaces 行为【P1，平台级】

- **风险**：macOS 上 always-on-top + 全屏应用 + 多 Spaces 行为与 Windows 差异大，可能宠物不显示或挡全屏。
- **验证**：P1 在 mac 上测全屏视频/Spaces 切换。
- **缓解**：`setVisibleOnAllWorkspaces` + `visibleOnFullScreen`；不行则 mac 上默认 `pet.enabled=false`。

### R8. 主窗口 mascot 系统与新形象的语义错位【P1，可见级】

- **风险**：保留的 iQWicks 模式/CSS 机制是为"坤鸡"设计的（橙色氛围、运球/快攻/喝奶茶），换上新形象后这些语义可能不搭。
- **验证**：P1 换皮后主窗口 mascot/彩蛋视觉自检。
- **缓解**：M2 阶段决定保留还是简化 iQWicks 模式（见 §9 未决问题）。

---

## 8. 验证策略

- **单元测试**：所有纯函数（衰减、疾病演变、裁切映射、并集计算、热区检测）必须有 Vitest 覆盖，沿用仓库现有 `*.test.ts` 同文件目录惯例。
- **类型 + 构建**：每阶段 `npm run typecheck && npm run build` 通过。
- **spike 风险验证**：R1/R2 在 P1 开头用最小代码验证，不通过则调整方案再继续。
- **手动验收清单**：每阶段在 spec 末尾列出"用户能感知的验收点"，逐项核对。
- **不留半成品**：任一阶段未通过验证，不进入下一阶段。

---

## 9. 未决问题（待后续澄清，不阻塞 P1 开工）

1. **iQWicks 模式的去留**：换皮后是否保留"可切换的 iQWicks 模式"概念？还是简化为单一形象？（P1 的 M2 阶段会专门澄清。）
2. **元宝初始值与获取**（P3/P4）：P3 闭环保活，初始元宝够买基础食物；打工赚元宝在 P4。
3. **宠物命名/性别**：P3 是否支持给宠物起名？
4. **P2 专用姿态美术**：P2 物理交互的扑腾/摔倒/撞墙，长期是否补专用帧（短期用现有帧近似 + CSS）。
5. **托盘图是否也换新形象**：`qwicks_tray.png`/`qwicks_mac.png` 是否一并替换。

---

## 10. 模块边界总表（P1–P3）

| 模块 | 阶段 | 核心文件 | 依赖 |
|---|---|---|---|
| **M1 桌面精灵窗口** | P1 | `src/main/pet-window.ts`、`src/renderer-pet/`、改 `index.ts`、`settings-store.ts` | 无 |
| **M2 形象换皮** | P1 | `src/shared/pet-sprite-atlas.ts`、改 `AnimatedWorkLogo.tsx`、`ui-plugin-bundled.ts`、删 `asset/img/qwicks_*.png`+`iqwicks_*.png` | M1（宠物窗口用新形象） |
| **M3 物理交互** | P2 | `src/renderer-pet/pet-physics.ts`（扩展） | M1 |
| **M4 生存系统** | P3 | `src/shared/pet-state.ts`、`src/main/pet-state-store.ts`、`src/renderer-pet/PetBubble.tsx`、右键菜单 | M1 |

各模块的详细设计（API、数据流、测试点）见各阶段独立 spec。

---

## 11. 决策记录（本次 brainstorming 已确认）

| 决策点 | 选择 |
|---|---|
| 核心目标 | 完整 QQ 宠物复刻（分阶段） |
| 本次范围 | P1 + P2 + P3 合并 |
| 形象替换 | 旧图片文件彻底删除；代码/UI 插件/mascot 系统保留；全应用引用点改新形象 |
| 资产缺口 | 用现有精灵图帧近似 + CSS 动画补足 |
| 多显示器 | 支持游走（P1 当前屏内，跨屏留 P2） |
| 生命周期 | 后台保活（关主窗走托盘，托盘退出才真退） |
| 保活实现 | 隐藏主窗口 + 托盘（不开独立进程） |
| 属性衰减 | 运行时实时 + 离线补算（有保护上限） |
| P3 深度 | 含完整照料闭环（吞并 P4 的喂食/洗澡/看病/还魂丹，不含教育/打工） |
| 窗口方案 | 方案 A：单个超大透明窗口（虚拟桌面并集） |

---

*本文档为总纲。下一份文档为 P1 详细 spec（`2026-06-22-desktop-pet-phase1.md`），展开 M1/M2 的模块设计、API、测试与验收清单。*
