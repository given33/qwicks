/** 成长 tab：9 学历（含职高分流）+ 35 职业（按 10 类分组）+ 三维属性。 */
import { useState, type ReactElement } from 'react'
import {
  EDUCATION_LEVELS, JOBS, JOB_CATEGORY_NAMES, canEnroll, canWork,
  educationName, highestEligibleJob, statName, workReward,
  type EducationLevel, type JobCategory, type JobId
} from '@shared/pet-career'
import type { PetState } from '@shared/pet-state'

type Bridge = {
  study: (level: string) => Promise<{ ok: boolean; reason?: string }>
  work: (jobId: string) => Promise<{ ok: boolean; reason?: string; coins?: number }>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

const CATEGORIES: JobCategory[] = ['blue-collar', 'service', 'skill', 'white-collar', 'tech', 'medical', 'civil', 'creative', 'finance', 'elite']

export function CareerTab({ state }: { state: PetState | null }): ReactElement {
  const [msg, setMsg] = useState('')
  const career = state?.career
  const edu = career?.education ?? null
  const stats = career?.stats ?? { intelligence: 0, charm: 0, strength: 0 }
  const bestJob = highestEligibleJob({ stats, education: edu, currentJob: null })

  const study = async (level: EducationLevel): Promise<void> => {
    const r = await bridge()?.study(level)
    setMsg(r?.ok ? `${EDUCATION_LEVELS.find((e) => e.id === level)?.name}学业完成！` : `无法就读：${r?.reason ?? ''}`)
  }
  const work = async (job: JobId): Promise<void> => {
    const r = await bridge()?.work(job)
    setMsg(r?.ok ? `打工赚了 ${r.coins} 元宝！` : `无法任职：${r?.reason ?? ''}`)
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8a7a5a', marginBottom: 8 }}>
        学历：{educationName(edu)} · 智{stats.intelligence} 魅{stats.charm} 体{stats.strength}
      </div>
      {msg && <div style={{ fontSize: 11, color: '#5a8a5a', marginBottom: 6 }}>{msg}</div>}

      <div style={{ fontSize: 11, fontWeight: 600, color: '#7a5a1a', margin: '6px 0 3px' }}>📚 教育路径</div>
      {EDUCATION_LEVELS.map((e) => {
        const check = canEnroll({ stats, education: edu, currentJob: null }, e.id)
        const done = edu === e.id
        return (
          <button key={e.id} style={rowStyle(done)} disabled={!check.ok || done} onClick={() => void study(e.id)}>
            <span>{done ? '✅' : check.ok ? '📖' : '🔒'}</span>
            <span style={{ flex: 1 }}>{e.name}</span>
            <span style={{ fontSize: 9, color: '#999' }}>+{Object.entries(e.statBoost).map(([k, v]) => `${statName(k as 'intelligence')[0]}${v}`).join(' ')}</span>
          </button>
        )
      })}

      <div style={{ fontSize: 11, fontWeight: 600, color: '#7a5a1a', margin: '10px 0 3px' }}>💼 求职（当前最高可任：{JOBS.find((j) => j.id === bestJob)?.name}）</div>
      {CATEGORIES.map((cat) => {
        const jobs = JOBS.filter((j) => j.category === cat)
        return (
          <div key={cat} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: '#9a7a3a', margin: '3px 0 2px' }}>{JOB_CATEGORY_NAMES[cat]}</div>
            {jobs.map((j) => {
              const check = canWork({ stats, education: edu, currentJob: null }, j.id)
              return (
                <button key={j.id} style={rowStyle(j.id === bestJob)} disabled={!check.ok} onClick={() => void work(j.id)}>
                  <span>{j.emoji}</span>
                  <span style={{ flex: 1, fontSize: 11 }}>{j.name}</span>
                  <span style={{ fontSize: 9, color: '#daa520' }}>🪙{j.salary}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function rowStyle(highlight: boolean): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
    border: `1px solid ${highlight ? 'rgba(245,196,81,0.6)' : 'rgba(0,0,0,0.08)'}`,
    background: highlight ? 'rgba(245,196,81,0.15)' : 'rgba(255,255,255,0.4)',
    borderRadius: 5, cursor: 'pointer', marginBottom: 2, fontSize: 11, color: '#5a4a2a'
  }
}
