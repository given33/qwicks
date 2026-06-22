# 桌面宠物（QQ 宠物玩法复刻）— 总体设计大纲

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-22 |
| 最后更新 | 2026-06-23 |
| 状态 | Draft（总纲，逐模块评审；本次更新大幅扩展范围） |
| 影响范围 | 全工程：新增 `src/main/pet-*`、`src/renderer-pet/`、`src/renderer-pet-console/`、`src/shared/pet-*`、`src/asset/img/pet-qq/`；改造 `src/main/index.ts`、`src/main/settings-store.ts`、`src/renderer/src/components/chat/AnimatedWorkLogo.tsx`、`src/main/ui-plugin-bundled.ts` 等；替换/删除 `src/asset/img/qwicks_*.png`、`iqwicks_*.png` |
| 关联 spec | 各模块详细实现计划独立成文 |

## 0. 这份文档是什么

这是「桌面宠物 / QQ 宠物玩法复刻」工程的**总纲**。它固化：产品功能全景、模块分解、全局架构、数据模型、素材使用策略、风险清单与验证策略。

**总纲是契约，不是某模块的实现 spec。** 每个模块（M1、M2…）在开工前各自产出独立的实现计划（模块划分、API、测试点、验收清单），挂靠到本总纲，按既定顺序逐个推进、逐个验证、逐个合入。**任一模块未通过验证，不进入下一模块。**

本工程的规模 = QQ 宠物除"2D 社区大地图"外的全部核心玩法。它**不可能一次做完**，必须按模块顺序逐步交付。

## 0.1 ⚠️ 版权声明（必读）

QQ 宠物的美术、玩法、数值是**腾讯公司的专有资产**，受版权保护。本项目对 QQ 宠物资源的使用策略（见 §7）为：
- **场景背景、道具图标、UI 装饰等静态素材**：基于手上的文件在本项目内使用。
- **角色形象主体**：使用用户自有暖黄形象，**不使用**腾讯企鹅形象。
- **动作动画、特效**：用新技术（CSS/Canvas/粒子）重新实现，**不使用**腾讯的 swf。
- **玩法规则**：参考 QQ 宠物的设计思路重新实现。

**法律风险**：若本项目作为**公开发布的产品**分发，使用腾讯专有静态素材存在侵权风险，需发布者（用户）自行评估并承担。本总纲不就版权合规性背书。作为个人自用风险较低。

## 1. 目标

把 QWicks 从「一个带吉祥物的 AI 工作流应用」升级为「桌面上活着的、需要照料、会成长、可婚育、可钓鱼种田玩小游戏的宠物伴侣」，复刻 QQ 宠物的核心体验：

- **桌面精灵**：宠物脱离软件窗口，活在桌面上，可拖拽、会无缝跨屏漫步、会撞墙、会摔倒，物理与特效全拉满。
- **拟真生命体征**：饥饿/清洁/健康/心情随时间变化，会生病、会濒死、会索求，需要玩家照料，可被还魂丹救活。
- **完整人生线**：蛋→幼年→成年，等级成长，性别，结婚生子。
- **丰富场景行为**：40-60 个随机场景行为（爬山/游泳/滑雪/上网/睡觉/看书…），宠物自己会玩。
- **副玩法**：钓鱼、农场、6 种小游戏，赚元宝和道具。
- **元系统**：Steam 式成就系统 + 宠物档案时间线日志。
- **形象统一**：用户提供的暖黄形象为全应用唯一角色形象；QQ 宠物的场景背景/道具图标作为环境素材复用；旧的两套 QWicks 美术（qwicks 鸟 / iqwicks 坤鸡）彻底移除。

## 2. 非目标（本工程不做）

- **不做 QQ 宠物的 2D 社区大地图**（粉红钻石岛 / 企鹅社区）。（用户明确排除）
- **不做联网社交裂变**（送蛋给好友、资料卡同步学历职业）。QWicks 是单机本地应用。
- **不做付费道具**（粉钻、还魂丹付费）。元宝为纯游戏内代币。
- **不复刻企鹅形象**。角色主体始终是暖黄形象。

## 3. 现状（QWicks 代码基线）

### 3.1 形象系统（要被换掉的部分）

