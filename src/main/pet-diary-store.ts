/**
 * 桌面宠物 —— 档案日志持久化（M8）。
 *
 * ~/.qwicks/pet-diary.json，按天组织 { date: [{ ts, icon, text }] }。
 * 保留可配天数（默认 90），自动清理旧条目。
 * appendDiary 追加；getDiary 读取。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIARY_DIR = join(homedir(), '.qwicks')
const DIARY_FILE = join(DIARY_DIR, 'pet-diary.json')

export type DiaryEntry = {
  ts: number   // ms 时间戳
  icon: string
  text: string
}

export type Diary = Record<string, DiaryEntry[]>  // date(YYYY-MM-DD) → entries

const DEFAULT_RETENTION_DAYS = 90

export class PetDiaryStore {
  private diary: Diary = {}
  private loaded = false

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(DIARY_FILE, 'utf8')
      this.diary = JSON.parse(raw) as Diary
    } catch {
      this.diary = {}
    }
  }

  get(): Diary {
    return this.diary
  }

  /** 追加一条日志。自动清理超过保留期的旧天。 */
  async append(icon: string, text: string, now: number = Date.now()): Promise<void> {
    await this.load()
    // BUG-14 修复：用本地时区日期而非 UTC
    const d = new Date(now)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const entries = this.diary[date] ?? []
    entries.push({ ts: now, icon, text })
    this.diary[date] = entries
    this.pruneOld(now)
    await this.flush()
  }

  /** 清理超过保留期的天。纯逻辑，可单测。 */
  pruneOld(now: number, retentionDays: number = DEFAULT_RETENTION_DAYS): void {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
    const cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
    for (const date of Object.keys(this.diary)) {
      if (date < cutoffDate) delete this.diary[date]
    }
  }

  // BUG-30 修复：并发锁防多 handler 同时 flush
  private flushing: Promise<void> | null = null

  async flush(): Promise<void> {
    // 互斥：正在 flush 时排队等待
    if (this.flushing) return this.flushing
    this.flushing = this.doFlush()
    try {
      await this.flushing
    } finally {
      this.flushing = null
    }
  }

  private async doFlush(): Promise<void> {
    try {
      await mkdir(DIARY_DIR, { recursive: true })
      // BUG-30 修复：原子写（tmp + rename），防崩溃时半截 JSON
      const tmpFile = DIARY_FILE + '.tmp'
      await writeFile(tmpFile, JSON.stringify(this.diary, null, 2), 'utf8')
      const { rename } = await import('node:fs/promises')
      await rename(tmpFile, DIARY_FILE)
    } catch (error) {
      console.warn('[pet-diary] flush failed:', error)
    }
  }

  /** 仅供测试注入。 */
  _setForTest(diary: Diary): void {
    this.diary = diary
    this.loaded = true
  }
}

let instance: PetDiaryStore | null = null
export function getDiaryStore(): PetDiaryStore {
  if (!instance) instance = new PetDiaryStore()
  return instance
}

export function resetDiaryStoreForTest(): void {
  instance = null
}

export { DEFAULT_RETENTION_DAYS }
