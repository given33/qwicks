// src/preload/mqpet.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { MqpetConsolePanelRequest } from '../shared/mqpet-console-panel';
import type { MqpetUnityBuildStatus } from '../shared/mqpet-unity-build';

contextBridge.exposeInMainWorld('mqpet', {
  // 上报企鹅 bbox(屏幕坐标)给主进程，用于轮询判断穿透。
  reportBBox: (bbox: { x: number; y: number; w: number; h: number } | null): void => {
    ipcRenderer.send('mqpet:penguin-bbox', bbox);
  },
  // 拖动状态：拖动时主进程强制保持非穿透(否则mouseup丢失，企鹅黏住鼠标)。
  setDragging: (dragging: boolean): void => {
    ipcRenderer.send('mqpet:dragging', dragging);
  },
  // 心跳：渲染进程存活上报
  heartbeat: (): void => {
    ipcRenderer.send('mqpet:heartbeat');
  },
  // 渲染进程日志转主进程(用于诊断)
  log: (msg: string): void => {
    ipcRenderer.send('mqpet:renderer-log', msg);
  },
  getState: (): Promise<unknown> => ipcRenderer.invoke('mqpet:get-state'),
  onStateChanged: (cb: (state: unknown) => void): (() => void) => {
    const listener = (_e: unknown, state: unknown): void => cb(state);
    ipcRenderer.on('mqpet:state-changed', listener);
    return () => ipcRenderer.removeListener('mqpet:state-changed', listener);
  },
  useItem: (itemId: string): Promise<unknown> => ipcRenderer.invoke('mqpet:use-item', itemId),
  buy: (itemId: string): Promise<unknown> => ipcRenderer.invoke('mqpet:buy', itemId),
  work: (): Promise<unknown> => ipcRenderer.invoke('mqpet:work'),
  learn: (): Promise<unknown> => ipcRenderer.invoke('mqpet:learn'),
  interact: (): Promise<unknown> => ipcRenderer.invoke('mqpet:interact'),
  getSourceAsset: (sourcePath: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('mqpet:get-source-asset', sourcePath),
  getUnityBuild: (): Promise<MqpetUnityBuildStatus> => ipcRenderer.invoke('mqpet:get-unity-build'),
  toggleConsole: (): Promise<unknown> => ipcRenderer.invoke('mqpet:toggle-console'),
  openConsolePanel: (request: MqpetConsolePanelRequest): Promise<unknown> => ipcRenderer.invoke('mqpet:open-console-panel', request),
  onConsolePanelRequest: (cb: (request: MqpetConsolePanelRequest) => void): (() => void) => {
    const listener = (_e: unknown, request: MqpetConsolePanelRequest): void => cb(request);
    ipcRenderer.on('mqpet:console-panel', listener);
    return () => ipcRenderer.removeListener('mqpet:console-panel', listener);
  },
});
