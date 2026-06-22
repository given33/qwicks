/**
 * 桌面宠物窗口的 preload（M1 起，M4 扩展）。
 *
 * 暴露给渲染层（petWindow + consoleWindow）的 API：
 *   - setInteractive: 点击穿透切换（M1）
 *   - getState/onStateChanged: 状态查询/订阅（M4）
 *   - feed/bath/cure/useItem/buy/toggleConsole: 照料动作（M4）
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pet', {
  setInteractive: (interactive: boolean): void => {
    void ipcRenderer.invoke('pet:set-ignore-mouse-events', interactive)
  },
  getState: (): Promise<unknown> => ipcRenderer.invoke('pet:get-state'),
  onStateChanged: (cb: (state: unknown) => void): (() => void) => {
    const listener = (_e: unknown, state: unknown): void => cb(state)
    ipcRenderer.on('pet:state-changed', listener)
    return () => ipcRenderer.removeListener('pet:state-changed', listener)
  },
  onAchievementUnlocked: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('pet:achievement-unlocked', listener)
    return () => ipcRenderer.removeListener('pet:achievement-unlocked', listener)
  },
  feed: (itemId: string): Promise<unknown> => ipcRenderer.invoke('pet:feed', itemId),
  bath: (itemId: string): Promise<unknown> => ipcRenderer.invoke('pet:bath', itemId),
  cure: (itemId: string): Promise<unknown> => ipcRenderer.invoke('pet:cure', itemId),
  useItem: (itemId: string): Promise<unknown> => ipcRenderer.invoke('pet:use-item', itemId),
  buy: (itemId: string): Promise<unknown> => ipcRenderer.invoke('pet:buy', itemId),
  pet: (): Promise<unknown> => ipcRenderer.invoke('pet:pet'),
  play: (): Promise<unknown> => ipcRenderer.invoke('pet:play'),
  signIn: (): Promise<unknown> => ipcRenderer.invoke('pet:sign-in'),
  toggleConsole: (): void => {
    void ipcRenderer.invoke('pet:toggle-console')
  },
  getDiary: (): Promise<unknown> => ipcRenderer.invoke('pet:get-diary'),
  reward: (amount: number): Promise<unknown> => ipcRenderer.invoke('pet:reward', amount),
  pay: (amount: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('pet:pay', amount),
  diaryAppend: (icon: string, text: string): Promise<unknown> => ipcRenderer.invoke('pet:diary-append', icon, text)
})
