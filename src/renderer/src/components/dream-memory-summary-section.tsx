import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Eye, History, RotateCcw, ShieldOff } from 'lucide-react'
import type {
  CoreMemoryRecordJson,
  DreamMemorySummaryJson,
  DreamVersionJson
} from '../agent/qwicks-contract'
import { SettingsCard, SettingRow } from './settings-controls'

type SectionKey = keyof Pick<
  DreamMemorySummaryJson,
  'work' | 'projects' | 'preferences' | 'constraints' | 'locations' | 'sensitive' | 'hidden'
>

const SECTION_LABEL: Record<SectionKey, string> = {
  work: '工作',
  projects: '项目',
  preferences: '偏好',
  constraints: '约束',
  locations: '位置',
  sensitive: '敏感(已脱敏)',
  hidden: '已隐藏(不再主动提及)'
}

/**
 * Phase 3: Dream 记忆系统的用户可见层 —— Memory Summary(7 区)+ Don't-mention-again
 * + 版本历史/恢复 + opt-out。仅当 Dream 后端启用时由 SettingsView 渲染。
 *
 * 对齐文档 §4.2(Memory Summary 查看编辑定点纠正)、§4.3(Memory Sources)、§5.2(版本历史恢复)、§4.7(opt-out)。
 */
export function DreamMemorySummarySection({
  userId = 'default',
  qwicks
}: {
  userId?: string
  qwicks: {
    getDreamSummary: (userId: string) => Promise<DreamMemorySummaryJson>
    getDreamMemoryVersions: (memoryId: string) => Promise<DreamVersionJson[]>
    restoreDreamMemoryVersion: (memoryId: string, versionId: string) => Promise<CoreMemoryRecordJson>
    suppressDreamMemory: (memoryId: string) => Promise<CoreMemoryRecordJson>
    setDreamOptOut: (userId: string, optOut: boolean) => Promise<void>
  }
}): ReactElement {
  const [summary, setSummary] = useState<DreamMemorySummaryJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versionsFor, setVersionsFor] = useState<{ memoryId: string; entries: DreamVersionJson[] } | null>(null)
  const [optedOut, setOptedOut] = useState(false)

  const reload = useCallback(async () => {
    try {
      setError(null)
      setSummary(await qwicks.getDreamSummary(userId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [qwicks, userId])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSuppress = async (memoryId: string): Promise<void> => {
    await qwicks.suppressDreamMemory(memoryId)
    await reload()
  }

  const handleShowVersions = async (memoryId: string): Promise<void> => {
    try {
      const entries = await qwicks.getDreamMemoryVersions(memoryId)
      setVersionsFor({ memoryId, entries })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRestore = async (memoryId: string, versionId: string): Promise<void> => {
    await qwicks.restoreDreamMemoryVersion(memoryId, versionId)
    setVersionsFor(null)
    await reload()
  }

  const handleOptToggle = async (next: boolean): Promise<void> => {
    setOptedOut(next)
    await qwicks.setDreamOptOut(userId, next)
    if (!next) await reload()
  }

  if (error) {
    return (
      <SettingsCard title="Dream 记忆摘要">
        <div className="text-red-500 text-sm">{error}</div>
        <button type="button" onClick={() => void reload()} className="text-xs underline mt-2">
          重试
        </button>
      </SettingsCard>
    )
  }

  if (!summary) {
    return (
      <SettingsCard title="Dream 记忆摘要">
        <div className="text-sm text-zinc-400">加载中…</div>
      </SettingsCard>
    )
  }

  const sections = Object.keys(SECTION_LABEL) as SectionKey[]
  const totalEntries = sections.reduce((sum, k) => sum + summary[k].length, 0)

  return (
    <SettingsCard title="Dream 记忆摘要">
      <div className="text-xs text-zinc-400 mb-3">
        生成于 {summary.generated_at.slice(0, 19).replace('T', ' ')} · 共 {totalEntries} 条
      </div>

      <SettingRow
        title="关闭 Dream 记忆(opt-out)"
        description="关闭后不再读写记忆(对齐文档 §4.7)。重新打开后会从历史聊天重新生成。"
        control={
          <button
            type="button"
            onClick={() => void handleOptToggle(!optedOut)}
            className={`px-3 py-1 rounded text-xs ${optedOut ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-200'}`}
          >
            {optedOut ? '已关闭 — 点击重新开启' : '关闭记忆'}
          </button>
        }
      />

      {sections.map((section) => {
        const entries = summary[section]
        if (entries.length === 0) return null
        return (
          <div key={section} className="mb-4">
            <div className="text-sm font-medium text-zinc-200 mb-1">
              {SECTION_LABEL[section]} ({entries.length})
            </div>
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={e.memory_ids[0]} className="text-xs text-zinc-300 flex items-start gap-2">
                  <span className="flex-1">
                    {e.text}
                    <span className="text-zinc-500 ml-2">
                      (置信度 {e.confidence.toFixed(2)} · 来源 {e.source_count})
                    </span>
                  </span>
                  <button
                    type="button"
                    title="不再主动提及(≠ 删除)"
                    onClick={() => void handleSuppress(e.memory_ids[0])}
                    className="text-zinc-400 hover:text-amber-400"
                  >
                    <ShieldOff size={13} />
                  </button>
                  <button
                    type="button"
                    title="版本历史"
                    onClick={() => void handleShowVersions(e.memory_ids[0])}
                    className="text-zinc-400 hover:text-sky-400"
                  >
                    <History size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {totalEntries === 0 && (
        <div className="text-sm text-zinc-400">暂无记忆摘要。多聊几轮后会自动生成。</div>
      )}

      {versionsFor && (
        <div className="mt-4 border border-zinc-700 rounded p-3 bg-zinc-900/50">
          <div className="text-sm font-medium text-zinc-200 mb-2 flex items-center gap-2">
            <Eye size={14} /> 版本历史:{versionsFor.memoryId}
          </div>
          {versionsFor.entries.length === 0 ? (
            <div className="text-xs text-zinc-400">无历史版本。</div>
          ) : (
            <ul className="space-y-1">
              {versionsFor.entries.map((v) => (
                <li key={v.versionId} className="text-xs text-zinc-300 flex items-center gap-2">
                  <span className="flex-1">
                    {v.content} <span className="text-zinc-500">({v.at.slice(0, 19).replace('T', ' ')})</span>
                  </span>
                  <button
                    type="button"
                    title="恢复到该版本"
                    onClick={() => void handleRestore(versionsFor.memoryId, v.versionId)}
                    className="text-zinc-400 hover:text-emerald-400"
                  >
                    <RotateCcw size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setVersionsFor(null)}
            className="text-xs underline mt-2 text-zinc-400"
          >
            关闭
          </button>
        </div>
      )}
    </SettingsCard>
  )
}
