# 桌面宠物（QQ 宠物玩法复刻）— 总开发任务书

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-22 |
| 最后更新 | 2026-06-23 |
| 状态 | Draft — 待用户批准后按 M1→M12 顺序执行 |
| 执行方式 | 文档定稿后，从 M1 任务 1 开始顺序实际写代码完成，直到 M12。每个任务完成后验证（typecheck/test/build），通过再进下一个 |

## 0. 前置说明

### 0.1 这份文档是什么

这是「桌面宠物 / QQ 宠物玩法复刻」工程的**唯一总任务书**。M1–M12 全部 12 个模块的开发任务、每个任务的文件改动、实现思路、测试点、验收标准都写在这里。**不另开子 spec。**

批准后，按 M1 任务 1 → M1 任务 2 → … → M12 最后一个任务的顺序实际写代码完成。每完成一个任务做验证（`typecheck`/`test`/`build`），通过才进下一个；不通过则修复直到通过。

### 0.2 ⚠️ 版权声明

QQ 宠物的美术/玩法/数值是腾讯专有资产。本工程的素材策略（§7）：
- 场景背景、道具图标、UI 装饰等**静态素材**：在本项目内使用。
- **角色形象主体**：用用户自有暖黄形象，不用企鹅。
- **动作动画/特效**：用新技术（CSS/Canvas/粒子）重做，不用 swf。
- **玩法规则**：参考 QQ 宠物思路重新实现。

若公开发布，使用腾讯专有静态素材存在侵权风险，由发布者自担。

### 0.3 技术栈

Electron 34 + React 19 + Vite 6 + TypeScript 5 + Tailwind 3 + Vitest。`electron-vite` 构建。代码约定沿用现有仓库（`*.test.ts` 同目录、纯函数提取可单测、中文注释说明 why）。

### 0.4 全局原则（适用于所有模块）

- **特效全拉满**：物理/粒子/光效做到逼真丰富，不考虑性能开销（用户明确）。但工程卫生仍做（粒子对象池防 GC）。
- **不降级**：移除所有 `prefers-reduced-motion` 守卫，动画无条件全开（R9，用户已知情）。
- **暖黄形象统一**：角色主体始终是用户上传的暖黄形象，企鹅 swf 形象绝不进产品。
- **swf 绝不导入**：1480 个 swf/fla/as 一个都不用，只用 png/gif/svg + 玩法规则。
- **纯函数优先**：所有可测逻辑（衰减/疾病/成长/成就/寻路/裁切）抽纯函数 + Vitest 覆盖。

---

## §1 目标与非目标

### 1.1 目标

把 QWicks 升级为桌面上活着的宠物伴侣，复刻 QQ 宠物除 2D 社区大地图外的全部核心玩法：桌面精灵、物理交互、生存照料、成长、随机场景行为、成就、档案、钓鱼、农场、小游戏、婚育。

### 1.2 非目标

- 不做 QQ 宠物 2D 社区大地图（粉红钻石岛）。
- 不做联网社交裂变（送蛋给好友、资料卡同步）。QWicks 单机本地。
- 不做付费道具。元宝纯游戏内代币。
- 不复刻企鹅形象。

---

## §2 现状（QWicks 代码基线）

### 2.1 形象系统（M2 要换掉）
- `src/asset/img/qwicks_*.png`（蓝鸟）+ `iqwicks_*.png`（橙坤鸡）：mascot 姿态 + 托盘图 + app 图标。
- UI 插件系统 `src/shared/ui-plugin.ts`：槽位 `swim/surf/greet/sleep/sit/run/toggleIcon`。
- iQWicks 模式 `iqwicks-mode.ts` + `ui-plugin-store.ts`：激活时点亮 `data-iqwicks-mode` CSS。
- 展示载体 `AnimatedWorkLogo.tsx`：`SidebarMascot`/`AnimatedWorkLogo`/`IqwicksCameoLayer`/`QWicksCelebrationLayer`/`QWicksStateFigure`。`base-shell.css` 约 100 处 `data-iqwicks-mode` 选择器。
- **现状结论**：形象全在主窗口内，无桌面悬浮透明窗口能力。

### 2.2 窗口/进程（M1 要扩展）
- 单 `BrowserWindow`（`mainWindow`），`createWindow()` 在 `src/main/index.ts:1120`。
- `Tray` + `tray-session-menu.ts`。
- 生命周期：`window-all-closed`（非 mac）→ `app.quit()`；`before-quit` 停 runtime。
- `settings-store.ts`：JSON `~/.qwicks/qwicks-settings.json`，`AppSettingsV1`。

---

## §3 全局架构

### 3.1 进程/窗口拓扑

```
Electron 主进程 (src/main)
├─ mainWindow            （现有，AI 工作流 UI，不变）
├─ petWindow             （M1 新增，透明 always-on-top，承载桌面宠物）
├─ petConsoleWindow      （M4 新增，常驻控制台面板，圆角无边框）
├─ minigameWindow        （M9 新增，钓鱼/农场/小游戏独立渲染窗）
├─ Tray                  （M1 改，菜单加宠物项）
└─ 主进程服务
   ├─ pet-window.ts / pet-console-window.ts / minigame-window.ts
   ├─ pet-state-store.ts (pet-state.json) / pet-diary-store.ts (pet-diary.json)
   └─ settings-store.ts (改：AppSettingsV1 加 pet 段)

渲染层
├─ src/renderer/              （现有主窗口，M2 换图 + 删 reduced-motion）
├─ src/renderer-pet/          （M1/M3/M6 桌面宠物渲染）
├─ src/renderer-pet-console/  （M4/M7/M8 控制台 6 tab）
└─ src/renderer-minigame/     （M9-M11 钓鱼/农场/小游戏）

共享 src/shared/
├─ pet-state.ts (衰减/疾病) / pet-growth.ts (成长/经验)
├─ pet-achievements.ts / pet-activities.ts / pet-sprite-atlas.ts
└─ ui-plugin.ts (现有)
```