- `src/asset/img/` 下两套美术：`qwicks_*.png`（蓝色鸟）与 `iqwicks_*.png`（橙色坤鸡），含 mascot 姿态、托盘图、app 图标。
- **UI 插件系统**（`src/shared/ui-plugin.ts`）：声明式形象插件，槽位 `swim/surf/greet/sleep/sit/run/toggleIcon`。
- **iQWicks 模式**（`iqwicks-mode.ts` + `ui-plugin-store.ts`）：激活时点亮 `data-iqwicks-mode` CSS 机制，切换整套坤鸡美术 + 橙色氛围。
- **展示载体**（全在主窗口内）：`AnimatedWorkLogo.tsx` 含 `SidebarMascot`/`AnimatedWorkLogo`/`IqwicksCameoLayer`/`QWicksCelebrationLayer`/`QWicksStateFigure`；`base-shell.css` 约 100 处 `data-iqwicks-mode` 选择器。
- **关键事实**：现有形象**全部在主窗口内渲染**。没有任何桌面悬浮透明窗口能力。这是本工程最大能力缺口。

### 3.2 窗口/进程架构（要被扩展的部分）

- 单一 `BrowserWindow`（`mainWindow`），`createWindow()` 在 `src/main/index.ts:1120`。
- `Tray` + `tray-session-menu.ts`：托盘菜单。
- 生命周期：`window-all-closed`（非 mac）→ `app.quit()`；`before-quit` 先停托管 runtime 再退出。
- `settings-store.ts`：JSON 文件（`~/.qwicks/qwicks-settings.json`），`AppSettingsV1` schema。

### 3.3 技术栈

Electron 34 + React 19 + Vite 6 + TypeScript 5 + Tailwind 3。Vitest 测试。`electron-vite` 构建。

## 4. 模块分解（本工程全部范围）

按依赖顺序排列。每个模块 = 独立实现计划 + 独立验证 + 独立合入。

| 模块 | 内容 | 依赖 | 交付物（用户可感知） |
|---|---|---|---|
| **M1 桌面精灵窗口** | 单个超大透明 always-on-top 窗口（虚拟桌面并集）+ 点击穿透切换 + 多显示器**无缝**游走（可行走图寻路）+ 后台保活（关主窗走托盘）+ 桌面感知（避让前台窗口、壁纸色采样、跟随鼠标视线） | 无 | 宠物活在桌面上、无缝跨屏漫步 |
| **M2 形象换皮** | 删除 qwicks/iqwicks 全部旧图；从用户精灵图裁切 9 姿态；全应用 ~20 处引用换新形象；保留 UI 插件/mascot 系统代码与 iQWicks 机制（双槽都指向暖黄形象）；托盘/图标一并换；**移除所有 `prefers-reduced-motion` 守卫** | M1 | 全应用只见暖黄形象，无旧形象残影 |
| **M3 物理交互** | 拖拽悬空(慌张扑腾+汗珠+尾迹) + 真实重力下坠 + 落地弹性 squash+扬尘+眩晕星+全屏震动 + 边缘撞墙 + 物理阴影 + 季节/天气/环境特效 + 待机呼吸 + 情绪表情层 + 脚印 + **常驻 rAF 物理循环** | M1 | 宠物可被抓起/会摔/会撞墙/跨屏无缝 |
| **M4 生存与照料** | 四属性(饥饿/清洁/健康/心情) + 非线性衰减 + 离线补算(8h 上限) + 疾病演变(Sick/Dying/Die) + 还魂丹复活 + 每日签到送元宝 + 右键自绘快捷菜单 + **常驻控制台面板**(独立第三窗口，6 tab：照料/库存/商店/成就/档案/设置) + 完整照料动画 + 状态气泡 + 道具经济(食物/清洁/药/玩具/还魂丹) | M1, M2 | 宠物会饿/会病/要照顾，完整照料闭环 |
| **M5 成长系统** | 蛋(Egg)→幼年(Kid)→成年(Adult) 三阶段 + 性别(GG/MM) + 等级(0-7+) + 经验 + 升级动画(LevUp) + 阶段体型/行为差异。时长用可调常量(蛋~30min/幼→成~7天)，后续按体验调 | M4 | 一条人生成长线 |
| **M6 场景行为库** | 可扩展行为库架构；首批 40-60 个随机场景行为（看书/上网/睡觉/发呆/哼歌/跳舞/玩玩具…，每个=暖黄角色+QQ 场景背景+道具+CSS动画）；执行后写档案日志。待专用帧的第二批(爬山/游泳/滑雪等)预留 | M3, M2 | "你不理它也会自己玩"，行为丰富 |
| **M7 成就系统** | Steam 式全成就：成长/照料/生存/玩耍/收集多分类；达成全屏弹窗拉满(暗化+徽章放大+光芒+音效+逐字)；成就 tab(已解锁/未解锁灰/隐藏"???"+解锁日期+总进度) | M4, M5 | 成就驱动的长期目标 |
| **M8 宠物档案** | 时间线日志(每天的行为流水带时间戳+图标)；档案 tab(按天分组可滚动)；每日摘要推送；持久化 `pet-diary.json`，保留可配天数 | M6, M4 | 宠物的"人生记录" |
| **M9 钓鱼** | 照 QQ 宠物钓鱼玩法规则实现；场景用 QQ `fishing/res/bg` 背景图 + 道具；角色用暖黄（CSS/粒子做挥竿动画，不用 swf）；赚元宝/道具 | M4, M2 | 独立副玩法 |
| **M10 农场** | 照 QQ 宠物种田玩法规则实现；场景用 QQ `farm` 背景+作物图标；角色暖黄；种收赚元宝/食材 | M4, M2 | 独立副玩法 |
| **M11 小游戏（6 种）** | 连连看(ball)/猜拳(guess)/打地鼠(mouse)/泡泡龙(paopao)/跳绳(rope)/100层(100ceng)；规则照 QQ `smallGame/*`；美术用 QQ 静态素材 + 暖黄；赚元宝/道具 | M4, M2 | 6 个独立小游戏 |
| **M12 婚育** | 成年后相亲结婚(教堂场景) + 宠物蛋繁殖（本地，蛋可"送"给另一个本地存档槽）；用 QQ 婚育场景素材 | M5, M4 | 结婚生子 |

