/**
 * 桌面宠物 IPC handlers（M4-T3）。
 *
 * 注册所有 pet:* 频道：状态查询、喂食/洗澡/看病/摸头/玩耍/购买/签到。
 * 全部路由到 PetStateStore，让纯函数（applyItemEffect/buyItem 等）处理业务逻辑。
 */
import { BrowserWindow, ipcMain, screen } from 'electron'
import { getPetStateStore } from './pet-state-store'
import { getDiaryStore } from './pet-diary-store'
import { toggleConsoleWindow } from './pet-console-window'
import {
  applyItemEffect,
  applySignIn,
  buyItem,
  consumeItem,
  todayString,
  type PetItem
} from '../shared/pet-state'
import { addExp } from '../shared/pet-growth'
import { canMarry, defaultMarriage, divorce, generateSuitor, layEgg, marry } from '../shared/pet-marriage'
import { TICKLE_REACTIONS, resolveTickle, type TickleType } from '../shared/pet-tickle'
import { canEnroll, canWork, completeEducation, defaultCareer, EDUCATION_LEVELS, workReward, type EducationLevel, type JobId } from '../shared/pet-career'
import { filterValidObstacles } from '../shared/pet-obstacles'
import { personalityMods } from '../shared/pet-festivals'
import { findItem } from '../shared/pet-catalog'

let registered = false

