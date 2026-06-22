/**
 * 桌面宠物控制台窗口（M4-T7）。
 *
 * 第三个 BrowserWindow（main/pet/console）。常驻面板，承载 6 tab
 * （M4 先做照料/库存/商店/设置 4 个，成就/档案 tab 占位待 M7/M8）。
 * 默认隐藏，右键宠物/双击/托盘唤出。
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let consoleWindow: BrowserWindow | null = null

function resolveConsoleRendererPath(): string {
  return join(__dirname, '../renderer/console.html')
}

function resolveConsolePreloadPath(): string {
  return join(__dirname, '../preload/pet.cjs')
}

export function createConsoleWindow(): BrowserWindow {
  if (consoleWindow && !consoleWindow.isDestroyed()) return consoleWindow
  consoleWindow = new BrowserWindow({
    width: 360,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: resolveConsolePreloadPath(),
      contextIsolation: true,
      sandbox: true
    }
  })
  consoleWindow.setAlwaysOnTop(true, 'screen-saver')
  consoleWindow.once('ready-to-show', () => {
    if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.show()
  })
  consoleWindow.on('closed', () => {
    consoleWindow = null
  })
  void consoleWindow.loadFile(resolveConsoleRendererPath())
  return consoleWindow
}

export function getConsoleWindow(): BrowserWindow | null {
  return consoleWindow && !consoleWindow.isDestroyed() ? consoleWindow : null
}

export function toggleConsoleWindow(): void {
  const win = getConsoleWindow()
  if (!win) {
    createConsoleWindow()
    return
  }
  if (win.isVisible()) win.hide()
  else win.show()
}

export function destroyConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.destroy()
  consoleWindow = null
}