**本次总纲覆盖范围 = M1–M12 全部。** 不含 2D 社区大地图。

> **执行策略（关键）**：虽总纲覆盖全部 12 模块，但**实现严格按 M1→M2→…→M12 顺序逐个推进**。第一个落地的实现计划**只做 M1+M2**（窗口+换皮），跑通验证后再做下一个。每个模块独立 spec/计划/验证/合入。这是对"做完全部"最负责任的执行方式，避免巨型 PR 烂尾。

## 5. 全局架构

### 5.1 进程/窗口拓扑

```
Electron 主进程 (src/main)
├─ mainWindow        （现有，AI 工作流 UI，不变）
├─ petWindow         （新增，透明 always-on-top，承载桌面宠物）       ← M1
├─ petConsoleWindow  （新增，常驻控制台面板，圆角无边框）             ← M4
├─ Tray              （现有，菜单新增宠物相关项）                      ← M1
└─ 主进程服务
   ├─ pet-window.ts          窗口生命周期/穿透切换/多屏并集/避让       ← M1
   ├─ pet-console-window.ts  控制台窗口生命周期                        ← M4
   ├─ pet-state-store.ts     宠物属性持久化(pet-state.json)            ← M4
   ├─ pet-diary-store.ts     档案日志持久化(pet-diary.json)            ← M8
   └─ settings-store.ts      （现有，AppSettingsV1 新增 pet 段）       ← M1

渲染层
├─ src/renderer/            （现有主窗口，mascot 组件换图 + 删 reduced-motion） ← M2
├─ src/renderer-pet/        （新增，桌面宠物渲染）                     ← M1/M3/M6
│  ├─ main.tsx, PetSprite.tsx, pet-physics.ts(状态机/重力/寻路/粒子)
│  ├─ PetEnvironment.tsx    季节/天气/阴影/情绪表情层                  ← M3
│  └─ PetActivityRunner.tsx 场景行为库执行器                            ← M6
├─ src/renderer-pet-console/（新增，控制台面板，6 tab）               ← M4/M7/M8
│  └─ tabs: Care/Inventory/Shop/Achievements/Diary/Settings
└─ src/renderer-minigame/   （新增，小游戏/钓鱼/农场独立渲染入口）      ← M9-M11

共享
└─ src/shared/
   ├─ pet-state.ts          宠物状态类型 + 衰减/疾病纯函数               ← M4
   ├─ pet-growth.ts         成长阶段/经验/升级纯函数                    ← M5
   ├─ pet-achievements.ts   成就触发判定纯函数                          ← M7
   ├─ pet-activities.ts     场景行为库定义                              ← M6
   ├─ pet-sprite-atlas.ts   暖黄精灵图裁切映射                          ← M2
   └─ ui-plugin.ts          （现有，槽位语义可能微调）
```