export function registerPetStateIpc(): void {
  if (registered) return
  registered = true
  const store = getPetStateStore()

  // 广播成就解锁到所有 pet 窗口（Steam 式弹窗）
  const broadcastAchievement = (id: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send('pet:achievement-unlocked', id)
      } catch {
        // 窗口销毁中
      }
    }
  }

  // 记录动作 + 广播新成就 + 写档案日志
  const recordAndBroadcast = (action: import('./pet-achievement-tracker').PetAction): void => {
    const newly = store.recordAction(action)
    for (const id of newly) broadcastAchievement(id)
    // M8 写档案
    const diaryIcon: Record<string, string> = {
      feed: '🍖', bath: '🛁', cure: '💊', pet: '🤚', play: '🎾', signIn: '📅',
      revive: '✨', collapse: '💀', activity: '✨', buy: '🛒'
    }
    const diaryText: Record<string, string> = {
      feed: '吃了一顿饭', bath: '洗了个澡', cure: '看了病', pet: '被摸了摸头',
      play: '玩了会儿', signIn: '完成了每日签到', revive: '被还魂丹救活',
      collapse: '倒下了', activity: '做了一个活动', buy: '买了一件东西'
    }
    void getDiaryStore().append(diaryIcon[action] ?? '•', diaryText[action] ?? action)
  }

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
  const useTypedItem = (itemId: string, expectedType: PetItem['type'], action: 'feed' | 'bath' | 'cure') => {
    let result: { ok: boolean; message?: string } = { ok: false, message: 'not found' }
    store.update((state) => {
      const { state: next, item } = consumeItem(state, itemId)
      if (!item || item.type !== expectedType) return state
      result = { ok: true }
      return applyItemEffect(next, item)
    })
    if (result.ok) recordAndBroadcast(action)
    return result
  }
  ipcMain.handle('pet:feed', (_e, itemId: string) => useTypedItem(itemId, 'food', 'feed'))
  ipcMain.handle('pet:bath', (_e, itemId: string) => useTypedItem(itemId, 'bath', 'bath'))
  ipcMain.handle('pet:cure', (_e, itemId: string) => useTypedItem(itemId, 'medicine', 'cure'))

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
    // BUG-2 修复：购买成功记录动作 → itemsOwned 累加 → items-10 成就可达
    if (result.ok) recordAndBroadcast('buy')
    return result
  })

  // 摸头：免费提升 mood + 经验
  ipcMain.handle('pet:pet', () => {
    store.update((state) => {
      const { growth } = state.growth ? addExp(state.growth, 10) : { growth: state.growth }
      return {
        ...state,
        vitals: { ...state.vitals, mood: Math.min(100, state.vitals.mood + 5) },
        growth
      }
    })
    recordAndBroadcast('pet')
    return { ok: true }
  })

  // 玩耍：免费提升 mood + 经验
  ipcMain.handle('pet:play', () => {
    store.update((state) => {
      const { growth } = state.growth ? addExp(state.growth, 15) : { growth: state.growth }
      return {
        ...state,
        vitals: { ...state.vitals, mood: Math.min(100, state.vitals.mood + 10) },
        growth
      }
    })
    recordAndBroadcast('play')
    return { ok: true }
  })

  // 每日签到 + 经验
  ipcMain.handle('pet:sign-in', () => {
    const today = todayString()
    let awarded = false
    store.update((state) => {
      const r = applySignIn(state, today)
      awarded = r.awarded
      if (!awarded) return state
      const { growth } = r.state.growth ? addExp(r.state.growth, 20) : { growth: r.state.growth }
      return { ...r.state, growth }
    })
    if (awarded) recordAndBroadcast('signIn')
    return { ok: true, awarded }
  })

  // 切换控制台窗口显隐（M4-T7）
  ipcMain.handle('pet:toggle-console', () => {
    toggleConsoleWindow()
  })

  // M8 档案：读取日志
  ipcMain.handle('pet:get-diary', async () => {
    const d = getDiaryStore()
    await d.load()
    return d.get()
  })

  // M8 档案：追加日志（活动执行器/各事件调用）
  ipcMain.handle('pet:diary-append', async (_e, icon: string, text: string) => {
    await getDiaryStore().append(icon, text)
    return { ok: true }
  })

  // M9-M11 奖励元宝（钓鱼/农场/小游戏结算用）
  ipcMain.handle('pet:reward', (_e, amount: number) => {
    store.update((state) => ({ ...state, coins: state.coins + Math.max(0, Math.floor(amount)) }))
    // BUG-13 修复：reward 后检测成就（rich-500）
    recordAndBroadcast('buy') // 复用 buy action 触发成就检测（会读 coins）
    return { ok: true }
  })

  // M10 扣元宝（农场买种子等，元宝不足拒绝）
  ipcMain.handle('pet:pay', (_e, amount: number) => {
    let ok = false
    store.update((state) => {
      if (state.coins < amount) return state
      ok = true
      return { ...state, coins: state.coins - Math.max(0, Math.floor(amount)) }
    })
    return { ok }
  })

  // M12 婚育：相亲（生成候选 + 结婚）
  ipcMain.handle('pet:marry', () => {
    let result: { ok: boolean; partnerName?: string } = { ok: false }
    store.update((state) => {
      const growth = state.growth
      if (!growth || !canMarry(growth)) return state
      const suitor = generateSuitor()
      const marriage = marry(state.marriage ?? defaultMarriage(), suitor, Date.now())
      result = { ok: true, partnerName: suitor.name }
      void getDiaryStore().append('💍', `与 ${suitor.name} 喜结连理！`)
      return { ...state, marriage }
    })
    return result
  })

  // M12 培育宠物蛋
  ipcMain.handle('pet:lay-egg', () => {
    let result: { ok: boolean; eggs?: number } = { ok: false }
    store.update((state) => {
      const { state: nextState, laid } = layEgg(state.marriage ?? defaultMarriage(), Date.now())
      if (!laid) return state
      result = { ok: true, eggs: nextState.eggs }
      void getDiaryStore().append('🥚', '培育了一枚宠物蛋！')
      return { ...state, marriage: nextState }
    })
    return result
  })

  // M12 离婚
  ipcMain.handle('pet:divorce', () => {
    store.update((state) => ({ ...state, marriage: divorce(state.marriage ?? defaultMarriage()) }))
    return { ok: true }
  })

  // P2 Tickle 互动：摸/戳/逗/挑/痒 等 35 种，每种触发独特反应
  // P4 个性影响互动心情加成（温柔系宠物被摸更开心等）
  ipcMain.handle('pet:tickle', (_e, type: string) => {
    if (!(type in TICKLE_REACTIONS)) return { ok: false }
    const reaction = resolveTickle(type as TickleType)
    store.update((state) => {
      const mods = state.personality ? personalityMods(state.personality) : null
      const moodMult = mods ? mods.petMoodMultiplier : 1
      // 摸头类互动用 petMoodMultiplier，其他用 1（避免所有互动都放大）
      const isPetType = type === 'pet' || type === 'stroke' || type === 'pat'
      const adjustedMood = isPetType ? Math.round(reaction.moodDelta * moodMult) : reaction.moodDelta
      return {
        ...state,
        vitals: {
          ...state.vitals,
          mood: Math.max(0, Math.min(100, state.vitals.mood + adjustedMood)),
          hunger: Math.max(0, Math.min(100, state.vitals.hunger + (reaction.hungerDelta ?? 0)))
        }
      }
    })
    recordAndBroadcast('pet')
    void getDiaryStore().append('✨', reaction.text)
    return { ok: true, reaction }
  })

  // P3 学习：完成某学历（扣心情+时长，加属性+学历）
  ipcMain.handle('pet:study', (_e, level: string) => {
    let result: { ok: boolean; reason?: string } = { ok: false, reason: 'invalid' }
    store.update((state) => {
      const career = state.career ?? defaultCareer()
      const check = canEnroll(career, level as EducationLevel)
      if (!check.ok) {
        result = { ok: false, reason: check.reason }
        return state
      }
      const def = EDUCATION_LEVELS.find((e) => e.id === level)
      const mood = Math.max(0, state.vitals.mood - (def?.cost.mood ?? 0))
      result = { ok: true }
      void getDiaryStore().append('🎓', `完成了${def?.name}学业`)
      return {
        ...state,
        vitals: { ...state.vitals, mood },
        career: completeEducation(career, level as EducationLevel)
      }
    })
    return result
  })

  // P3 打工：得元宝，扣心情（疲劳）。R3: 每日上限 5 次防经济崩塌（B1 修复）
  const WORK_DAILY_LIMIT = 5
  ipcMain.handle('pet:work', (_e, jobId: string) => {
    let result: { ok: boolean; reason?: string; coins?: number } = { ok: false, reason: 'invalid' }
    store.update((state) => {
      const career = state.career ?? defaultCareer()
      const check = canWork(career, jobId as JobId)
      if (!check.ok) {
        result = { ok: false, reason: check.reason }
        return state
      }
      // B1 修复：每日打工次数上限
      const today = new Date().toISOString().slice(0, 10)
      const workDate = state.workDate ?? today
      const count = workDate === today ? (state.workCountToday ?? 0) : 0
      if (count >= WORK_DAILY_LIMIT) {
        result = { ok: false, reason: `今日打工已达上限（${WORK_DAILY_LIMIT}次）` }
        return state
      }
      const reward = workReward(jobId as JobId)
      result = { ok: true, coins: reward.coins }
      void getDiaryStore().append('💼', `打工赚了 ${reward.coins} 元宝`)
      return {
        ...state,
        coins: state.coins + reward.coins,
        vitals: { ...state.vitals, mood: Math.max(0, state.vitals.mood + reward.moodDelta) },
        workDate: today,
        workCountToday: count + 1
      }
    })
    return result
  })

  // P6 桌面深度互动：返回当前桌面上其他可见窗口的 bounds（供宠物避让）
  ipcMain.handle('pet:get-obstacles', () => {
    const obstacles = BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible() && !w.isAlwaysOnTop())
      .map((w) => w.getBounds())
      .map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }))
    return filterValidObstacles(obstacles)
  })

  // P0 跨屏寻路：返回所有显示器 bounds（供渲染层建 walkable-graph）
  ipcMain.handle('pet:get-displays', () => {
    return screen.getAllDisplays().map((d) => ({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }))
  })
}
