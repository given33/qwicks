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
        vitals: { ...base.vitals, ...parsed.vitals }
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
      await writeFile(PET_STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8')
    } catch (error) {
      console.warn('[pet-state] failed to flush:', error)
    }
  }

  private startTick(): void {
    this.tickTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.state.lastTickAt
      if (elapsed < 1000) return
      const vitals = tickVitals(this.state.vitals, elapsed)
      this.state = {
        ...this.state,
        vitals,
        status: deriveStatus(vitals),
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
