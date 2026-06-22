/**
 * 桌面宠物窗口的 preload（M1）。
 *
 * petWindow 走 contextIsolation + sandbox，渲染层无法直接用 Node/Electron API。
 * 这里只暴露点击穿透切换这一个最小 API —— 渲染层热区检测后调用它，
 * 主进程据此 setIgnoreMouseEvents。后续模块（状态/动作）按需在此扩展。
 *
 * 用 ESM import（与 index.ts 一致），electron-vite 的 preload 配置会输出为 pet.cjs。
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pet', {
  /** 鼠标进入精灵热区时传 true（关穿透、可交互），离开时传 false（恢复穿透） */
  setInteractive: (interactive: boolean): void => {
    void ipcRenderer.invoke('pet:set-ignore-mouse-events', interactive)
  }
})