### 3.2 坐标系与多显示器（无缝游走，M1/M3）
- 虚拟桌面并集：`screen.getAllDisplays()` 取并集矩形，petWindow 尺寸=并集。
- 可行走图：每屏=节点，共享边连边；图最短路径寻路；死区不可达。
- 跨屏连续滑过，无淡入淡出。DPI 用逻辑像素一致处理。监听 `display-*` 事件重算。

### 3.3 IPC 频道（按模块渐进）
`pet:set-ignore-mouse-events`、`pet:visibility`、`pet:state-changed`、`pet:perform-action`、`pet:buy-item`、`pet:use-item`、`pet:toggle-console`、`pet:diary-append`、`pet:achievement-unlocked`、`minigame:launch`、`minigame:result`。

---

## §4 数据模型

```ts
// src/shared/pet-state.ts
type PetVitals = { hunger: number; cleanliness: number; health: number; mood: number } // 0-100
type PetStage = 'egg' | 'kid' | 'adult'
type PetGender = 'GG' | 'MM'
type PetStatus = 'healthy' | 'hungry' | 'dirty' | 'sick' | 'critical' | 'collapsed'

type PetState = {
  vitals: PetVitals
  status: PetStatus
  coins: number
  inventory: PetItem[]
  position: { x: number; y: number; displayId: number }
  facing: 'left' | 'right'
  lastTickAt: number
  growth: { stage: PetStage; stageEnteredAt: number; gender: PetGender; level: number; exp: number; eggProgress?: number }
  achievements: { unlocked: string[]; unlockedAt: Record<string, number> }
  marriage?: { partnerId: string; marriedAt: number; eggs: number }
  lastSignInDate?: string // M4 签到
}
```

持久化：`~/.qwicks/pet-state.json`（状态主文件，debounce 1s 落盘，before-quit flush）+ `~/.qwicks/pet-diary.json`（档案，按天，保留可配天数默认 90）。离线补算：启动读 `lastTickAt` 按墙钟补算衰减，**保护上限 8h**。

设置项 `AppSettingsV1.pet`：`enabled/spriteScale/walkEnabled/consoleOnLaunch/diaryRetentionDays/growthSpeed`。

---

## §5 素材使用策略（核心原则）

**QQ 宠物出场景/道具/UI 美术 + 玩法蓝图；暖黄出角色主体；新技术出特效动画。**

| 资产类型 | 来源 |
|---|---|
| 场景背景（钓鱼池/农场/教堂） | ✅ QQ png/svg |
| 道具图标（食物/药/玩具/鱼/作物） | ✅ QQ png/gif |
| UI 装饰（等级牌/进度条/按钮） | ✅ QQ png/svg |
| 角色形象主体 | ✅ 暖黄形象（M2 裁切）❌不用企鹅 |
| 动作动画 | ✅ 暖黄姿态+道具图层+CSS/粒子 ❌不用 swf |
| 特效 | ✅ 新技术拉满 ❌不用 swf |
| 玩法规则 | ✅ 参考 QQ |

**swf/fla/as（1480 个）一个都不导入。**

---

## §6 风险清单（全局）

- **R1** 超大透明窗合成性能【M1 阻断】→ M1 任务1 spike 验证，不行回退每屏一窗。
- **R2** 点击穿透准确性【M1 阻断】→ M1 任务2 spike 验证热区切换。
- **R3** 后台保活改退出语义【M1 阻断】→ M1 集成测试。
- **R4** 换皮遗漏残留【M2 可见】→ 删图后 grep=0 + 构建无旧图。
- **R5** 精灵图裁切不准【M2 可见】→ dev 预览页核对。
- **R6** 离线补算公平性【M4】→ 单测 1h/8h/7d/30d。
- **R7** macOS 全屏/Spaces【M1】→ mac 测试。
- **R8** 无缝跨屏寻路正确性【M3 阻断】→ walkable-graph 单测覆盖错位/死区。
- **R9** 移除 reduced-motion 无障碍影响【已知，用户选择，执行不回头】。
- **R10** QQ 素材版权【全局法律】→ §0.2。
- **R11** 范围过大烂尾【全局工程】→ 严格按任务顺序逐个验证。

---

# M1 — 桌面精灵窗口

**目标**：透明 always-on-top 窗口承载桌面宠物，点击穿透切换，多显示器无缝游走（当前屏内起步），后台保活，桌面感知。依赖：无。

### M1-T1 透明窗口 spike（验证 R1）
- **文件**：临时 spike 脚本（验证后删除）。
- **实现**：用 Electron 创建一个覆盖主屏并集的透明 always-on-top 窗口，加载一个放 `<img>` 的 HTML，测帧率。
- **验收**：在双屏（含 4K）+ 集显机器上帧率 ≥ 30fps，无闪烁。不通过则记录并在 M1-T3 改用每屏一窗方案。
- **测试**：手动测，spike 不写单测。

### M1-T2 点击穿透 spike（验证 R2）
- **文件**：临时 spike。
- **实现**：透明窗 `setIgnoreMouseEvents(true,{forward:true})`，渲染层监听 forward 的 mousemove，鼠标进入 img bbox 时 IPC 通知主进程 `setIgnoreMouseEvents(false)`，离开时切回穿透。
- **验收**：img 可点击/可拖；img 外的鼠标能正常操作桌面图标。Win + macOS 各测一次。
- **测试**：手动测。

### M1-T3 创建 pet-window.ts（窗口生命周期）
- **文件**：新建 `src/main/pet-window.ts`。
- **实现**：导出 `createPetWindow()`、`getPetWindow()`、`destroyPetWindow()`。窗口参数：`frame:false, transparent:true, resizable:false, movable:false, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, focusable:false, show:false`；`setAlwaysOnTop(true,'screen-saver')`；`setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`；`setIgnoreMouseEvents(true,{forward:true})`。尺寸=虚拟桌面并集（新增 `computeVirtualDesktopBounds(screen)` 纯函数）。`ready-to-show` 后 show 防白闪。加载 `src/renderer-pet/index.html`。
- **测试**：`pet-window.test.ts` 测 `computeVirtualDesktopBounds`（单屏/双屏/错位/负坐标原点）。窗口创建本身不单测（依赖真实 BrowserWindow，沿用现有惯例）。
- **验收**：`typecheck` 通过。