### 5.2 为什么三个独立 BrowserWindow

- `petWindow` 必须独立：主窗口崩溃/关闭/重载不能影响宠物（后台保活）。
- `petConsoleWindow` 必须独立：宠物主窗是全屏穿透的，塞复杂控制台会与漫步争渲染且穿透难处理；控制台需正常窗口行为（聚焦输入、可拖动、不穿透）。
- `renderer-minigame` 独立：小游戏/钓鱼/农场是重型场景，独立渲染隔离崩溃风险。

### 5.3 进程间通信（按模块渐进）

| 频道 | 方向 | 用途 | 模块 |
|---|---|---|---|
| `pet:set-ignore-mouse-events` | renderer-pet → main | 热区切换点击穿透 | M1 |
| `pet:visibility` | main ↔ renderer-pet | 显隐宠物 | M1 |
| `pet:state-changed` | main → 全渲染 | 属性变化推送 | M4 |
| `pet:perform-action` | console/pet → main | 喂食/洗澡/看病/摸头/玩耍 | M4 |
| `pet:buy-item` / `pet:use-item` | console → main | 商店购买/库存使用 | M4 |
| `pet:toggle-console` | any → main | 唤出/隐藏控制台 | M4 |
| `pet:diary-append` | any → main | 追加档案日志 | M6/M8 |
| `pet:achievement-unlocked` | main → 全渲染 | 成就达成广播 | M7 |
| `minigame:launch` / `minigame:result` | console → main / main → console | 启动小游戏/结算 | M9-M11 |

### 5.4 坐标系与多显示器（无缝游走）

- **虚拟桌面并集**：`screen.getAllDisplays()` 取并集矩形。petWindow 尺寸=并集，定位到并集原点。
- **可行走图（walkable graph）**：每块屏=节点；两屏 bounds 共享边则连边。寻路用图最短路径，跨不相邻屏需经中间屏中转。死区（无屏坐标）不可达，漫步目标永远落在真实屏 work area 内。
- 跨屏**连续滑过**，无淡入淡出（用户明确要无缝）。物理显示器边框缝隙是物理现实，软件无法消除，属预期行为。
- DPI：`scaleFactor` 影响物理像素，逻辑像素一致。
- `screen.on('display-metrics-changed'/'display-added'/'display-removed')` → 重算并集+可行走图+重定位宠物。

## 6. 数据模型

### 6.1 宠物核心状态（`src/shared/pet-state.ts`）

```ts
type PetVitals = { hunger: number; cleanliness: number; health: number; mood: number } // 0-100
type PetStage = 'egg' | 'kid' | 'adult'
type PetGender = 'GG' | 'MM'

type PetState = {
  vitals: PetVitals
  status: 'healthy' | 'hungry' | 'dirty' | 'sick' | 'critical' | 'collapsed'
  coins: number
  inventory: PetItem[]
  position: { x: number; y: number; displayId: number }
  facing: 'left' | 'right'
  lastTickAt: number               // 离线补算用
  growth: {
    stage: PetStage
    stageEnteredAt: number
    gender: PetGender
    level: number
    exp: number
    eggProgress?: number           // 蛋阶段 0-100
  }
  achievements: { unlocked: string[]; unlockedAt: Record<string, number> }
  marriage?: { partnerId: string; marriedAt: number; eggs: number } // M12
  // 日志单独存 pet-diary.json
}
```

### 6.2 持久化

- `~/.qwicks/pet-state.json`：状态主文件。debounce 1s 落盘；`before-quit` flush；位置节流 ~500ms。
- `~/.qwicks/pet-diary.json`：档案日志，按天组织，保留可配天数（默认 90 天）。
- **离线补算**：启动读 `lastTickAt`，按墙钟时间补算衰减，**保护上限 8h**（避免长期不开机饿死）。

### 6.3 设置项（`AppSettingsV1.pet`）

```ts
pet?: {
  enabled: boolean          // 桌面精灵总开关
  spriteScale: number       // 精灵缩放
  walkEnabled: boolean      // 随机漫步
  consoleOnLaunch: boolean  // 启动时是否自动开控制台
  diaryRetentionDays: number // 档案保留天数
  growthSpeed: number       // 成长倍率（调试用）
}
```

