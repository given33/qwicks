import { Menu, type BrowserWindow, type MenuItemConstructorOptions, type WebContents } from 'electron'

/**
 * 右键编辑菜单需要的启用状态。
 * 字段与 Electron context-menu 事件的 params.editFlags 同构。
 */
export type EditContextMenuFlags = {
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canDelete: boolean
  canSelectAll: boolean
}

/**
 * 构建右键编辑菜单模板:剪切 / 复制 / 粘贴 / 删除 / 全选。
 * 每项带 accelerator,Electron 原生菜单会自动把快捷键渲染在标签右侧。
 * 启用状态由传入的 flags 决定(来自 webContents context-menu 事件的 params.editFlags)。
 */
export function buildEditContextMenuTemplate(
  flags: EditContextMenuFlags,
  actions: {
    cut: () => void
    copy: () => void
    paste: () => void
    remove: () => void
    selectAll: () => void
  }
): MenuItemConstructorOptions[] {
  return [
    { label: '剪切', accelerator: 'CmdOrCtrl+X', enabled: flags.canCut, click: () => actions.cut() },
    { label: '复制', accelerator: 'CmdOrCtrl+C', enabled: flags.canCopy, click: () => actions.copy() },
    { label: '粘贴', accelerator: 'CmdOrCtrl+V', enabled: flags.canPaste, click: () => actions.paste() },
    { type: 'separator' },
    { label: '删除', accelerator: 'Delete', enabled: flags.canDelete, click: () => actions.remove() },
    { label: '全选', accelerator: 'CmdOrCtrl+A', enabled: flags.canSelectAll, click: () => actions.selectAll() }
  ]
}

/**
 * 在 webContents 上注册原生右键编辑菜单。在 createWindow 创建窗口后调用一次。
 */
export function registerEditContextMenu(contents: WebContents, getWindow: () => BrowserWindow | null): void {
  contents.on('context-menu', (_event, params) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    const wc = window.webContents
    const template = buildEditContextMenuTemplate(params.editFlags, {
      cut: () => wc.cut(),
      copy: () => wc.copy(),
      paste: () => wc.paste(),
      remove: () => wc.delete(),
      selectAll: () => wc.selectAll()
    })
    Menu.buildFromTemplate(template).popup({ window })
  })
}