### M1-T4 虚拟桌面并集 + 显示器变化响应
- **文件**：`src/main/pet-window.ts`（扩展）、新建 `src/shared/pet-display.ts`。
- **实现**：`computeVirtualDesktopBounds(displays)` 纯函数返回 `{x,y,width,height}`。主进程注册 `screen.on('display-metrics-changed'/'display-added'/'display-removed')` → 重算并集 → `petWindow.setBounds()` + IPC 通知渲染层重定位宠物到合法 work area。
- **测试**：`pet-display.test.ts` 覆盖单屏/双屏横排/双屏纵排/错位/三屏/含负坐标。
- **验收**：`typecheck`+`test` 通过；插拔显示器宠物不消失。

### M1-T5 renderer-pet 独立入口
- **文件**：新建 `src/renderer-pet/index.html`、`src/renderer-pet/src/main.tsx`、`src/renderer-pet/src/PetSprite.tsx`；改 `electron.vite.config.ts` 加 renderer-pet 多页入口。
- **实现**：透明 body，React 挂载点。`PetSprite` 暂用暖黄 stand 帧占位（M2 正式裁切）。渲染层监听 forward mousemove，进入/离开精灵 bbox 时通过 preload 暴露的 IPC 调 `pet:set-ignore-mouse-events`。
- **测试**：热区检测抽 `isPointInBbox(point, bbox, padding)` 纯函数单测。
- **验收**：`build` 通过，启动后桌面显示一个暖黄小家伙，可点击。

### M1-T6 漫步引擎（当前屏内，跨屏留 M3）
- **文件**：新建 `src/renderer-pet/src/pet-physics.ts`、`src/renderer-pet/src/WalkEngine.tsx`。
- **实现**：状态机 `idle ↔ wander`。`idle` 随机 3-8s 后概率（受 `walkEnabled` 控制）转 `wander`；`wander` 在当前屏 work area 内选随机目标点匀速走去，到达回 `idle`。rAF 驱动。位置写 `PetState.position`。
- **测试**：`transitionPetMotion(state,event,ctx)` 纯函数单测各转移；目标点选择 mock 随机数验证落在 bounds 内。
- **验收**：宠物在桌面上自己走来走去。

### M1-T7 后台保活（改 index.ts，R3）
- **文件**：改 `src/main/index.ts`。
- **实现**：改 `window-all-closed`——非 mac 下，若只剩 petWindow（mainWindow 已关），不退出（mainWindow 隐藏）。`before-quit` 不变（仍停 runtime 再退）。新增 `revealMainWindow()` 供托盘用。退出路径收敛为两条：托盘"退出" / `before-quit`。
- **测试**：手动——主窗关闭宠物仍活；托盘"退出"真退；`before-quit` 仍停 runtime。沿用现有 `index.test.ts` 不覆盖创建路径惯例。
- **验收**：手动三种退出场景正确。

### M1-T8 托盘菜单加宠物项
- **文件**：改 `src/main/tray-session-menu.ts`、`src/main/index.ts`。
- **实现**：`buildTrayMenuTemplate` 加"显示/隐藏桌面宠物"开关项、"宠物面板"项（M4 接控制台）。开关 toggle petWindow 可见性 + 持久化到 `settings.pet.enabled`。
- **测试**：更新 `tray-session-menu.test.ts` 验证新菜单项存在与回调。
- **验收**：托盘可切换宠物显隐。

### M1-T9 设置项接入
- **文件**：改 `src/main/settings-store.ts`、`src/shared/app-settings.ts`。
- **实现**：`AppSettingsV1.pet` 字段（§4），`mergeAppBehaviorSettings`/`normalizeAppSettings` 加 pet 合并/规范化。启动读 `pet.enabled` 决定是否创建 petWindow。
- **测试**：更新 `settings-store.test.ts` 覆盖 pet 段默认值/合并/迁移。
- **验收**：`typecheck`+`test` 通过；设置里关掉宠物重启后不出现。

### M1-T10 桌面感知（避让前台窗口 + 壁纸色采样 + 跟随鼠标视线）
- **文件**：新建 `src/main/pet-desktop-sense.ts`、`src/renderer-pet/src/DesktopSense.tsx`。
- **实现**：主进程定时（~1s）取 `BrowserWindow.getAllWindows()` 过滤非 QWicks 可见窗的 bounds → IPC 推给渲染层作"障碍区"，漫步路径绕开。壁纸色采样：主进程读注册表/`systemPreferences` 取强调色或采样桌面，渲染层据此微调阴影/高光。跟随鼠标视线：idle 时宠物头部层朝鼠标方向轻微旋转。
- **测试**：障碍区合并/差集抽纯函数单测；视线角度计算纯函数单测。
- **验收**：宠物漫步不钻进其他窗口下面；idle 时眼睛/头跟随鼠标。

### M1 模块验收
桌面透明窗宠物出现，会自己漫步，无缝响应显示器变化，可托盘显隐，关主窗走托盘保活，漫步避让桌面窗口，眼神跟随鼠标。R1/R2/R3 全部验证通过。

---

# M2 — 形象换皮

**目标**：删除全部旧美术，暖黄形象成为全应用唯一角色；保留 UI 插件/mascot/iQWicks 机制代码（双槽都指向暖黄）；移除所有 reduced-motion 守卫；托盘/图标一并换。依赖：M1（宠物窗用新形象）。

### M2-T1 精灵图裁切映射
- **文件**：新建 `src/shared/pet-sprite-atlas.ts`、`scripts/split-pet-atlas.cjs`。
- **实现**：把用户上传的暖黄精灵图（9 行姿态）在**构建期**裁成 9 张独立 PNG 落 `src/asset/img/pet/`。`PET_SPRITE_ATLAS` 定义行→姿态（stand/walk/sit/wave/talk/sad/sleep/think/wonder），`PET_FIGURE_BY_SLOT` 映射 7 槽位→姿态（swim→walk/surf→walk/greet→wave/sleep→sleep/sit→sit/run→walk/toggleIcon→stand）。`petFrame(pose)` 返回 import 路径。
- **测试**：`pet-sprite-atlas.test.ts` 测槽位全覆盖 + 每姿态映射合法 row；`split-pet-atlas` 给假图测输出文件数/尺寸。
- **验收**：`typecheck`+`test`+`build` 通过。

