/** 成长 tab：学历阶梯 + 职业阶梯 + 三维属性。 */
import { useState, type ReactElement } from 'react'
import {
  EDUCATION_LEVELS, JOBS, canEnroll, canWork, educationName,
  highestEligibleJob, type EducationLevel, type JobId
} from '@shared/pet-career'
import type { PetState } from '@shared/pet-state'

type Bridge = {
  study: (level: string) => Promise<{ ok: boolean; reason?: string }>
  work: (jobId: string) => Promise<{ ok: boolean; reason?: string; coins?: number }>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function CareerTab({ state }: { state: PetState | null }): ReactElement {
  const [msg, setMsg] = useState('')
  const career = state?.career
  const edu = career?.education ?? null
  const stats = career?.stats ?? { intelligence: 0, charm: 0, strength: 0 }
  const bestJob = highestEligibleJob({ stats, education: edu, currentJob: null })

  const study = async (level: EducationLevel): Promise<void> => {
    const r = await bridge()?.study(level)
    setMsg(r?.ok ? '学业完成！' : `无法就读：${r?.reason ?? ''}`)
  }
  const work = async (job: JobId): Promise<void> => {
    const r = await bridge()?.work(job)
    setMsg(r?.ok ? `打工赚了 ${r.coins} 元宝！` : `无法任职：${r?.reason ?? ''}`)
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#8a7a5a', marginBottom: 8 }}>
        当前学历：{educationName(edu)} · 智力{stats.intelligence} 魅力{stats.charm} 武力{stats.strength}
      </div>
      {msg && <div style={{ fontSize: 12, color: '#5a8a5a', marginBottom: 8 }}>{msg}</div>}

      <div style={{ fontSize: 12, fontWeight: 600, color: '#7a5a1a', margin: '8px 0 4px' }}>📚 学校</div>
      {EDUCATION_LEVELS.map((e) => {
        const check = canEnroll({ stats, education: edu, currentJob: null }, e.id)
        const done = edu === e.id
        return (
          <button key={e.id} style={rowStyle(done)} disabled={!check.ok || done}
            onClick={() => void study(e.id)}>
            <span>{done ? '✅' : check.ok ? '📖' : '🔒'}</span>
            <span style={{ flex: 1 }}>{e.name}</span>
            <span style={{ fontSize: 11, color: '#999' }}>{`+智${e.statBoost.intelligence ?? 0}`}</span>
          </button>
        )
      })}

      <div style={{ fontSize: 12, fontWeight: 600, color: '#7a5a1a', margin: '12px 0 4px' }}>💼 打工</div>
      {JOBS.map((j) => {
        const check = canWork({ stats, education: edu, currentJob: null }, j.id)
        return (
          <button key={j.id} style={rowStyle(j.id === bestJob)} disabled={!check.ok}
            onClick={() => void work(j.id)}>
            <span>{j.emoji}</span>
            <span style={{ flex: 1 }}>{j.name}</span>
            <span style={{ fontSize: 11, color: '#daa520' }}>🪙{j.salary}</span>
          </button>
        )
      })}
    </div>
  )
}

function rowStyle(highlight: boolean): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
    border: `1px solid ${highlight ? 'rgba(245,196,81,0.6)' : 'rgba(0,0,0,0.1)'}`,
    background: highlight ? 'rgba(245,196,81,0.15)' : 'rgba(255,255,255,0.5)',
    borderRadius: 6, cursor: 'pointer', marginBottom: 3, fontSize: 13, color: '#5a4a2a'
  }
}
