// src/main/mqpet-ipc.ts
// mqpet:* IPC handlers。模式移植自 pet-ipc.ts。
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  getMqpetStateStore, mutateUseItem, mutateBuy, mutateWork, mutateLearn, mutateInteract, mutateSyncUnityState,
} from './mqpet-state-store';
import { normalizeConsolePanelRequest } from '../shared/mqpet-console-panel';
import { readMqpetSourceAsset } from './mqpet-source-file';
import { resolveMqpetUnityBuild } from './mqpet-unity-build';

let registered = false;

function broadcast(save: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.webContents.send('mqpet:state-changed', save); } catch { /* window tearing down */ }
  }
}

export function registerMqpetStateIpc(): void {
  if (registered) return;
  registered = true;
  const store = getMqpetStateStore();
  store.subscribe(broadcast);

  ipcMain.handle('mqpet:get-state', () => store.getSnapshot());
  ipcMain.handle('mqpet:use-item', (_e, itemId: string) => mutateUseItem(store, itemId));
  ipcMain.handle('mqpet:buy', (_e, itemId: string) => mutateBuy(store, itemId));
  ipcMain.handle('mqpet:work', () => mutateWork(store));
  ipcMain.handle('mqpet:learn', () => mutateLearn(store));
  ipcMain.handle('mqpet:interact', () => mutateInteract(store));
  ipcMain.handle('mqpet:sync-unity-state', (_e, payload: unknown) => mutateSyncUnityState(store, payload));
  ipcMain.handle('mqpet:get-source-asset', async (_e, sourcePath: string) => readMqpetSourceAsset(sourcePath));
  ipcMain.handle('mqpet:get-unity-build', () => resolveMqpetUnityBuild({
    env: process.env,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
  }));
  ipcMain.handle('mqpet:toggle-console', async () => {
    const { toggleConsoleWindow } = await import('./mqpet-console-window');
    toggleConsoleWindow();
  });
  ipcMain.handle('mqpet:open-console-panel', async (_e, request: unknown) => {
    const { openConsolePanel } = await import('./mqpet-console-window');
    openConsolePanel(normalizeConsolePanelRequest(request));
  });
}