### M2-T2 裁切预览页（验证 R5，dev-only）
- **文件**：新建 `src/renderer-pet/src/DevAtlasPreview.tsx`，dev 路由 `/dev/atlas`。
- **实现**：逐帧显示 9 姿态 + 槽位映射，肉眼核对行号对不对。核对完调整 atlas 常量重裁。
- **验收**：手动核对每姿态正确。
- **测试**：不单测。

### M2-T3 删除旧美术文件
- **文件**：删 `src/asset/img/qwicks_*.png` + `iqwicks_*.png`（15 个）。
- **实现**：删除。让任何遗漏引用在构建期编译失败暴露（R4 策略）。
- **验收**：`grep -ri "qwicks_\|iqwicks_" src/` 在改完引用后 = 0 命中。

### M2-T4 改 AnimatedWorkLogo.tsx 引用源
- **文件**：改 `src/renderer/src/components/chat/AnimatedWorkLogo.tsx`。
- **实现**：~12 处旧 import 改成 `petFrame(pose)`。qwicks 槽和 iqwicks 槽都指向暖黄对应姿态（greet→wave/sleep→sleep/sit→sit/run→walk 等）。机制（双图 CSS 过渡、彩蛋、庆祝）逻辑不动。
- **测试**：更新 `AnimatedWorkLogo.test.ts` 断言（不再检查双角色，改检查暖黄帧 src 一致）。
- **验收**：`typecheck`+`test`+`build` 通过。

### M2-T5 改 ui-plugin-bundled.ts 种子
- **文件**：改 `src/main/ui-plugin-bundled.ts`。
- **实现**：`BUNDLED_IQWICKS_FIGURE_REFS` 6 import 改暖黄帧。manifest description 改中性文案。`BUNDLED_SEED_MARKER` `.bundled-seed-v1`→`v2` 强制老用户重新播种，删旧标记。
- **测试**：更新 `ui-plugin-service.test.ts`/`ui-plugin.test.ts` 种子断言为暖黄帧。
- **验收**：`typecheck`+`test` 通过；新装/老用户播种后 `~/.qwicks/ui-plugins/iqwicks/` 是暖黄图。

### M2-T6 托盘/窗口/app 图标替换
- **文件**：改 `src/main/index.ts`（import）、`build/icon.ico`、`electron-builder.config.cjs`；新增 `src/asset/img/pet/pet_mac.png`+`pet_tray.png`（裁切脚本产出，含圆角/托盘尺寸适配）。
- **实现**：`qwicks_mac.png`/`qwicks_tray.png` import 换新。icon.ico 重新生成。
- **验收**：任务栏/托盘/app 图标全是暖黄。

### M2-T7 i18n 文案中性化
- **文件**：改 `src/renderer/src/locales/{zh,en}/common.json`。
- **实现**：iQWicks/坤鸡相关键的值改中性（"宠物形象"/"Pet"），工作标签 `iqwicksDribbling` 等改"忙碌中"/"冲刺中"/"小憩中"。
- **验收**：设置里无"坤鸡"字样。

### M2-T8 移除所有 reduced-motion 守卫（R9）
- **文件**：改 `src/renderer/src/components/chat/AnimatedWorkLogo.tsx` 等。
- **实现**：删 `window.matchMedia('(prefers-reduced-motion: reduce)')` 分支（`IqwicksCameoLayer`/`QWicksCelebrationLayer` 等处）。动画无条件全开。
- **验收**：`grep reduced-motion src/` = 0。
- **测试**：更新相关 test 移除 reduced-motion 分支断言。

### M2 模块验收
全应用任意界面只见暖黄形象，无鸟/坤鸡残影；iQWicks 模式切换氛围色变形象不变；设置无"坤鸡"字样；reduced-motion 全移除；托盘/图标全换。R4/R5 验证通过。

---

# M3 — 物理交互

**目标**：拖拽悬空、真实重力下坠、落地弹性+扬尘+眩晕+震屏、边缘撞墙、无缝跨屏、物理阴影、季节/天气/环境特效、待机呼吸、情绪表情层、脚印。依赖：M1。

### M3-T1 物理状态机扩展
- **文件**：扩展 `src/renderer-pet/src/pet-physics.ts`。
- **实现**：扩状态 `idle/wander/dragging/falling/landed/bonk`。转移规则见总纲设计 §4.1。抽纯函数 `transitionPetMotion` + `computeFallStep(pos,vy,g,bounds)`。
- **测试**：`pet-physics.test.ts` 全转移覆盖、重力步进、触底判定。

### M3-T2 可行走图寻路（无缝跨屏，R8）
- **文件**：新建 `src/shared/walkable-graph.ts`、`src/renderer-pet/src/CrossScreenWalker.tsx`。
- **实现**：`buildWalkableGraph(displays)` 纯函数建图；`findPath(graph,fromScreen,toScreen)` 图最短路径。漫步目标 ~60% 选跨屏。路径只走真实屏坐标，死区不可达。
- **测试**：`walkable-graph.test.ts` 覆盖错位双屏/三屏串联/含死区/不相邻中转。
- **验收**：宠物在不同屏间连续滑过，不进虚空。

### M3-T3 拖拽 + 汗珠 + 尾迹
- **文件**：`src/renderer-pet/src/DragController.tsx`、`src/renderer-pet/src/effects/SweatParticles.tsx`、`MotionTrail.tsx`。
- **实现**：鼠标按下 bbox 转 `dragging`（IPC 关穿透且禁用热区切换）。悬空用 talk 帧 + 程序化高频抖动（基于鼠标加速度）+ 汗珠粒子下落淡出 + 拖拽尾迹。松手转 `falling`（vy=0）。
- **测试**：纯函数单测；渲染手动验收。

