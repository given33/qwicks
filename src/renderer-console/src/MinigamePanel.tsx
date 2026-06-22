/**
 * 小游戏面板（M11）。
 *
 * 6 个小游戏（参考 QQ smallGame）：猜拳/打地鼠/跳绳/泡泡龙/连连看/100层。
 * 统一面板框架 + 菜单选择 + 各游戏简化可玩实现。得分换元宝 + 写档案。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  PAOPAO_RANK_CONFIG, rpsJudge, rpsRandom, scoreToCoins,
  whackJudge, whackSpawn, type PaopaoRank, type RpsChoice
} from '@shared/minigame-logic'

type Bridge = {
  reward: (amount: number) => Promise<unknown>
  diaryAppend: (icon: string, text: string) => Promise<unknown>
}
function bridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: Bridge }).pet ?? null : null
}

type GameId = 'guess' | 'mouse' | 'rope' | 'paopao' | 'match' | 'tower100'

const GAMES: { id: GameId; name: string; emoji: string }[] = [
  { id: 'guess', name: '猜拳', emoji: '✊' },
  { id: 'mouse', name: '打地鼠', emoji: '🔨' },
  { id: 'rope', name: '跳绳', emoji: '🪢' },
  { id: 'paopao', name: '泡泡龙', emoji: '🫧' },
  { id: 'match', name: '连连看', emoji: '🔗' },
  { id: 'tower100', name: '100层', emoji: '🗼' }
]

export function MinigamePanel({ onClose }: { onClose: () => void }): ReactElement {
  const [game, setGame] = useState<GameId | null>(null)

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'linear-gradient(180deg, #2a2a4a 0%, #4a4a6a 100%)',
      display: 'flex', flexDirection: 'column', padding: 16, color: '#fff'
    }}>
      <button onClick={onClose} style={closeBtnStyle}>× 关闭</button>
      {!game ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>🎮 小游戏（得分换元宝）</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {GAMES.map((g) => (
              <button key={g.id} style={gameCardStyle} onClick={() => setGame(g.id)}>
                <div style={{ fontSize: 32 }}>{g.emoji}</div>
                <div style={{ fontSize: 13 }}>{g.name}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <GameRouter game={game} onBack={() => setGame(null)} />
      )}
    </div>
  )
}

function GameRouter({ game, onBack }: { game: GameId; onBack: () => void }): ReactElement {
  switch (game) {
    case 'guess': return <GuessGame onBack={onBack} />
    case 'mouse': return <MouseGame onBack={onBack} />
    case 'rope': return <SimpleGame name="跳绳" desc="按节奏点击！每跳 +1" onBack={onBack} />
    case 'paopao': return <SimpleGame name="泡泡龙" desc="消除同色泡泡得分" onBack={onBack} />
    case 'match': return <SimpleGame name="连连看" desc="配对相同图案消除" onBack={onBack} />
    case 'tower100': return <SimpleGame name="100层" desc="一层层往上爬！" onBack={onBack} />
  }
}

/** 猜拳（完整可玩） */
function GuessGame({ onBack }: { onBack: () => void }): ReactElement {
  const [score, setScore] = useState(0)
  const [result, setResult] = useState<string>('出招吧！')

  const play = (choice: RpsChoice): void => {
    const cpu = rpsRandom()
    const r = rpsJudge(choice, cpu)
    if (r === 'win') {
      setScore((s) => s + 1)
      setResult(`你出${emoji(choice)} 对 ${emoji(cpu)}，赢！`)
    } else if (r === 'lose') {
      setResult(`你出${emoji(choice)} 对 ${emoji(cpu)}，输！`)
    } else {
      setResult(`你出${emoji(choice)} 对 ${emoji(cpu)}，平！`)
    }
  }

  const cashOut = async (): Promise<void> => {
    const coins = scoreToCoins(score)
    await bridge()?.reward(coins)
    if (coins > 0) await bridge()?.diaryAppend('✊', `猜拳得分 ${score}，换 ${coins} 元宝`)
    onBack()
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <button onClick={onBack} style={backBtnStyle}>← 返回</button>
      <div style={{ fontSize: 15, marginBottom: 16 }}>✊ 猜拳 · 得分 {score}</div>
      <div style={{ fontSize: 16, marginBottom: 20, minHeight: 24 }}>{result}</div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 20 }}>
        {(['rock', 'paper', 'scissors'] as RpsChoice[]).map((c) => (
          <button key={c} style={playBtnStyle} onClick={() => play(c)}>{emoji(c)}</button>
        ))}
      </div>
      <button style={cashBtnStyle} onClick={() => void cashOut()}>兑换 {scoreToCoins(score)} 元宝</button>
    </div>
  )
}

