import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { UiPluginFigureSlot } from '@shared/ui-plugin'
import { useUiPluginFigure } from '../../store/ui-plugin-store'
import { petFigure } from '../../lib/pet-figure'

// M2 形象换皮：旧的 qwicks_*.png / iqwicks_*.png 两套美术已移除，
// 全部指向暖黄形象的对应姿态帧。变量名保留以最小化下游逻辑改动——
// 双图 CSS 过渡、彩蛋、庆祝等机制原样工作，只是底层图换成暖黄形象。
const qwicksLogo = petFigure('walk')        // 原 qwicks_bird（工作 logo 主体）
const qwicksSurfFigure = petFigure('walk')   // 原 qwicks_surf
const qwicksGreetFigure = petFigure('wave')  // 原 qwicks_greet
const qwicksSleepFigure = petFigure('sleep') // 原 qwicks_sleep
const qwicksSitFigure = petFigure('sit')     // 原 qwicks_sit
const iqwicksFigure = petFigure('walk')      // 原 iqwicks（运球）
const iqwicksRunFigure = petFigure('walk')   // 原 iqwicks_run
const iqwicksBobaFigure = petFigure('sit')   // 原 iqwicks_boba（喝奶茶→坐着）
const iqwicksWaveFigure = petFigure('wave')  // 原 iqwicks_wave
const iqwicksSleepFigure = petFigure('sleep') // 原 iqwicks_sleep

/* UI 插件按槽位覆盖默认 QWicks 形象时的回退链 */
export const UI_PLUGIN_STATE_SLOTS: Record<QWicksStateFigureKind, readonly UiPluginFigureSlot[]> = {
  greet: ['greet', 'swim'],
  sleep: ['sleep', 'sit', 'swim'],
  sit: ['sit', 'greet', 'swim']
}

export type WorkLogoSwimMode = 'propel' | 'sprint' | 'dive' | 'surf'

export const WORK_LOGO_SWIM_MODES: readonly WorkLogoSwimMode[] = [
  'propel',
  'sprint',
  'dive',
  'surf'
]

export const WORK_LOGO_SWIM_MODE_LABEL_KEYS: Record<WorkLogoSwimMode, string> = {
  propel: 'working',
  sprint: 'workingSprint',
  dive: 'workingDive',
  surf: 'workingSurf'
}

const WORK_LOGO_SWIM_MODE_INTERVAL_MS = 4200

export function useWorkLogoSwimMode(active: boolean): WorkLogoSwimMode {
  // 起点随机,避免每次都从「推进中」开始;之后按顺序轮播
  const [modeIndex, setModeIndex] = useState(() =>
    Math.floor(Math.random() * WORK_LOGO_SWIM_MODES.length)
  )

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => {
      setModeIndex((current) => (current + 1) % WORK_LOGO_SWIM_MODES.length)
    }, WORK_LOGO_SWIM_MODE_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [active])

  return WORK_LOGO_SWIM_MODES[modeIndex] ?? 'propel'
}

export type QWicksStateFigureKind = 'greet' | 'sleep' | 'sit'

const QWICKS_STATE_FIGURES: Record<QWicksStateFigureKind, string> = {
  greet: qwicksGreetFigure,
  sleep: qwicksSleepFigure,
  sit: qwicksSitFigure
}

/* iQWicks 模式下的对应姿态:打招呼→挥手,睡觉→抱枕打盹,坐着→喝奶茶 */
const QWICKS_STATE_IQWICKS_FIGURES: Record<QWicksStateFigureKind, string> = {
  greet: iqwicksWaveFigure,
  sleep: iqwicksSleepFigure,
  sit: iqwicksBobaFigure
}