### M3-T4 真实重力下坠 + 落地特效
- **文件**：`pet-physics.ts`（重力）、`src/renderer-pet/src/effects/LandImpact.tsx`（扬尘+眩晕星+震屏）。
- **实现**：`vy += g` 带空气阻力终端速度。落地：弹性 squash/stretch + 1-2 次衰减小弹跳 + 12-20 尘埃粒子（初速度+重力+淡出+旋转）+ 头顶眩晕星 + 全屏震动（幅值小衰减快）。落地后 1.2s 显示 sad/sit 帧 + "晕"气泡。
- **测试**：`computeFallStep`/弹性碰撞参数纯函数单测。

### M3-T5 边缘撞墙
- **文件**：`pet-physics.ts`（bonk 检测）、`src/renderer-pet/src/effects/BonkEffect.tsx`。
- **实现**：wander 触屏边 → `bonk`：贴墙压扁 + 反弹 + 头顶"碰"字/星 + 撞击点尘埃 + 眩晕摇摆 0.8s。
- **测试**：bonk 方向判定纯函数单测。

### M3-T6 物理阴影层
- **文件**：`src/renderer-pet/src/effects/PetShadow.tsx`。
- **实现**：地面椭圆阴影，随宠物"离地高度"（dragging/falling 时）变小变淡，落地变实变大。与落地特效联动。

### M3-T7 季节 + 天气 + 环境特效层
- **文件**：新建 `src/renderer-pet/src/PetEnvironment.tsx`、`effects/{Snow,Rain,Leaves,Sunbeams,Fog}.tsx`。
- **实现**：按系统日期定季节（春樱花/夏烈日光斑/秋落叶/冬雪）。天气可手动设或随机（晴/雨/雪/雾）。全 Canvas 粒子层，常驻 rAF。壁纸色采样微调阴影/高光。
- **测试**：季节判定纯函数单测。

### M3-T8 待机呼吸 + 脚印 + 情绪表情层
- **文件**：`src/renderer-pet/src/effects/{IdleBreath,Footprints,EmotionAura}.tsx`。
- **实现**：idle 微幅起伏（永远动）；漫步身后留短暂脚印淡出；情绪表情由 M4 属性驱动（饿"~"/脏苍蝇/病温度计/开心爱心/困 Zzz）——M3 先建架构，情绪数据源接 M4 `PetStateContext`。
- **验收**：宠物永远"活着"不静止。

### M3-T9 常驻 rAF 主循环 + 粒子对象池
- **文件**：`src/renderer-pet/src/render-loop.ts`、`src/renderer-pet/src/effects/particle-pool.ts`。
- **实现**：60fps 单循环驱动物理+粒子+阴影。粒子对象池复用防 GC。
- **验收**：长时间运行无卡顿（即便不考虑性能，GC 抖动仍值得防）。

### M3 模块验收
可拖起宠物（慌张扑腾+汗+尾迹），松手真实下坠+屁股着地（扬尘+眩晕+震屏），漫步撞墙回弹，无缝跨屏，地面物理阴影，季节/天气常驻，永远呼吸，脚印，情绪表情（接 M4 后激活）。R8 验证通过。

---

# M4 — 生存与照料

**目标**：四属性衰减、离线补算、疾病演变、还魂丹复活、每日签到、右键自绘快捷菜单、常驻控制台面板（6 tab，本模块先做照料/库存/商店/设置 4 tab，成就/档案 tab 占位待 M7/M8）、完整照料动画、状态气泡、道具经济。依赖：M1, M2。

### M4-T1 pet-state 类型 + 衰减/疾病纯函数
- **文件**：新建 `src/shared/pet-state.ts`。
- **实现**：`PetState` 类型（§4）。纯函数：`tickVitals(state, elapsedMs)` 非线性衰减；`deriveStatus(vitals)` 状态演变；`applyOfflineCatchUp(state, nowMs)` 离线补算（8h 上限）；`applyItemEffect(state, item)` 道具效果；`signIn(state, today)` 签到送元宝。衰减曲线参数集中可调。
- **测试**：`pet-state.test.ts` 覆盖衰减非线性、各时长离线（1h/8h/7d/30d，R6）、状态优先级、道具效果、签到去重。

### M4-T2 pet-state-store 持久化
- **文件**：新建 `src/main/pet-state-store.ts`。
- **实现**：读写 `~/.qwicks/pet-state.json`。debounce 1s 落盘；`before-quit` flush；位置节流 500ms。启动时 `applyOfflineCatchUp`。后台 tick 每 30s 衰减一次 + 写盘 + 广播 `pet:state-changed`。
- **测试**：store 读写/迁移单测（mock fs）。

### M4-T3 后台 tick 调度 + 状态广播
- **文件**：改 `src/main/pet-window.ts`/`index.ts`。
- **实现**：启动后启动 30s interval tick。每次 tick：读 state → `tickVitals` → 写盘 → `pet:state-changed` 广播到 petWindow + consoleWindow。
- **验收**：属性随时间下降，渲染层实时更新。

### M4-T4 状态气泡
- **文件**：新建 `src/renderer-pet/src/PetBubble.tsx`。
- **实现**：属性过低时头顶气泡（QQ 经典文案随机），常驻到属性恢复。呼吸缩放 + 尾巴指向宠物 + 打字机逐字效果。
- **测试**：气泡文案选择/优先级纯函数单测。

### M4-T5 道具经济定义
- **文件**：新建 `src/shared/pet-catalog.ts`。
- **实现**：定义道具目录（食物若干档/清洁/药品/还魂丹/玩具），每项 `{id,type,name,price,effect,icon}`。icon 引用 QQ 道具图标（`pet-qq/items/`）。M2 导入的 QQ 道具图在此挂接。
- **测试**：目录完整性/价格平衡单测。

### M4-T6 右键自绘快捷菜单
- **文件**：新建 `src/renderer-pet/src/QuickMenu.tsx`。
- **实现**：右键宠物 → 暖黄主题气泡卡片菜单（摸头/玩耍/喂食▸最近食物/打开面板/隐藏）。展开期临时关穿透。喂食子项依库存动态生成。
- **测试**：`buildPetQuickMenuItems(state, inventory)` 纯函数单测。

