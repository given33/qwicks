// src/main/mqpet-console-window.ts
// MQPet 控制台窗口（环形菜单点开后弹出）。移植自 pet-console-window.ts。
import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { normalizeConsolePanelRequest, type MqpetConsolePanelRequest } from '../shared/mqpet-console-panel';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
let consoleWindow: BrowserWindow | null = null;

function resolveIndexPath(): string { return join(__dirname, '../renderer/mqconsole.html'); }
function resolvePreloadPath(): string { return join(__dirname, '../preload/mqpet.cjs'); }

export function createConsoleWindow(): BrowserWindow {
  if (consoleWindow && !consoleWindow.isDestroyed()) return consoleWindow;
  consoleWindow = new BrowserWindow({
    width: 440, height: 540,
    frame: false, transparent: true, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: { preload: resolvePreloadPath(), contextIsolation: true, sandbox: true },
  });
  consoleWindow.setAlwaysOnTop(true, 'screen-saver');
  consoleWindow.once('ready-to-show', () => {
    if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.show();
  });
  consoleWindow.on('closed', () => { consoleWindow = null; });
  // dev 模式用 dev server URL(electron-vite 注入 ELECTRON_RENDERER_URL)，否则用打包文件。
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void consoleWindow.loadURL(`${devUrl}/mqconsole.html`);
  } else {
    void consoleWindow.loadFile(resolveIndexPath());
  }
  return consoleWindow;
}

export function getConsoleWindow(): BrowserWindow | null { return consoleWindow; }

export function toggleConsoleWindow(): void {
  const win = getConsoleWindow();
  if (!win || win.isDestroyed()) { createConsoleWindow(); return; }
  if (win.isVisible()) win.hide(); else win.show();
}

export function openConsolePanel(request: MqpetConsolePanelRequest): void {
  const panel = normalizeConsolePanelRequest(request);
  const win = createConsoleWindow();
  const send = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send('mqpet:console-panel', panel);
  };
  if (!win.isVisible()) win.show();
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

export function destroyConsoleWindow(): void {
  const win = getConsoleWindow();
  if (win && !win.isDestroyed()) win.destroy();
  consoleWindow = null;
}
