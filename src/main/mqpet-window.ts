import { BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  computeMqpetShellInteraction,
  normalizeMqpetBBox,
  type MqpetBBox,
} from './mqpet-window-shell';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mqpetWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let penguinBBox: MqpetBBox | null = null;
let isDragging = false;
let draggingStartedAt = 0;
let pollTimer: NodeJS.Timeout | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentlyInteractive = false;
let desiredVisible = true;
let lastHeartbeat = 0;

function resolveIndexPath(): string { return join(__dirname, '../renderer/mqpet.html'); }
function resolvePreloadPath(): string { return join(__dirname, '../preload/mqpet.cjs'); }

function getCurrentVirtualDesktopBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return { x: 0, y: 0, width: 1280, height: 720 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const display of displays) {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function startClickThroughPoll(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const win = getMqpetWindow();
    if (!win || win.isDestroyed()) return;
    const decision = computeMqpetShellInteraction({
      bbox: penguinBBox,
      cursor: screen.getCursorScreenPoint(),
      windowBounds: win.getBounds(),
      dragging: isDragging,
      draggingStartedAt,
      now: Date.now(),
    });
    if (decision.shouldClearDragging) {
      isDragging = false;
      draggingStartedAt = 0;
    }
    if (decision.interactive !== currentlyInteractive) {
      currentlyInteractive = decision.interactive;
      win.setIgnoreMouseEvents(!decision.interactive, { forward: !decision.interactive });
    }
  }, 50);
}

function stopClickThroughPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startKeepAlive(): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    const win = getMqpetWindow();
    if (!win || win.isDestroyed()) return;
    try {
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
      if (desiredVisible && !win.isVisible()) {
        win.show();
        console.warn('[mqpet] KEEPALIVE: re-showed');
      }
      const bounds = win.getBounds();
      const desktop = getCurrentVirtualDesktopBounds();
      if (bounds.x < desktop.x - 50 || bounds.y < desktop.y - 50
        || bounds.x + bounds.width > desktop.x + desktop.width + 50
        || bounds.y + bounds.height > desktop.y + desktop.height + 50) {
        console.warn('[mqpet] KEEPALIVE: bounds out of screen, re-centering');
        win.setBounds(desktop);
      }
    } catch {
      // Window is tearing down.
    }
  }, 1000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startHeartbeatWatch(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (lastHeartbeat > 0 && Date.now() - lastHeartbeat > 5000) {
      console.warn('[mqpet] heartbeat lost (renderer frozen?)');
    }
  }, 2000);
}

function stopHeartbeatWatch(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function registerMqpetIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('mqpet:penguin-bbox', (_event, bbox: MqpetBBox | null) => {
    penguinBBox = normalizeMqpetBBox(bbox);
  });
  ipcMain.on('mqpet:dragging', (_event, dragging: boolean) => {
    const next = Boolean(dragging);
    isDragging = next;
    draggingStartedAt = next ? Date.now() : 0;
  });
  ipcMain.on('mqpet:renderer-log', (_event, msg: string) => {
    console.log(`[mqpet-renderer] ${msg}`);
  });
  ipcMain.on('mqpet:heartbeat', () => {
    lastHeartbeat = Date.now();
  });
}

export function createMqpetWindow(): BrowserWindow {
  if (mqpetWindow && !mqpetWindow.isDestroyed()) return mqpetWindow;
  const bounds = getCurrentVirtualDesktopBounds();
  desiredVisible = true;
  lastHeartbeat = 0;
  mqpetWindow = new BrowserWindow({
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
    webPreferences: { preload: resolvePreloadPath(), contextIsolation: true, sandbox: true },
  });
  mqpetWindow.setAlwaysOnTop(true, 'screen-saver');
  mqpetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mqpetWindow.setIgnoreMouseEvents(true, { forward: true });
  currentlyInteractive = false;

  mqpetWindow.once('ready-to-show', () => {
    if (mqpetWindow && !mqpetWindow.isDestroyed() && desiredVisible) mqpetWindow.show();
  });
  mqpetWindow.webContents.once('did-finish-load', () => {
    lastHeartbeat = Date.now();
    startHeartbeatWatch();
  });
  mqpetWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[mqpet] render-process-gone:', JSON.stringify(details));
  });
  mqpetWindow.on('unresponsive', () => { console.warn('[mqpet] unresponsive'); });
  mqpetWindow.on('hide', () => { console.warn('[mqpet] HIDE event'); });
  mqpetWindow.on('minimize', () => { console.warn('[mqpet] MINIMIZE event'); });
  mqpetWindow.on('blur', () => { console.warn('[mqpet] BLUR event'); });
  mqpetWindow.on('show', () => { console.warn('[mqpet] SHOW event'); });
  mqpetWindow.on('restore', () => { console.warn('[mqpet] RESTORE event'); });
  mqpetWindow.on('closed', () => {
    stopClickThroughPoll();
    stopKeepAlive();
    stopHeartbeatWatch();
    penguinBBox = null;
    isDragging = false;
    draggingStartedAt = 0;
    currentlyInteractive = false;
    mqpetWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mqpetWindow.loadURL(`${devUrl}/mqpet.html`);
  } else {
    void mqpetWindow.loadFile(resolveIndexPath());
  }
  startClickThroughPoll();
  startKeepAlive();
  return mqpetWindow;
}

export function getMqpetWindow(): BrowserWindow | null { return mqpetWindow; }

export function setMqpetWindowInteractive(interactive: boolean): void {
  const win = getMqpetWindow();
  if (!win || win.isDestroyed()) return;
  currentlyInteractive = interactive;
  win.setIgnoreMouseEvents(!interactive, { forward: !interactive });
}

export function setMqpetWindowVisible(visible: boolean): void {
  desiredVisible = visible;
  const win = getMqpetWindow();
  if (!win || win.isDestroyed()) return;
  if (visible) win.show(); else win.hide();
}

export function isMqpetWindowVisible(): boolean {
  const win = getMqpetWindow();
  return desiredVisible && !!win && !win.isDestroyed() && win.isVisible();
}

export function relayoutMqpetWindowToDisplays(): void {
  const win = getMqpetWindow();
  if (!win || win.isDestroyed()) return;
  win.setBounds(getCurrentVirtualDesktopBounds());
}

export function destroyMqpetWindow(): void {
  stopClickThroughPoll();
  stopKeepAlive();
  stopHeartbeatWatch();
  const win = getMqpetWindow();
  if (win && !win.isDestroyed()) win.destroy();
  penguinBBox = null;
  isDragging = false;
  draggingStartedAt = 0;
  currentlyInteractive = false;
  mqpetWindow = null;
}
