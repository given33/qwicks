/**
 * 桌面宠物状态持久化（M4-T2）。
 *
 * 读写 ~/.qwicks/pet-state.json。启动时离线补算；后台每 30s tick 衰减。
 * debounce 1s 落盘，before-quit flush。
 *
 * 与 settings-store 分离（pet-state 变化更高频，避免 settings 写放大）。
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  applyOfflineCatchUp,
  defaultPetState,
  tickVitals,
  deriveStatus,
  type PetState
} from '../shared/pet-state'
import { advanceToAdult, canAdvanceToAdult, defaultGrowth, tickEgg } from '../shared/pet-growth'
import { personalityMods, rollPersonality, type Personality } from '../shared/pet-festivals'
import { BrowserWindow } from 'electron'
import { getDiaryStore } from './pet-diary-store'
import { defaultStats } from '../shared/pet-achievements'
import { defaultCareer } from '../shared/pet-career'
import { defaultMarriage } from '../shared/pet-marriage'
import { recordAction as recordPetAction, type PetAction } from './pet-achievement-tracker'

const PET_STATE_DIR = join(homedir(), '.qwicks')
const PET_STATE_FILE = join(PET_STATE_DIR, 'pet-state.json')

const TICK_INTERVAL_MS = 30 * 1000
const SAVE_DEBOUNCE_MS = 1000

export class PetStateStore {
  private state: PetState
  private saveTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private listeners: Array<(state: PetState) => void> = []

  constructor() {
    this.state = defaultPetState(Date.now())
  }

  /** 启动：读盘 + 离线补算 + 启动 tick。 */
  async start(): Promise<void> {
    await this.load()
    this.startTick()
  }

  /** 停止：flush + 清定时器（before-quit 用）。 */
  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
    await this.flush()
  }

  get(): PetState {
    return this.state
  }

  /** 更新状态（debounce 落盘 + 通知监听器）。 */
  update(updater: (state: PetState) => PetState): void {
    this.state = updater(this.state)
    this.scheduleSave()
    this.notify()
  }

  subscribe(listener: (state: PetState) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  /** M7: 记录一次动作，更新统计 + 检测成就，广播新解锁。返回新解锁 id。 */
  recordAction(action: PetAction): string[] {
    const { state, newlyUnlocked } = recordPetAction(this.state, action)
    this.state = state as PetState
    this.scheduleSave()
    this.notify()
    return newlyUnlocked
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state)
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(PET_STATE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PetState>
      // 合并默认值（兼容旧文件缺字段）
      const base = defaultPetState(Date.now())
      const merged: PetState = {
        ...base,
        ...parsed,
        vitals: { ...base.vitals, ...parsed.vitals },
        growth: parsed.growth ?? defaultGrowth(Date.now()),
        // BUG-22 修复：旧存档缺字段时补全默认值，防 bumpStat 产生 NaN
        stats: parsed.stats ?? defaultStats(),
        achievements: parsed.achievements ?? { unlocked: [], unlockedAt: {} },
        personality: parsed.personality,
        career: parsed.career ?? defaultCareer(),
        marriage: parsed.marriage ?? defaultMarriage()
      }
      this.state = applyOfflineCatchUp(merged, Date.now())
    } catch {
      this.state = defaultPetState(Date.now())
    }
    this.notify()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      await mkdir(PET_STATE_DIR, { recursive: true })
      // 原子写（tmp+rename），防崩溃时半截 JSON
      const tmpFile = PET_STATE_FILE + '.tmp'
      await writeFile(tmpFile, JSON.stringify(this.state, null, 2), 'utf8')
      const { rename } = await import('node:fs/promises')
      await rename(tmpFile, PET_STATE_FILE)
    } catch (error) {
      console.warn('[pet-state] failed to flush:', error)
    }
  }

  private startTick(): void {
    this.tickTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.state.lastTickAt
      if (elapsed < 1000) return
      let vitals = tickVitals(this.state.vitals, elapsed)
      // P4 个性影响：吃货饥饿衰减更快（已体现在 tickVitals 结果上，这里按 personality 微调）
      const mods = this.state.personality ? personalityMods(this.state.personality) : null
      if (mods && mods.hungerDecayMultiplier !== 1) {
        // 按倍率额外调整 hunger（>1 更快饿=更少剩余）
        const extraDecay = (vitals.hunger) * (mods.hungerDecayMultiplier - 1) * (elapsed / (1000 * 60 * 60))
        vitals = { ...vitals, hunger: Math.max(0, vitals.hunger - extraDecay) }
      }
      // M5 成长推进：蛋孵化 + 幼年晋升检查
      let growth = this.state.growth ?? defaultGrowth(now)
      let personality = this.state.personality
      if (growth.stage === 'egg') {
        const before = growth.stage
        growth = tickEgg(growth, elapsed)
        // 刚孵化成幼年 → 随机分配个性（P4）
        if (before === 'egg' && growth.stage === 'kid' && !personality) {
          personality = rollPersonality()
        }
      } else if (growth.stage === 'kid' && canAdvanceToAdult(growth, now)) {
        growth = advanceToAdult(growth, now)
        // BUG-26 修复：成年晋升设 reachedAdult → become-adult 成就可达
        const stats = { ...(this.state.stats ?? { feedCount: 0, bathCount: 0, cureCount: 0, petCount: 0, playCount: 0, signInStreak: 0, activitiesExperienced: 0, itemsOwned: 0, revivedCount: 0, maxLevel: 0, reachedAdult: false, collapsedCount: 0 }), reachedAdult: true }
        this.state = { ...this.state, stats }
        const newly = this.recordAction('pet')
        for (const id of newly) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              try { win.webContents.send('pet:achievement-unlocked', id) } catch { /* window dying */ }
            }
          }
        }
        void getDiaryStore().append('🎉', '宠物成年了！')
      }
      this.state = {
        ...this.state,
        vitals,
        status: deriveStatus(vitals),
        growth,
        personality,
        lastTickAt: now
      }
      this.scheduleSave()
      this.notify()
    }, TICK_INTERVAL_MS)
  }
}

/** 单例。 */
let storeInstance: PetStateStore | null = null

export function getPetStateStore(): PetStateStore {
  if (!storeInstance) storeInstance = new PetStateStore()
  return storeInstance
}

/** 仅供测试重置单例。 */
export function resetPetStateStoreForTest(): void {
  storeInstance = null
}

export { PET_STATE_FILE }
