/** 档案 tab：按天分组的宠物行为时间线。 */
import { useEffect, useState, type ReactElement } from 'react'

type DiaryEntry = { ts: number; icon: string; text: string }
type Diary = Record<string, DiaryEntry[]>

type Bridge = { getDiary: () => Promise<Diary> }
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

export function DiaryTab(): ReactElement {
  const [diary, setDiary] = useState<Diary>({})

  useEffect(() => {
    void bridge()?.getDiary().then(setDiary)
  }, [])

  const dates = Object.keys(diary).sort().reverse()
  if (dates.length === 0) {
    return <div style={{ color: '#999', fontSize: 13, textAlign: 'center', marginTop: 40 }}>还没有档案记录，多陪陪宠物吧～</div>
  }

  return (
    <div>
      {dates.map((date) => (
        <div key={date} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#8a6a2a', marginBottom: 6 }}>{date}</div>
          {(diary[date] ?? []).slice().reverse().map((e, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', marginBottom: 3,
              background: 'rgba(245,196,81,0.06)', borderRadius: 6
            }}>
              <span style={{ fontSize: 16 }}>{e.icon}</span>
              <span style={{ fontSize: 12, color: '#7a5a1a', flex: 1 }}>{e.text}</span>
              <span style={{ fontSize: 11, color: '#bbb' }}>
                {new Date(e.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
