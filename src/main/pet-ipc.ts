/**
 * 桌面宠物 IPC handlers（M4-T3）。
 *
 * 注册所有 pet:* 频道：状态查询、喂食/洗澡/看病/摸头/玩耍/购买/签到。
 * 全部路由到 PetStateStore，让纯函数（applyItemEffect/buyItem 等）处理业务逻辑。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { getPetStateStore } from './pet-state-store'
import { toggleConsoleWindow } from './pet-console-window'
import {
  applyItemEffect,
  applySignIn,
  buyItem,
  consumeItem,
  todayString,
  type PetItem
} from '../shared/pet-state'
import { findItem } from '../shared/pet-catalog'

let registered = false

export function registerPetStateIpc(): void {
  if (registered) return
  registered = true
  const store = getPetStateStore()

  // 状态变化广播
  store.subscribe((state) => {
    // 广播到所有 pet 相关窗口（petWindow + consoleWindow）
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send('pet:state-changed', state)
      } catch {
        // 窗口可能正在销毁
      }
    }
  })

  ipcMain.handle('pet:get-state', () => store.get())

  // 通用：使用库存里的某道具（应用效果 + 消耗）
  ipcMain.handle('pet:use-item', (_e, itemId: string) => {
    let result: { ok: boolean; message?: string } = { ok: false, message: 'item not in inventory' }
    store.update((state) => {
      const { state: next, item } = consumeItem(state, itemId)
      if (!item) return state
      result = { ok: true }
      return applyItemEffect(next, item)
    })
    return result
  })

  // 类型化便捷接口：feed/bath/cure 都是"用库存里对应类型道具"
  const useTypedItem = (itemId: string, expectedType: PetItem['type']) => {
    let result: { ok: boolean; message?: string } = { ok: false, message: 'not found' }
    store.update((state) => {
      const { state: next, item } = consumeItem(state, itemId)
      if (!item || item.type !== expectedType) return state
      result = { ok: true }
      return applyItemEffect(next, item)
    })
    return result
  }
  ipcMain.handle('pet:feed', (_e, itemId: string) => useTypedItem(itemId, 'food'))
  ipcMain.handle('pet:bath', (_e, itemId: string) => useTypedItem(itemId, 'bath'))
  ipcMain.handle('pet:cure', (_e, itemId: string) => useTypedItem(itemId, 'medicine'))

  // 购买：扣元宝入库存
  ipcMain.handle('pet:buy', (_e, itemId: string) => {
    const item = findItem(itemId)
    if (!item) return { ok: false, message: 'unknown item' }
    let result: { ok: boolean; message?: string } = { ok: false, message: 'insufficient coins' }
    store.update((state) => {
      const next = buyItem(state, item)
      if (next === state) return state // 元宝不足
      result = { ok: true }
      return next
    })
    return result
  })

  // 摸头：免费提升 mood
  ipcMain.handle('pet:pet', () => {
    store.update((state) => ({
      ...state,
      vitals: { ...state.vitals, mood: Math.min(100, state.vitals.mood + 5) }
    }))
    return { ok: true }
  })

  // 玩耍：免费提升 mood（玩具效果，无需道具）
  ipcMain.handle('pet:play', () => {
    store.update((state) => ({
      ...state,
      vitals: { ...state.vitals, mood: Math.min(100, state.vitals.mood + 10) }
    }))
    return { ok: true }
  })

  // 每日签到
  ipcMain.handle('pet:sign-in', () => {
    const today = todayString()
    let awarded = false
    store.update((state) => {
      const r = applySignIn(state, today)
      awarded = r.awarded
      return r.state
    })
    return { ok: true, awarded }
  })

  // 切换控制台窗口显隐（M4-T7）
  ipcMain.handle('pet:toggle-console', () => {
    toggleConsoleWindow()
  })
}