/** 打地鼠（完整可玩） */
function MouseGame({ onBack }: { onBack: () => void }): ReactElement {
  const [moles, setMoles] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [time, setTime] = useState(20)
  const timerRef = useRef(0)
  const spawnRef = useRef(0)

  useEffect(() => {
    spawnRef.current = window.setInterval(() => setMoles(whackSpawn(9)), 900)
    timerRef.current = window.setInterval(() => setTime((t) => t - 1), 1000)
    return () => {
      window.clearInterval(spawnRef.current)
      window.clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (time <= 0) {
      window.clearInterval(spawnRef.current)
      window.clearInterval(timerRef.current)
      const coins = scoreToCoins(score)
      void bridge()?.reward(coins)
      if (coins > 0) void bridge()?.diaryAppend('🔨', `打地鼠得分 ${score}，换 ${coins} 元宝`)
    }
  }, [time, score])

  const hit = (idx: number): void => {
    const { hit, score: s } = whackJudge(moles, idx)
    if (hit) {
      setScore((prev) => prev + 1)
      setMoles((m) => m.filter((x) => x !== idx))
    }
  }

  if (time <= 0) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, marginBottom: 16 }}>⏰ 时间到！得分 {score}</div>
        <button onClick={onBack} style={backBtnStyle}>← 返回</button>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <button onClick={onBack} style={backBtnStyle}>← 返回</button>
      <div style={{ fontSize: 15, marginBottom: 12 }}>🔨 打地鼠 · 得分 {score} · ⏱ {time}s</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 70px)', gap: 8, justifyContent: 'center' }}>
        {Array.from({ length: 9 }, (_, i) => (
          <button key={i} style={moleHoleStyle} onClick={() => hit(i)}>
            {moles.includes(i) ? '🐹' : '🕳️'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 升级版简化游戏（跳绳/泡泡/连连看/100层）：难度递进 + 连击 + 失误封顶 */
function SimpleGame({ name, desc, onBack }: { name: string; desc: string; onBack: () => void }): ReactElement {
  const [taps, setTaps] = useState(0)
  const [combo, setCombo] = useState(0)
  const [misses, setMisses] = useState(0)
  const maxMisses = 3

  // 难度按得分递进（参考 QQ 三段难度）
  const rank: PaopaoRank = taps < 10 ? 'simple' : taps < 25 ? 'center' : 'difficult'
  const rankName = { simple: '简单', center: '中等', difficult: '困难' }[rank]

  const hit = (): void => {
    setTaps((t) => t + 1)
    setCombo((c) => c + 1)
  }
  const miss = (): void => {
    setCombo(0)
    setMisses((m) => m + 1)
  }

  const gameOver = misses >= maxMisses

  const finish = async (): Promise<void> => {
    const coins = scoreToCoins(taps)
    await bridge()?.reward(coins)
    if (coins > 0) await bridge()?.diaryAppend('🎮', `${name} 得分 ${taps}（${rankName}），换 ${coins} 元宝`)
    onBack()
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <button onClick={onBack} style={backBtnStyle}>← 返回</button>
      <div style={{ fontSize: 15, marginBottom: 8 }}>{name}</div>
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 12 }}>{desc}</div>
      <div style={{ fontSize: 12, color: rank === 'difficult' ? '#f85' : rank === 'center' ? '#fc5' : '#8f8', marginBottom: 12 }}>
        难度：{rankName} · 连击 x{combo} · 失误 {misses}/{maxMisses}
      </div>
      {gameOver ? (
        <div style={{ fontSize: 18, color: '#f66', marginBottom: 16 }}>游戏结束！得分 {taps}</div>
      ) : (
        <>
          <button style={{ ...playBtnStyle, width: 120, height: 120, fontSize: 40 }} onClick={hit}>
            {taps}
          </button>
          <button style={{ ...cashBtnStyle, background: '#e88', marginLeft: 8 }} onClick={miss}>失误</button>
        </>
      )}
      <div style={{ marginTop: 16 }}>
        <button style={cashBtnStyle} onClick={() => void finish()}>结算 {scoreToCoins(taps)} 元宝</button>
      </div>
    </div>
  )
}

function emoji(c: RpsChoice): string {
  return c === 'rock' ? '✊' : c === 'paper' ? '✋' : '✌️'
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.2)',
  color: '#fff', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13
}
const gameCardStyle: React.CSSProperties = {
  padding: 20, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
  borderRadius: 10, cursor: 'pointer', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
}
const backBtnStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 13, marginBottom: 12
}
const playBtnStyle: React.CSSProperties = {
  width: 64, height: 64, fontSize: 28, border: 'none', background: '#f5c451',
  color: '#5a3a0a', borderRadius: 12, cursor: 'pointer'
}
const moleHoleStyle: React.CSSProperties = {
  width: 70, height: 70, fontSize: 32, border: 'none', background: 'rgba(0,0,0,0.2)',
  borderRadius: 12, cursor: 'pointer'
}
const cashBtnStyle: React.CSSProperties = {
  padding: '10px 20px', border: 'none', background: '#7ec', color: '#135',
  borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600
}