## 7. 素材使用策略（核心原则）

> **QQ 宠物出场景/道具/UI 美术 + 玩法设计蓝图；暖黄出角色主体；新技术出特效动画。**

| 资产类型 | 来源 | 说明 |
|---|---|---|
| 场景背景（钓鱼池/农场/地图/教堂） | ✅ QQ `png/svg` 直接用 | 导入 `src/asset/img/pet-qq/scenes/` |
| 道具/物品图标（食物/药/玩具/鱼/作物） | ✅ QQ `png/gif` 直接用 | 导入 `src/asset/img/pet-qq/items/`；食物 560/清洁 288/药 22/玩具 27 |
| UI 装饰（等级牌/进度条/按钮/边框） | ✅ QQ `png/svg` 直接用 | 导入 `src/asset/img/pet-qq/ui/`；`dengji/jindutiao` 等 |
| 角色形象主体 | ❌ 不用企鹅 | ✅ 用户暖黄形象（M2 裁切） |
| 动作动画（挥竿/吃饭/洗澡） | ❌ 不用 swf | ✅ 暖黄姿态 + 道具图层 + CSS/Canvas/粒子 |
| 特效（升级光效/达成光芒/震屏） | ❌ 不用 swf | ✅ 全新技术，特效拉满 |
| 玩法规则（钓鱼/农场/小游戏/婚育数值） | ✅ 参考规则 | 在各模块实现计划中详化 |

**技术结论**：1480 个 swf/fla/as **一个都不导入**，避开 Flash 播放风险。只用 png/gif/svg 静态素材 + 玩法规则。

**导入清单**（M2 阶段执行，按模块渐进导入）：
- `pet/img_res/{food,clean,medicine,toy}` → 道具图标
- `pet/img_res/{study,work}` → 学习/打工图标（M5 后续）
- `pet/stateInfo/{dengji,jindutiao,...}` → 等级/进度 UI
- `pet/fishing/res/bg`、`pet/farm/...` → 场景背景（M9/M10）
- `pet/smallGame/*` → 小游戏素材（M11）
- `pet/achievement/*.svg`、`pet/signIn/*` → 成就/签到 UI（M7）

## 8. 风险清单

### R1. 超大透明窗口的合成性能【M1，阻断级】
多屏并集可达 7680×2160 透明窗。集显/旧合成器可能掉帧。**验证**：M1 第一个 spike，空白透明窗+img 在双屏(含4K)+集显测帧率。**回退**：方案 B（每屏一窗）/ C（跟随窗）。用户已声明"不考虑性能"，但仍需确认不掉帧到不可用。

### R2. 点击穿透准确性【M1，阻断级】
`setIgnoreMouseEvents({forward:true})` Win/macOS 行为不同。**验证**：M1 spike，精灵可拖、本体外操作桌面正常。**缓解**：热区余量可配；macOS 用区域 API。

### R3. 后台保活与退出语义【M1，阻断级】
改 `window-all-closed`（主窗关→隐藏）。**验证**：主窗关后宠物活；托盘退出真退；`before-quit` 仍停 runtime。**缓解**：退出路径收敛两条（托盘退/before-quit）。

### R4. 换皮遗漏残留旧形象【M2，可见级】
~20 处引用 + 打包产物旧图。**验证**：删图后 `grep` 旧文件名=0；构建无旧图；肉眼无残影。**缓解**：删文件让遗漏在构建期编译失败。

### R5. 精灵图裁切映射不准【M2，可见级】
"9 行姿态"行列数需核对。**验证**：M2 dev-only 裁切预览页逐帧核对。**缓解**：坐标集中在 `pet-sprite-atlas.ts`。

### R6. 离线补算公平性【M4，体验级】
**验证**：单测覆盖 1h/8h/7d/30d 衰减结果。**缓解**：8h 上限 + 温和曲线；collapsed 可还魂丹无损恢复。

### R7. macOS 透明置顶全屏/Spaces 行为【M1，平台级】
**验证**：M1 mac 测全屏/Spaces。**缓解**：`setVisibleOnAllWorkspaces`+`visibleOnFullScreen`；不行则 mac 默认关。