### M4-T7 控制台窗口 + 4 tab 框架
- **文件**：新建 `src/main/pet-console-window.ts`、`src/renderer-pet-console/`（index.html/main.tsx）、改 `electron.vite.config.ts` 加入口。
- **实现**：第三个 BrowserWindow，360×520，frame:false transparent:true alwaysOnTop skipTaskbar，默认隐藏。暖黄主题自绘标题栏（拖动+关闭）。4 tab：照料/库存/商店/设置（成就/档案 tab 占位禁用，M7/M8 激活）。
- **验收**：右键"打开面板"/双击宠物/托盘"宠物面板"唤出控制台。

### M4-T8 控制台 - 照料/库存/商店/设置 tab
- **文件**：`src/renderer-pet-console/tabs/{Care,Inventory,Shop,Settings}.tsx`。
- **实现**：照料=摸头/玩耍/喂食快捷；库存=物品网格点击使用；商店=购买列表（元宝价，不足拒绝）；设置=漫步/缩放/显隐开关。属性仪表盘分色进度条（QQ `jindutiao` 6 色 UI）。购买/使用走 IPC `pet:buy-item`/`pet:use-item` → store → 广播。
- **测试**：购买校验/库存上限纯函数单测。

### M4-T9 照料动画（拉满）
- **文件**：`src/renderer-pet/src/effects/{FeedAnim,BathAnim,CureAnim,ReviveAnim}.tsx`。
- **实现**：喂食=食物飘嘴+咀嚼+满足表情+心情上升粒子；洗澡=泡沫粒子+哼歌音符+清洁条上升；看病=点滴瓶+健康条上升+脸色由灰转红；还魂丹=collapsed→光芒+复活。暖黄姿态+道具图层+粒子。
- **验收**：每次照料有丰富动画。

### M4-T10 每日签到
- **文件**：`src/main/pet-state-store.ts`、`src/renderer-pet-console/tabs/`（签到入口）。
- **实现**：每天首次打开弹签到（QQ `signIn` UI），领元宝。`state.lastSignInDate` 去重。
- **测试**：签到去重单测。

### M4 模块验收
宠物会随时间饿/脏，头顶气泡；长期不管会病→濒死→倒下；右键/控制台可喂食/洗澡/看病/购物，每次拉满动画；倒下后还魂丹救活；每日签到送元宝；关 app 一段时间再开状态合理补算（R6）。控制台 4 tab 可用（成就/档案占位）。

---

# M5 — 成长系统

**目标**：蛋→幼年→成年 + 性别 + 等级(0-7+) + 经验 + 升级动画 + 阶段差异。依赖：M4。

### M5-T1 pet-growth 纯函数
- **文件**：新建 `src/shared/pet-growth.ts`。
- **实现**：`tickEgg(state, elapsed)` 蛋孵化进度；`tryAdvanceStage(state)` 阶段切换（蛋→幼年：eggProgress≥100；幼年→成年：饲养满 `growthSpeed` 默认 7 天 + 等级≥阈值）；`addExp(state, amount)` + `tryLevelUp`（0-7+，参照 QQ `dengji` 8 级）；`rollGender()` 蛋孵化时随机 GG/MM。时长可调常量（蛋~30min 墙钟，幼→成~7 天）。
- **测试**：`pet-growth.test.ts` 覆盖孵化/阶段切换/经验升级/性别随机。

### M5-T2 成长接入 tick + 状态广播
- **文件**：改 `src/main/pet-state-store.ts`。
- **实现**：30s tick 里加 `tickEgg`/`tryAdvanceStage`。阶段/等级变化广播 `pet:state-changed`。

### M5-T3 升级动画 LevUp
- **文件**：`src/renderer-pet/src/effects/LevelUpAnim.tsx`。
- **实现**：升级全屏光效 + 等级牌弹出（QQ `LevUp` 思路）+ 粒子。暖黄形象 + 新技术特效。

### M5-T4 阶段体型/行为差异
- **文件**：改 `src/renderer-pet/src/PetSprite.tsx`、`pet-activities.ts`（M6）。
- **实现**：egg=不可交互只显示孵化进度条；kid=小体型活泼；adult=标准。spriteScale 按 stage 调整。

### M5-T5 控制台 - 成长信息
- **文件**：改 `src/renderer-pet-console/tabs/Settings.tsx` 或新增成长展示区。
- **实现**：显示当前阶段/等级/经验条/性别。等级牌用 QQ `dengji` UI。

### M5 模块验收
新宠物是蛋→定时孵化→幼年（小）→饲养达标→成年；升级有光效动画；控制台显示成长信息；性别记录（为 M12 预留）。

---

# M6 — 场景行为库

**目标**：可扩展行为库架构；首批 40-60 个随机场景行为；执行后写档案日志；第二批（爬山/游泳/滑雪等）预留。依赖：M3, M2。

### M6-T1 行为库架构
- **文件**：新建 `src/shared/pet-activities.ts`。
- **实现**：`PetActivity = {id, name, duration, poses, props, moodBoost, expBoost, logText, weight}`。`PET_ACTIVITIES: PetActivity[]`。`pickActivity(state)` 按权重随机抽（阶段过滤：egg 不能有行为）。新增行为=加一项。
- **测试**：`pet-activities.test.ts` 每项必有 pose/props/logText；按权重抽取 mock 验证；阶段过滤。

### M6-T2 首批 40-60 行为定义
- **文件**：`src/shared/pet-activities.ts`（扩展）。
- **实现**：现有帧+道具能做的：看书/上网/睡觉/发呆/思考/做白日梦/伸懒腰/打哈欠/左顾右盼/晒太阳/哼歌/跳舞/数星星/数绵羊/玩毛线球/堆积木/画画/写日记/擦窗户/浇花/看窗外/打盹/吃零食/照镜子/梳毛/吹口哨/跷二郎腿/趴着/打滚/捉迷藏/偷看/惊讶/叹气/点头/摇头/挥手/鼓掌/蹦跳/转圈/滑步…（凑够 40-60）。每个 props 引用 QQ 道具图标或程序化绘制。

