import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Database, Eye, History, Link2, RotateCcw, ShieldOff, Zap } from 'lucide-react'
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
    // v3(P1-2/4/5/6):可选的新方法(渐进接入)
    disableDreamReferenceChatHistory?: (userId: string) => Promise<{ removedInferred: number }>
    triggerDreamDreaming?: (userId: string) => Promise<{ ran: boolean; temporalOccurred: number; topOfMindPromoted: number }>
    getDreamDreamingStatus?: (userId: string) => Promise<{ dirtyCount: number; isDirty: boolean }>
    getDreamSources?: (userId: string) => Promise<Array<{ id: string; source_type: string; title: string | null; external_ref: string | null; deleted: boolean }>>
    getDreamSuppressions?: (userId: string) => Promise<Array<{ id: string; scope: string; target: string; reason: string | null; active: boolean }>>
    // 7(差距7):三开关
    getDreamMemorySettings?: (userId: string) => Promise<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }>
    setDreamMemorySettings?: (userId: string, settings: Partial<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean }>) => Promise<void>
  }
}): ReactElement {
  const [summary, setSummary] = useState<DreamMemorySummaryJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versionsFor, setVersionsFor] = useState<{ memoryId: string; entries: DreamVersionJson[] } | null>(null)
  const [optedOut, setOptedOut] = useState(false)
  // v3(P1-2/4/5/6):新增 UI 状态
  const [showSources, setShowSources] = useState(false)
  const [sources, setSources] = useState<Array<{ id: string; source_type: string; title: string | null; external_ref: string | null; deleted: boolean }>>([])
  const [showSuppressions, setShowSuppressions] = useState(false)
  const [suppressions, setSuppressions] = useState<Array<{ id: string; scope: string; target: string; reason: string | null; active: boolean }>>([])
  const [dreamingStatus, setDreamingStatus] = useState<{ dirtyCount: number; isDirty: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // 7(差距7):三开关状态
  const [memSettings, setMemSettings] = useState<{ savedMemoriesEnabled: boolean; chatHistoryEnabled: boolean; connectorsEnabled: boolean } | null>(null)

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
    void loadMemorySettings()
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

  // v3(P1-4 报告 §6.3):关闭 reference chat history
  const handleDisableRefChat = async (): Promise<void> => {
    setBusy(true)
    try {
      if (qwicks.disableDreamReferenceChatHistory) {
        await qwicks.disableDreamReferenceChatHistory(userId)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  // v3(P1-6 报告 §9):手动触发 dreaming
  const handleTriggerDreaming = async (): Promise<void> => {
    setBusy(true)
    try {
      if (qwicks.triggerDreamDreaming) {
        await qwicks.triggerDreamDreaming(userId)
        await reload()
        if (qwicks.getDreamDreamingStatus) {
          setDreamingStatus(await qwicks.getDreamDreamingStatus(userId))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  // v3(P1-2 报告 §6.4):加载来源记录
  const handleLoadSources = async (): Promise<void> => {
    if (!qwicks.getDreamSources) return
    try {
      setSources(await qwicks.getDreamSources(userId))
      setShowSources(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // v3(P1-2 报告 §8):加载抑制规则
  const handleLoadSuppressions = async (): Promise<void> => {
    if (!qwicks.getDreamSuppressions) return
    try {
      setSuppressions(await qwicks.getDreamSuppressions(userId))
      setShowSuppressions(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // 7(差距7):加载三开关设置
  const loadMemorySettings = async (): Promise<void> => {
    if (!qwicks.getDreamMemorySettings) return
    try {
      setMemSettings(await qwicks.getDreamMemorySettings(userId))
    } catch {
      // fail-open: API 不支持时保持 null(显示旧按钮)
    }
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

      {/* 7(差距7):完整三开关 UI — Saved memories / Chat history / Connectors */}
      {memSettings && qwicks.setDreamMemorySettings && (
        <>
          <SettingRow
            title="显式保存的记忆"
            description="用户明确要求记住的事实、偏好、说明。关闭后不再读取已保存的记忆。"
            control={
              <button
                type="button"
                disabled={busy}
                onClick={() => { const next = { ...memSettings, savedMemoriesEnabled: !memSettings.savedMemoriesEnabled }; setMemSettings(next); void qwicks.setDreamMemorySettings?.(userId, { savedMemoriesEnabled: next.savedMemoriesEnabled }) }}
                className={`px-3 py-1 rounded text-xs ${memSettings.savedMemoriesEnabled ? 'bg-emerald-700 text-zinc-100' : 'bg-zinc-700 text-zinc-400'}`}
              >
                {memSettings.savedMemoriesEnabled ? '✓ 开启' : '已关闭'}
              </button>
            }
          />
          <SettingRow
            title="参考聊天历史"
            description="从历史聊天中自动推断长期上下文。关闭后不再从新聊天抽取记忆,旧推断记忆也被过滤。"
            control={
              <button
                type="button"
                disabled={busy}
                onClick={() => { const next = { ...memSettings, chatHistoryEnabled: !memSettings.chatHistoryEnabled }; setMemSettings(next); void qwicks.setDreamMemorySettings?.(userId, { chatHistoryEnabled: next.chatHistoryEnabled }); if (!next.chatHistoryEnabled) void handleDisableRefChat() }}
                className={`px-3 py-1 rounded text-xs ${memSettings.chatHistoryEnabled ? 'bg-emerald-700 text-zinc-100' : 'bg-zinc-700 text-zinc-400'}`}
              >
                {memSettings.chatHistoryEnabled ? '✓ 开启' : '已关闭'}
              </button>
            }
          />
          <SettingRow
            title="连接器记忆 (Gmail / Drive)"
            description="从 Gmail、Drive 等连接来源推断记忆。关闭后不再读取连接器推断的记忆。"
            control={
              <button
                type="button"
                disabled={busy}
                onClick={() => { const next = { ...memSettings, connectorsEnabled: !memSettings.connectorsEnabled }; setMemSettings(next); void qwicks.setDreamMemorySettings?.(userId, { connectorsEnabled: next.connectorsEnabled }) }}
                className={`px-3 py-1 rounded text-xs ${memSettings.connectorsEnabled ? 'bg-emerald-700 text-zinc-100' : 'bg-zinc-700 text-zinc-400'}`}
              >
                {memSettings.connectorsEnabled ? '✓ 开启' : '已关闭'}
              </button>
            }
          />
        </>
      )}
      {/* 旧的单独"关闭参考历史"按钮已被三开关取代,保留兼容(无 settings API 时显示) */}
      {!memSettings && (
        <SettingRow
          title="关闭参考聊天历史"
          description="删除由历史聊天推断的记忆,保留显式保存的记忆和原始聊天(对齐文档 §3)。"
          control={
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDisableRefChat()}
              className="px-3 py-1 rounded text-xs bg-amber-700 text-zinc-100 hover:bg-amber-600 disabled:opacity-50"
            >
              关闭参考历史
            </button>
          }
        />
      )}

      {/* v3(P1-6 报告 §9):Dreaming 手动触发 + 状态 */}
      <SettingRow
        title="Dreaming 后台刷新"
        description="手动触发一轮记忆刷新(去重/过期/时间转换/top-of-mind 调整)。"
        control={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTriggerDreaming()}
              className="px-3 py-1 rounded text-xs bg-sky-700 text-zinc-100 hover:bg-sky-600 disabled:opacity-50 flex items-center gap-1"
            >
              <Zap size={12} /> 立即刷新
            </button>
            {dreamingStatus && (
              <span className="text-xs text-zinc-500">
                待处理: {dreamingStatus.dirtyCount}
              </span>
            )}
          </div>
        }
      />

      {/* v3(P1-2 报告 §6.4):Memory Sources + 抑制规则入口 */}
      <div className="flex gap-2 mb-3">
        {qwicks.getDreamSources && (
          <button
            type="button"
            onClick={() => void handleLoadSources()}
            className="px-3 py-1 rounded text-xs bg-zinc-700 text-zinc-200 hover:bg-zinc-600 flex items-center gap-1"
          >
            <Link2 size={12} /> 来源记录
          </button>
        )}
        {qwicks.getDreamSuppressions && (
          <button
            type="button"
            onClick={() => void handleLoadSuppressions()}
            className="px-3 py-1 rounded text-xs bg-zinc-700 text-zinc-200 hover:bg-zinc-600 flex items-center gap-1"
          >
            <ShieldOff size={12} /> 抑制规则
          </button>
        )}
      </div>

      {/* v3(P1-2):来源记录面板 */}
      {showSources && (
        <div className="mt-3 border border-zinc-700 rounded p-3 bg-zinc-900/50">
          <div className="text-sm font-medium text-zinc-200 mb-2 flex items-center gap-2">
            <Database size={14} /> 来源记录 ({sources.length})
          </div>
          {sources.length === 0 ? (
            <div className="text-xs text-zinc-400">暂无来源。</div>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {sources.map((s) => (
                <li key={s.id} className="text-xs text-zinc-300">
                  <span className="text-zinc-500">[{s.source_type}]</span>{' '}
                  {s.title ?? s.external_ref ?? s.id}
                  {s.deleted && <span className="text-red-400 ml-1">(已删除)</span>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setShowSources(false)} className="text-xs underline mt-2 text-zinc-400">
            关闭
          </button>
        </div>
      )}

      {/* v3(P1-2):抑制规则面板 */}
      {showSuppressions && (
        <div className="mt-3 border border-zinc-700 rounded p-3 bg-zinc-900/50">
          <div className="text-sm font-medium text-zinc-200 mb-2 flex items-center gap-2">
            <ShieldOff size={14} /> 抑制规则 ({suppressions.length})
          </div>
          {suppressions.length === 0 ? (
            <div className="text-xs text-zinc-400">暂无抑制规则。</div>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {suppressions.map((r) => (
                <li key={r.id} className="text-xs text-zinc-300">
                  <span className="text-zinc-500">[{r.scope}]</span>{' '}
                  {r.target}
                  {r.reason && <span className="text-zinc-500 ml-1">({r.reason})</span>}
                  {!r.active && <span className="text-zinc-500 ml-1">(已恢复)</span>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setShowSuppressions(false)} className="text-xs underline mt-2 text-zinc-400">
            关闭
          </button>
        </div>
      )}

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