### R8. 无缝跨屏的可行走图正确性【M3，阻断级】
错位多屏+死区拓扑下，路径算错会让宠物走进虚空消失。**验证**：`walkable-graph.test.ts` 覆盖错位双屏/三屏串联/死区。

### R9. 移除 reduced-motion 的无障碍影响【M2，已知】
用户明确不要降级。前庭疾病用户无法关动画。**记录**：用户已知情并选择，按用户意愿执行，不回头。

### R10. QQ 素材版权【全局，法律级】
见 §0.1。公开发布存在侵权风险，由发布者承担。

### R11. 范围过大导致烂尾【全局，工程级】
12 模块 = QQ 宠物除社区外全部玩法。**缓解**：严格按 M1→M12 顺序逐模块交付，每模块独立验证合入，首份实现计划只做 M1+M2。

## 9. 验证策略

- **单元测试**：所有纯函数（衰减/疾病/成长/成就/寻路/热区/裁切）必须有 Vitest 覆盖，沿用 `*.test.ts` 同目录惯例。
- **类型+构建**：每模块 `npm run typecheck && npm run build` 通过。
- **spike 风险验证**：R1/R2 在 M1 开头用最小代码验证。
- **手动验收清单**：每模块实现计划末尾列"用户可感知验收点"。
- **不留半成品**：任一模块未通过验证，不进入下一模块。

## 10. 模块边界与数据流总表

见 §4（模块分解）+ §5（架构）+ §6（数据模型）。各模块详细 API/数据流/测试点见各自实现计划。

**核心数据流**（跨模块）：
```
属性变化(M4) → pet-state.json → pet:state-changed 广播
  → renderer-pet: 更新情绪表情层(M3)、行为库状态(M6)
  → renderer-console: 更新仪表盘/库存(M4)、成就检测(M7)
行为执行(M6) / 照料(M4) / 小游戏结算(M9-11) → pet:diary-append → pet-diary.json
  → renderer-console 档案 tab(M8)
```

## 11. 决策记录（本次 brainstorming 全部确认）

| 决策点 | 选择 |
|---|---|
| 核心目标 | 完整 QQ 宠物复刻（除社区大地图） |
| 总纲范围 | M1–M12 全部 |
| 执行策略 | 逐模块交付，首份实现计划只做 M1+M2 |
| 形象替换 | 旧图片彻底删除；代码/UI 插件/mascot/iQWicks 机制全保留；双槽都指向暖黄形象 |
| 资产缺口 | 现有精灵图帧 + CSS/粒子补足 |
| 多显示器 | 无缝跨屏游走（可行走图寻路） |
| 生命周期 | 后台保活（隐藏主窗口+托盘，托盘退出才真退） |
| 属性衰减 | 实时 + 离线补算（8h 上限） |
| P3 深度 | 含完整照料闭环 |
| 窗口方案 | 方案 A：单个超大透明窗口 |
| 跨屏 | 无缝（不用淡入淡出） |
| 动画特效 | 全拉满，不考虑性能 |
| 季节/天气/桌面互动 | 加入（M3 环境特效层） |
| reduced-motion | 完全移除，不降级 |
| 控制台 | 独立第三 BrowserWindow，6 tab，自绘 UI（非原生 Menu） |
| 成长阶段 | 蛋/幼年/成年 + 性别 + 等级，时长用可调常量 |
| 成就 | Steam 式，达成全屏弹窗拉满 |
| 档案 | 时间线日志 + 每日摘要 |
| 场景行为 | 可扩展库，首批 40-60 个 |
| 素材策略 | QQ 出场景/道具/UI + 玩法蓝图；暖黄出角色；新技术出特效；swf 不用 |
| 版权 | 用户知情，公开发布风险自担（§0.1） |

## 12. 未决问题（各模块实现计划中各自澄清，不阻塞 M1/M2）

1. M5 成长时长的精确数值（平衡性测试后定）。
2. M7 成就完整清单与触发阈值。
3. M9-M11 钓鱼/农场/各小游戏的精确规则与数值（照 QQ 实现，各自细化）。
4. M12 婚育的"送蛋给另一本地存档"如何实现（多存档槽设计）。
5. M6 第二批专用帧场景行为（爬山/游泳/滑雪）的资产来源。

---

*本文档为总纲。下一份文档为 M1+M2 的详细实现计划（`writing-plans` 产出），展开桌面精灵窗口与形象换皮的模块设计、API、测试与验收清单。*