### M6-T3 行为执行器
- **文件**：新建 `src/renderer-pet/src/PetActivityRunner.tsx`。
- **实现**：idle 时按概率触发行为，持续 duration，用对应暖黄姿态 + 道具图层叠加 + CSS 动画。执行完调 `pet:diary-append` 写日志（M8）。与 M3 情绪表情层协作。

### M6-T4 第二批预留架构
- **文件**：`pet-activities.ts` 注释。
- **实现**：标注爬山/游泳/滑雪/跳绳/打太极等"待专用帧"，架构支持资产到位即加入。

### M6 模块验收
宠物 idle 时随机做 40-60 种行为之一，每个有专属动画+道具；行为越丰富越接近"自己会玩"；每个行为写档案日志（M8 后可见）。

---

# M7 — 成就系统

**目标**：Steam 式全成就，多分类，达成全屏弹窗拉满，成就 tab。依赖：M4, M5。

### M7-T1 成就定义
- **文件**：新建 `src/shared/pet-achievements.ts`。
- **实现**：`PetAchievement = {id, category, name, desc, hidden, icon, condition}`。分类：成长/照料/生存/玩耍/收集。~30-50 个成就（首次孵化/成年/满级/累计喂食100/连续签到7天/经历濒死被救/体验N种行为/拥有N道具…）。`checkAchievements(state, events)` 返回新解锁。
- **测试**：`pet-achievements.test.ts` 各触发条件/去重/解锁记录。

### M7-T2 成就检测接入
- **文件**：改 `src/main/pet-state-store.ts`。
- **实现**：关键事件（喂食/签到/行为/升级）后调 `checkAchievements`，新解锁写 `state.achievements` + 广播 `pet:achievement-unlocked`。

### M7-T3 成就达成弹窗（Steam 式拉满）
- **文件**：新建 `src/renderer-pet/src/effects/AchievementPopup.tsx`（全渲染层监听广播）。
- **实现**：达成瞬间全屏暗化 + 徽章放大弹入 + 光芒粒子 + 音效 + "成就解锁"标题 + 描述逐字。
- **验收**：达成有震撼感。

### M7-T4 控制台 - 成就 tab
- **文件**：新建 `src/renderer-pet-console/tabs/Achievements.tsx`（激活占位 tab）。
- **实现**：全成就列表（已解锁高亮+解锁日期/未解锁灰/隐藏"???")+ 总进度条。icon 用 QQ `achievement` svg。

### M7 模块验收
达成成就全屏弹窗拉满；成就 tab 展示全部成就与进度；多分类覆盖成长/照料/生存/玩耍/收集。

---

# M8 — 宠物档案

**目标**：时间线日志 + 档案 tab + 每日摘要。依赖：M6, M4。

### M8-T1 pet-diary-store
- **文件**：新建 `src/main/pet-diary-store.ts`。
- **实现**：读写 `~/.qwicks/pet-diary.json`，按天组织 `{date: [{ts, icon, text}]}`。保留可配天数（默认 90）自动清理旧条目。`appendDiary(entry)` IPC。
- **测试**：读写/清理旧条目单测。

### M8-T2 行为/照料/事件写日志
- **文件**：改 M4/M5/M6 各执行点。
- **实现**：喂食/洗澡/看病/签到/行为/升级/成就达成等关键节点调 `pet:diary-append`，带时间戳+图标+描述。

### M8-T3 控制台 - 档案 tab
- **文件**：新建 `src/renderer-pet-console/tabs/Diary.tsx`（激活占位 tab）。
- **实现**：按天分组的可滚动时间线，每条带时间戳+图标+描述。暖黄主题。

### M8-T4 每日摘要
- **文件**：`src/main/pet-diary-store.ts`（摘要生成）、控制台推送。
- **实现**：每天首次打开推"昨日总结"（昨天做了什么、属性变化、是否签到）。

### M8 模块验收
档案 tab 显示按天的行为流水；每日有摘要推送；日志保留可配天数不无限增长。

---

# M9 — 钓鱼

**目标**：照 QQ 钓鱼玩法规则；场景用 QQ `fishing/res/bg` 背景+道具；角色暖黄（CSS/粒子挥竿，不用 swf）；赚元宝/道具。依赖：M4, M2。

### M9-T1 钓鱼场景窗口
- **文件**：`src/main/minigame-window.ts`（复用）、`src/renderer-minigame/games/Fishing.tsx`。
- **实现**：独立渲染窗加载钓鱼场景。背景用 QQ `fishing/res/bg`，角色暖黄站在岸边。

### M9-T2 钓鱼玩法（参考 QQ 规则）
- **文件**：`src/renderer-minigame/games/Fishing.tsx`、`src/shared/fishing-logic.ts`。
- **实现**：抛竿（暖黄挥竿 CSS 动画）→ 等待咬钩（随机时间）→ 提竿时机判定 → 收获鱼/垃圾。鱼换元宝/道具。`fishing-logic.ts` 纯函数：咬钩概率/收获表/连击。
- **测试**：`fishing-logic.test.ts` 概率/收获/连击。
- **细节**：照 QQ `fishing/config.xml`（采摘上限/收获鱼数）思路定数值。

### M9-T3 结算接入经济
- **文件**：改 `src/main`，`minigame:result` IPC。
- **实现**：钓鱼结束 → 结算元宝/道具入 `pet-state` + 写档案日志。

### M9 模块验收
能钓鱼，有 QQ 钓鱼池背景+暖黄角色+挥竿动画；钓到的鱼换元宝/道具；写档案。

---

# M10 — 农场

**目标**：照 QQ 种田玩法；QQ `farm` 背景+作物图标；角色暖黄；种收赚元宝/食材。依赖：M4, M2。

### M10-T1 农场场景
- **文件**：`src/renderer-minigame/games/Farm.tsx`。
- **实现**：田地网格，背景 QQ `farm`。角色暖黄。

