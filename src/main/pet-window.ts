/**
 * 桌面宠物透明置顶窗口（M1）。
 *
 * petWindow 是一个覆盖"所有显示器并集"的透明、置顶、点击穿透的 BrowserWindow。
 * 宠物在这个连续的逻辑像素坐标空间里游走（M1 先做当前屏内，无缝跨屏见 M3）。
 *
 * 关键技术点：
 *   - 透明窗 + setIgnoreMouseEvents(true,{forward:true})：默认全窗鼠标穿透到
 *     桌面；`forward:true` 让穿透状态下 mousemove 仍转发到渲染层，渲染层据此
 *     检测鼠标是否进入精灵 bbox，进入时切回可交互（见 toggleInteractive）。
 *   - alwaysOnTop 'screen-saver'：提到合成器最高层，压在普通窗口之上。
 *   - movable:false + 固定 setBounds(并集)：窗口铺满不动，鼠标拖的是精灵不是窗口。
 *   - skipTaskbar + focusable:false：不占任务栏、不抢焦点。
 *
 * 这是 R1（超大透明窗合成性能）+ R2（点击穿透准确性）的载体，首次启动即验证。
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeVirtualDesktopBounds, type VirtualDesktopBounds } from '../shared/pet-display'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let petWindow: BrowserWindow | null = null
let petIpcRegistered = false

/**
 * 解析 pet renderer 的 html。
 * pet.html 与主窗口 index.html 同在 src/renderer/，构建后都输出到 out/renderer/。
 */
function resolvePetRendererIndexPath(): string {
  return join(__dirname, '../renderer/pet.html')
}

/** 解析 pet preload。打包后 preload 输出在 ../preload/，与主窗口同源。 */
function resolvePetPreloadPath(): string {
  return join(__dirname, '../preload/pet.cjs')
}

/**
 * 注册渲染层→主进程的穿透切换 IPC。幂等：多次调用只注册一次。
 * 渲染层热区检测后 invoke('pet:set-ignore-mouse-events', interactive)。
 */
export function registerPetIpc(): void {
  if (petIpcRegistered) return
  petIpcRegistered = true
  ipcMain.handle('pet:set-ignore-mouse-events', (_event, interactive: boolean) => {
    setPetWindowInteractive(Boolean(interactive))
  })
}

/** 取所有显示器并集，用于把窗口铺满虚拟桌面。 */
export function getCurrentVirtualDesktopBounds(): VirtualDesktopBounds {
  const displays = screen.getAllDisplays().map((display) => display.bounds)
  return computeVirtualDesktopBounds(displays)
}

/**
 * 创建桌面宠物窗口。已存在则不重复创建。
 * 默认创建后隐藏，由调用方决定何时 show（ready-to-show 后，避免白闪）。
 */
export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow

  const bounds = getCurrentVirtualDesktopBounds()
  petWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: resolvePetPreloadPath(),
      contextIsolation: true,
      sandbox: true
    }
  })

  // 提到合成器最高层，覆盖普通窗口与全屏应用（macOS 全屏另见 setVisibleOnAllWorkspaces）
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 默认全窗点击穿透；forward 让 mousemove 仍转发，渲染层据此切换交互态
  petWindow.setIgnoreMouseEvents(true, { forward: true })

  // ready-to-show 后再显示，避免透明窗未合成完毕时的白闪
  petWindow.once('ready-to-show', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.show()
  })

  petWindow.on('closed', () => {
    petWindow = null
  })

  void petWindow.loadFile(resolvePetRendererIndexPath())
  return petWindow
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null
}

export function destroyPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy()
  petWindow = null
}

/** 显隐宠物窗口（托盘开关用）。 */
export function setPetWindowVisible(visible: boolean): void {
  const window = getPetWindow()
  if (!window) return
  if (visible) window.show()
  else window.hide()
}

export function isPetWindowVisible(): boolean {
  const window = getPetWindow()
  return window ? window.isVisible() : false
}

/**
 * 渲染层热区检测后调用：鼠标进入精灵 bbox 时切为可交互（关穿透），
 * 离开时切回穿透。这是 R2 点击穿透准确性的核心机制。
 */
export function setPetWindowInteractive(interactive: boolean): void {
  const window = getPetWindow()
  if (!window) return
  window.setIgnoreMouseEvents(!interactive, { forward: !interactive })
}

/**
 * 显示器分辨率/数量/位置变化时重算并集并重设窗口尺寸（M1-T4）。
 * 同步把新并集推给渲染层，渲染层据此重定位宠物到合法坐标。
 */
export function relayoutPetWindowToDisplays(): VirtualDesktopBounds | null {
  const window = getPetWindow()
  if (!window) return null
  const bounds = getCurrentVirtualDesktopBounds()
  window.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  return bounds
}