/** 静态场景里的 QWicks 形象:打招呼(欢迎)、睡觉(运行时待唤醒)、坐着(空状态) */
export function QWicksStateFigure({
  kind,
  className = ''
}: {
  kind: QWicksStateFigureKind
  className?: string
}): ReactElement {
  // UI 插件激活时按槽位覆盖默认 QWicks 美术(iQWicks 内置模式走 CSS 双图切换,不经过这里)
  const qwicksFigureSrc = useUiPluginFigure(UI_PLUGIN_STATE_SLOTS[kind], QWICKS_STATE_FIGURES[kind])
  return (
    <span
      className={['ds-qwicks-state', `ds-qwicks-state-${kind}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <img
        className="ds-qwicks-state-figure"
        src={qwicksFigureSrc}
        alt=""
        draggable={false}
        decoding="async"
      />
      <img
        className="ds-iqwicks-state-figure"
        src={QWICKS_STATE_IQWICKS_FIGURES[kind]}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  )
}

export type IqwicksCameoType = 'dash' | 'chase' | 'peek' | 'boba' | 'nap'
export type IqwicksCameoSide = 'left' | 'right'
export type IqwicksCameoSpec = { id: number; type: IqwicksCameoType; side: IqwicksCameoSide }

export const IQWICKS_CAMEO_TYPES: readonly IqwicksCameoType[] = ['dash', 'chase', 'peek', 'boba', 'nap']

/* 每种戏码演完的总时长,与 CSS 里的 forwards 动画时长保持一致 */
export const IQWICKS_CAMEO_DURATIONS_MS: Record<IqwicksCameoType, number> = {
  dash: 5200,
  chase: 6600,
  peek: 6200,
  boba: 7200,
  nap: 8200
}

const IQWICKS_CAMEO_FIGURES: Record<Exclude<IqwicksCameoType, 'chase'>, string> = {
  dash: iqwicksRunFigure,
  peek: iqwicksWaveFigure,
  boba: iqwicksBobaFigure,
  nap: iqwicksSleepFigure
}

const IQWICKS_CAMEO_MIN_GAP_MS = 18000
const IQWICKS_CAMEO_MAX_GAP_MS = 45000
const IQWICKS_CAMEO_FIRST_GAP_MS = 7000

let iqwicksCameoSequence = 0

export function pickIqwicksCameo(): IqwicksCameoSpec {
  const type = IQWICKS_CAMEO_TYPES[Math.floor(Math.random() * IQWICKS_CAMEO_TYPES.length)] ?? 'dash'
  const side: IqwicksCameoSide = Math.random() < 0.5 ? 'left' : 'right'
  iqwicksCameoSequence += 1
  return { id: iqwicksCameoSequence, type, side }
}

/* 出没彩蛋的槽位回退链:插件模式取插件图,iQWicks 模式回退坤鸡美术 */
export const UI_PLUGIN_CAMEO_SLOTS: Record<Exclude<IqwicksCameoType, 'chase'>, readonly UiPluginFigureSlot[]> = {
  dash: ['run', 'swim'],
  peek: ['greet', 'swim'],
  boba: ['sit', 'greet', 'swim'],
  nap: ['sleep', 'sit', 'swim']
}

function IqwicksCameoFigure({
  type,
  side,
  second = false
}: {
  type: Exclude<IqwicksCameoType, 'chase'>
  side: IqwicksCameoSide
  second?: boolean
}): ReactElement {
  const src = useUiPluginFigure(UI_PLUGIN_CAMEO_SLOTS[type], IQWICKS_CAMEO_FIGURES[type])
  return (
    <span
      className={[
        'ds-iqwicks-cameo',
        `ds-iqwicks-cameo-${type}`,
        `is-${side}`,
        second ? 'is-second' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="ds-iqwicks-cameo-flip">
        <img className="ds-iqwicks-cameo-figure" src={src} alt="" draggable={false} decoding="async" />
      </span>
    </span>
  )
}

/** 单场坤鸡戏码;chase 是组合动画:两只对穿,第二只小一号晚一拍 */
export function IqwicksCameo({ cameo }: { cameo: Pick<IqwicksCameoSpec, 'type' | 'side'> }): ReactElement {
  if (cameo.type === 'chase') {
    const otherSide: IqwicksCameoSide = cameo.side === 'left' ? 'right' : 'left'
    return (
      <>
        <IqwicksCameoFigure type="dash" side={cameo.side} />
        <IqwicksCameoFigure type="dash" side={otherSide} second />
      </>
    )
  }
  return <IqwicksCameoFigure type={cameo.type} side={cameo.side} />
}

/** iQWicks 模式专属:主会话两侧不定时出没的坤鸡彩蛋层(指针穿透,纯装饰) */
export function IqwicksCameoLayer(): ReactElement {
  const [cameo, setCameo] = useState<IqwicksCameoSpec | null>(null)

  useEffect(() => {
    let timer = 0
    const schedule = (delay: number): void => {
      timer = window.setTimeout(() => {
        const next = pickIqwicksCameo()
        setCameo(next)
        timer = window.setTimeout(() => {
          setCameo(null)
          schedule(
            IQWICKS_CAMEO_MIN_GAP_MS + Math.random() * (IQWICKS_CAMEO_MAX_GAP_MS - IQWICKS_CAMEO_MIN_GAP_MS)
          )
        }, IQWICKS_CAMEO_DURATIONS_MS[next.type])
      }, delay)
    }
    schedule(IQWICKS_CAMEO_FIRST_GAP_MS + Math.random() * 8000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <span className="ds-iqwicks-cameo-layer" aria-hidden="true">
      {cameo ? <IqwicksCameo key={cameo.id} cameo={cameo} /> : null}
    </span>
  )
}

export type QWicksCelebrationVariant = 'cheer' | 'lap' | 'toast'

export const QWICKS_CELEBRATION_VARIANTS: readonly QWicksCelebrationVariant[] = [
  'cheer',
  'lap',
  'toast'
]

/* 与 CSS 里 forwards 动画总时长一致 */
export const QWICKS_CELEBRATION_DURATIONS_MS: Record<QWicksCelebrationVariant, number> = {
  cheer: 3200,
  lap: 3600,
  toast: 3400
}

/* 每种庆祝的双形象:普通模式用 QWicks 鸟,iQWicks 模式自动换坤鸡 */
const QWICKS_CELEBRATION_FIGURES: Record<QWicksCelebrationVariant, { qwicks: string; iqwicks: string }> = {
  cheer: { qwicks: qwicksGreetFigure, iqwicks: iqwicksWaveFigure },
  lap: { qwicks: qwicksSurfFigure, iqwicks: iqwicksRunFigure },
  toast: { qwicks: qwicksSitFigure, iqwicks: iqwicksBobaFigure }
}

/* 回合至少跑这么久才庆祝,避免秒回也放彩带 */
const QWICKS_CELEBRATION_MIN_TURN_MS = 2000

let qwicksCelebrationSequence = 0

export function pickQWicksCelebration(): { id: number; variant: QWicksCelebrationVariant } {
  const variant =
    QWICKS_CELEBRATION_VARIANTS[Math.floor(Math.random() * QWICKS_CELEBRATION_VARIANTS.length)] ??
    'cheer'
  qwicksCelebrationSequence += 1
  return { id: qwicksCelebrationSequence, variant }
}

function QWicksConfettiBurst(): ReactElement {
  return (
    <span className="ds-qwicks-confetti">
      {Array.from({ length: 10 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  )
}

/* 庆祝戏码的插件槽位回退链 */
export const UI_PLUGIN_CELEBRATION_SLOTS: Record<QWicksCelebrationVariant, readonly UiPluginFigureSlot[]> = {
  cheer: ['greet', 'swim'],
  lap: ['run', 'surf', 'swim'],
  toast: ['sit', 'greet', 'swim']
}

/** 单场庆祝:跃起欢呼 / 胜利冲浪(iQWicks 为快攻冲刺) / 举杯庆功 */
export function QWicksCelebration({ variant }: { variant: QWicksCelebrationVariant }): ReactElement {
  const figures = QWICKS_CELEBRATION_FIGURES[variant]
  const qwicksFigureSrc = useUiPluginFigure(UI_PLUGIN_CELEBRATION_SLOTS[variant], figures.qwicks)
  return (
    <span className={`ds-qwicks-celebration ds-qwicks-celebration-${variant}`}>
      <span className="ds-qwicks-celebration-figure-wrap">
        <img
          className="ds-qwicks-celebration-figure is-qwicks"
          src={qwicksFigureSrc}
          alt=""
          draggable={false}
          decoding="async"
        />
        <img
          className="ds-qwicks-celebration-figure is-iqwicks"
          src={figures.iqwicks}
          alt=""
          draggable={false}
          decoding="async"
        />
        <QWicksConfettiBurst />
      </span>
    </span>
  )
}

/** 回合完成庆祝层:active(busy)从 true 落回 false 且跑得够久时,随机放一段 */
export function QWicksCelebrationLayer({
  active,
  suppressed = false
}: {
  active: boolean
  suppressed?: boolean
}): ReactElement {
  const [celebration, setCelebration] = useState<{
    id: number
    variant: QWicksCelebrationVariant
  } | null>(null)
  const turnStartRef = useRef<number | null>(null)
  const hideTimerRef = useRef(0)

  useEffect(() => {
    if (active) {
      turnStartRef.current = Date.now()
      return
    }
    if (turnStartRef.current === null) return
    const elapsed = Date.now() - turnStartRef.current
    turnStartRef.current = null
    if (suppressed) return
    if (elapsed < QWICKS_CELEBRATION_MIN_TURN_MS) return

    const next = pickQWicksCelebration()
    setCelebration(next)
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      setCelebration(null)
    }, QWICKS_CELEBRATION_DURATIONS_MS[next.variant])
  }, [active, suppressed])

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), [])

  return (
    <span className="ds-qwicks-celebration-layer" aria-hidden="true">
      {celebration ? <QWicksCelebration key={celebration.id} variant={celebration.variant} /> : null}
    </span>
  )
}

const SIDEBAR_MASCOT_KINDS: readonly QWicksStateFigureKind[] = ['sit', 'greet', 'sleep']
const SIDEBAR_MASCOT_INTERVAL_MS = 10000

/** 侧边栏角落的吉祥物:循环 坐着→打招呼→睡觉,iQWicks 模式自动换成坤鸡全家福 */
export function SidebarMascot(): ReactElement {
  const [kindIndex, setKindIndex] = useState(() =>
    Math.floor(Math.random() * SIDEBAR_MASCOT_KINDS.length)
  )

  useEffect(() => {
    const interval = window.setInterval(() => {
      setKindIndex((current) => (current + 1) % SIDEBAR_MASCOT_KINDS.length)
    }, SIDEBAR_MASCOT_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  const kind = SIDEBAR_MASCOT_KINDS[kindIndex] ?? 'sit'
  return <QWicksStateFigure key={kind} kind={kind} className="ds-sidebar-mascot" />
}

export type IqwicksWorkLogoVariant = 'dribble' | 'run' | 'boba'

export const IQWICKS_WORK_LOGO_VARIANTS: readonly IqwicksWorkLogoVariant[] = [
  'dribble',
  'run',
  'boba'
]

const IQWICKS_WORK_LOGO_FIGURES: Record<IqwicksWorkLogoVariant, string> = {
  dribble: iqwicksFigure,
  run: iqwicksRunFigure,
  boba: iqwicksBobaFigure
}

export const IQWICKS_WORK_LOGO_VARIANT_LABEL_KEYS: Record<IqwicksWorkLogoVariant, string> = {
  dribble: 'iqwicksDribbling',
  run: 'iqwicksFastBreak',
  boba: 'iqwicksBobaTime'
}

const IQWICKS_WORK_LOGO_VARIANT_INTERVAL_MS = 2800

export function pickIqwicksWorkLogoVariant(
  current?: IqwicksWorkLogoVariant
): IqwicksWorkLogoVariant {
  const candidates = IQWICKS_WORK_LOGO_VARIANTS.filter((variant) => variant !== current)
  const pool = candidates.length > 0 ? candidates : IQWICKS_WORK_LOGO_VARIANTS
  return pool[Math.floor(Math.random() * pool.length)] ?? 'dribble'
}

export function useIqwicksWorkLogoVariant(active: boolean): IqwicksWorkLogoVariant {
  const [variant, setVariant] = useState<IqwicksWorkLogoVariant>(() => pickIqwicksWorkLogoVariant())

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => {
      setVariant((current) => pickIqwicksWorkLogoVariant(current))
    }, IQWICKS_WORK_LOGO_VARIANT_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [active])

  return variant
}

export function AnimatedWorkLogo({
  active = false,
  className = '',
  iqwicksVariant,
  mode,
  phase = 'lead',
  size = 'sm'
}: {
  active?: boolean
  className?: string
  iqwicksVariant?: IqwicksWorkLogoVariant
  mode?: WorkLogoSwimMode
  phase?: 'lead' | 'trail'
  size?: 'sm' | 'md'
}): ReactElement {
  const rotatedIqwicksVariant = useIqwicksWorkLogoVariant(active && iqwicksVariant === undefined)
  const effectiveIqwicksVariant = iqwicksVariant ?? rotatedIqwicksVariant
  const rotatedSwimMode = useWorkLogoSwimMode(active && mode === undefined)
  const swimMode = mode ?? rotatedSwimMode
  const figureSrc = useUiPluginFigure(
    swimMode === 'surf' ? ['surf', 'swim'] : ['swim'],
    swimMode === 'surf' ? qwicksSurfFigure : qwicksLogo
  )

  return (
    <span
      className={[
        'ds-work-logo',
        `ds-work-logo-${size}`,
        `ds-work-logo-phase-${phase}`,
        `ds-work-logo-mode-${swimMode}`,
        active ? 'is-active' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className="ds-work-logo-gust" />
      <span className="ds-work-logo-current" />
      <span className="ds-work-logo-swell" />
      <span className="ds-work-logo-wave ds-work-logo-wave-back" />
      <span className="ds-work-logo-ripple" />
      <span className="ds-work-logo-wave ds-work-logo-wave-front" />
      <span className="ds-work-logo-breaker" />
      <span className="ds-work-logo-wake" />
      <span className="ds-work-logo-foam" />
      <span className="ds-work-logo-crest" />
      <span className="ds-work-logo-splash" />
      <span className="ds-work-logo-spray" />
      <span className="ds-work-logo-bubbles" />
      <img className="ds-work-logo-echo" src={figureSrc} alt="" draggable={false} decoding="async" />
      <span
        className={`ds-iqwicks-logo ds-iqwicks-logo-${effectiveIqwicksVariant}`}
        data-iqwicks-variant={effectiveIqwicksVariant}
      >
        <span className="ds-iqwicks-logo-shadow" />
        <img
          className="ds-iqwicks-figure"
          src={IQWICKS_WORK_LOGO_FIGURES[effectiveIqwicksVariant]}
          alt=""
          draggable={false}
          decoding="async"
        />
      </span>
      <span className="ds-work-logo-track">
        <span className="ds-work-logo-body">
          <img className="ds-work-logo-image" src={figureSrc} alt="" draggable={false} decoding="async" />
        </span>
      </span>
    </span>
  )
}