### M10-T2 种田玩法
- **文件**：`src/shared/farm-logic.ts`、`Farm.tsx`。
- **实现**：买种子→种下→定时生长（受 `growthSpeed` 影响）→成熟→收获。作物换元宝/食材（食材可做饭喂宠物）。`farm-logic.ts` 纯函数：生长阶段/产量/价格。
- **测试**：`farm-logic.test.ts`。

### M10-T3 结算 + 日志
- 同 M9-T3 模式。

### M10 模块验收
能种田，作物定时生长收获，换元宝/食材；写档案。

---

# M11 — 小游戏（6 种）

**目标**：连连看/猜拳/打地鼠/泡泡龙/跳绳/100层；规则照 QQ `smallGame/*`；QQ 静态素材+暖黄；赚元宝/道具。依赖：M4, M2。

### M11-T1 小游戏选择入口
- **文件**：控制台"玩耍"或独立小游戏菜单 → `minigame:launch`。

### M11-T2~T7 六个游戏各一任务
- 每游戏：`src/renderer-minigame/games/{Match,Guess,WhackMouse,Bubble,Rope,Tower100}.tsx` + `src/shared/{game}-logic.ts` 纯函数 + 测试。
- 规则照 QQ `smallGame/{ball,guess,mouse,paopao2,rope,100ceng}`。
- 暖黄角色参与（如跳绳里暖黄在跳）。

### M11-T8 结算 + 日志
- 同 M9-T3。

### M11 模块验收
6 个小游戏可玩，各有规则+暖黄参与，赚元宝/道具，写档案。

---

# M12 — 婚育

**目标**：成年后相亲结婚（教堂场景）+ 宠物蛋繁殖（本地多存档槽送蛋）。依赖：M5, M4。

### M12-T1 成年判定 + 相亲
- **文件**：`src/shared/pet-marriage.ts`。
- **实现**：成年解锁婚育。相亲：本地生成候选伴侣（或从另一本地存档槽导入）。

### M12-T2 结婚（教堂场景）
- **文件**：`src/renderer-minigame/scenes/Wedding.tsx`。
- **实现**：教堂场景（QQ 婚育素材）+ 暖黄双方 + 仪式动画。婚后写 `state.marriage`。

### M12-T3 繁殖宠物蛋
- **文件**：`src/shared/pet-marriage.ts`。
- **实现**：婚后定时/用结婚戒指培育蛋。蛋可"送给"另一本地存档槽（多存档设计：`pet-state.slot-2.json` 等）。
- **测试**：`pet-marriage.test.ts`。

### M12 模块验收
成年宠物能结婚（教堂场景+仪式），培育宠物蛋，蛋可送本地另一存档。

---

# 最终验收（M12 全部完成后）

- 桌面精灵活在桌面，无缝跨屏，物理/特效全拉满，永远"活着"。
- 全应用只见暖黄形象，无旧形象残影。
- 完整生存闭环：饿/脏/病/濒死/还魂丹/签到/照料动画。
- 成长：蛋→幼年→成年，等级，性别。
- 40-60 随机场景行为，宠物自己会玩。
- Steam 式成就 + 档案时间线。
- 钓鱼/农场/6 小游戏可玩赚元宝。
- 婚育：结婚生子送蛋。
- 所有纯函数有单测；typecheck/build 全绿；R1-R11 各按其类验证。

---

# 附录 A：QQ 宠物资源映射参考

（执行各模块时按需查阅 `C:/Users/given/Desktop/pet/`）
- `Action/{GG,MM}/{Egg,Kid,Adult}/*.swf` → 动作清单参考（Clean/Cure/Eat/Sick/Die/Dying/Revival/LevUp/Hide/Enter/Exit + 情绪 game/happy/peaceful/prostrate/sad/upset + Kid/play 100+）
- `stateInfo/{dengji,jindutiao}.png` → 等级/进度 UI
- `img_res/{food,clean,medicine,toy,study,work}` → 道具图标（560/288/22/27/36/24）
- `fishing/`、`farm/`（config.xml + res/bg）→ 钓鱼/农场场景+规则
- `smallGame/{ball,guess,mouse,paopao2,rope,100ceng}` → 6 小游戏
- `achievement/{travel,yyds,ddw}.svg`、`signIn/` → 成就/签到 UI
- `info/GGEgg.svg`/`GGAdult.svg` → 成长阶段参考
- `windowTip/{alert,game,normal,sweetHeart,vip}` → 弹窗类型参考
- `float/{Info,Star,Xin,mood}.swf` → 浮动反馈参考（Info提示/Star星/Xin爱心/mood心情）

**绝不导入**：所有 `.swf`/`.fla`/`.as`。

# 附录 B：决策记录

| 决策点 | 选择 |
|---|---|
| 范围 | M1–M12 全部（除 2D 社区） |
| 执行 | 文档定稿后按 M1→M12 顺序逐任务实际写代码完成 |
| 详细程度 | 任务级（文件/思路/测试/验收，不预写死代码） |
| 形象 | 旧图彻底删；代码/机制保留；双槽指暖黄；托盘图标同换 |
| 资产缺口 | 现有帧+CSS/粒子补足 |
| 多显示器 | 无缝跨屏（可行走图寻路） |
| 生命周期 | 后台保活（隐藏主窗+托盘） |
| 衰减 | 实时+离线补算（8h 上限） |
| 窗口方案 | 单超大透明窗 |
| 跨屏 | 无缝 |
| 特效 | 全拉满，不考虑性能 |
| 季节/天气/桌面互动 | 加入 |
| reduced-motion | 完全移除 |
| 控制台 | 独立第三窗，6 tab，自绘 UI |
| 成长 | 蛋/幼年/成年+性别+等级，时长可调 |
| 成就 | Steam 式拉满 |
| 档案 | 时间线+每日摘要 |
| 场景行为 | 可扩展库，首批 40-60 |
| 素材策略 | QQ 出场景/道具/UI+玩法蓝图；暖黄出角色；新技术出特效；swf 不用 |
| 版权 | 用户知情，公开发布风险自担（§0.2） |
