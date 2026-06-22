# 编辑类右键菜单（剪切 / 复制 / 粘贴 / 删除 / 全选）

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-22 |
| 状态 | Approved |
| 影响范围 | `src/main/index.ts`、新增 `src/main/edit-context-menu.ts` 及其测试 |

## 1. 目标

在 QWicks GUI 主窗口任意位置右键时，弹出原生右键菜单，提供文本编辑操作：剪切、复制、粘贴、删除、全选。每个菜单项在右侧标注其快捷键，标签使用中文。

## 2. 现状

- 主进程 `src/main/index.ts` 的 `createWindow()` 未注册 `webContents.on('context-menu')`，右键当前无任何反应。
- Windows / Linux 上 `mainWindow.setMenu(null)` 并隐藏菜单栏，因此也没有可见的快捷键标注入口。
- `cut/copy/paste/selectAll` 仅能通过托盘菜单和 `desktop:command` IPC 调到；`DESKTOP_COMMANDS` 不含 `delete`。

## 3. 方案

在主进程用 Electron 原生 `Menu` 实现右键菜单（而非渲染进程自建 HTML 菜单或 preload `document.execCommand`）。原生菜单自动把 `accelerator` 渲染在每项右侧，按 `params.editFlags` 自动启用/禁用，且全应用所有文本框统一生效。

### 3.1 菜单结构

```
剪切    CmdOrCtrl+X
复制    CmdOrCtrl+C
粘贴    CmdOrCtrl+V
─────────────（分隔符）
删除    Delete
全选    CmdOrCtrl+A
```

### 3.2 行为

- 右键任意位置即弹出该菜单。
- 每项 `enabled` 由 `params.editFlags`（`canCut / canCopy / canPaste / canDelete / canSelectAll`）决定：未选中文本时剪切/复制/删除灰掉，剪贴板为空时粘贴灰掉。
- 点击调用主窗口 `webContents` 的 `cut() / copy() / paste() / delete() / selectAll()`。删除走 `webContents.delete()`，不经 `desktop:command` IPC，因此无需改动 `DESKTOP_COMMANDS` schema。
- 窗口已销毁时直接返回，不弹菜单。

### 3.3 模块划分

- 新增 `src/main/edit-context-menu.ts`：
  - 导出 `buildEditContextMenuTemplate(flags, actions)`：纯函数，返回 `MenuItemConstructorOptions[]`。可单测。
  - 导出 `registerEditContextMenu(contents, getWindow)`：在 `webContents` 上注册 `context-menu` 监听，构建模板并 `Menu.buildFromTemplate(...).popup(window)`。
- `src/main/index.ts` 的 `createWindow()` 在 `did-fail-load` 监听器之后、`showWindow` 之前调用 `registerEditContextMenu(mainWindow.webContents, () => mainWindow)`。
- `Menu` 已从 `electron` 导入；新模块按需自行导入。

## 4. 测试

- `src/main/edit-context-menu.test.ts`：验证模板项数与顺序、中文标签、accelerator、分隔符位置、`enabled` 与 flags 的映射、`click` 回调分派到对应 action。
- `createWindow` 注册逻辑依赖真实 `BrowserWindow`，沿用现有 `index.test.ts` 不覆盖创建路径的惯例，不单测；以 typecheck + 构建 + 手动右键验证。

## 5. 验证

- `npm run typecheck`
- `npm run build`（electron-vite 构建）
- 启动应用右键：聊天输入框 / 设置输入框 / 代码预览等处验证各项可用性与禁用态、快捷键标注。
