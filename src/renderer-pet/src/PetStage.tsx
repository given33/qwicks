/**
 * 桌面宠物舞台 v2（M3 物理交互完整版）。
 *
 * 集成：拖拽悬空 + 重力下坠 + 落地扬尘 + 边缘撞墙 + 物理阴影 +
 * 季节/天气粒子层 + 待机呼吸 + 跟随鼠标视线 + 常驻 rAF 循环。
 *
 * 纯逻辑（状态机/重力/寻路/粒子/季节）都在可单测模块里，本组件只做集成与渲染。
 * 视觉效果"拉满"：多粒子层、弹性变形、扬尘、眩晕星、季节天气常驻。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isPointInBbox } from './bbox'
import { computeGazeTilt } from './gaze'
import {
  computeFallStep,
  hasReachedTarget,
  isMotionTimedOut,
  makeIdle,
  transitionPetMotion,
  type MotionContext,
  type PetMotionState
} from './pet-motion'
import { petFigure } from './pet-figure-pet'
import {
  pickWeather,
  seasonForDate,
  spawnDustParticles,
  stepParticles,
  type Particle,
  type Season,
  type Weather
} from './pet-environment'

const PET_W = 96
const PET_H = 120
const WALK_SPEED = 0.06 // px/ms
const GROUND_INSET = 8 // 离窗口底部多少 px 算"地面"（任务栏留白）

type PetBridge = { setInteractive: (interactive: boolean) => void }
function getBridge(): PetBridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: PetBridge }).pet ?? null : null
}

export function PetStage(): ReactElement {
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, Math.floor(window.innerWidth / 2 - PET_W / 2)),
    y: Math.max(0, Math.floor(window.innerHeight - PET_H - 40))
  }))
  const positionRef = useRef(position)
  positionRef.current = position

  const motionRef = useRef<PetMotionState>(makeIdle(performance.now()))
  const interactiveRef = useRef(false)
  const draggingOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [dustParticles, setDustParticles] = useState<Particle[]>([])
  const [showDizzy, setShowDizzy] = useState(false)

  // 环境：季节 + 天气（启动时定一次）
  const [env] = useState<{ season: Season; weather: Weather }>(() => {
    const season = seasonForDate(new Date())
    return { season, weather: pickWeather(season) }
  })

  // 热区穿透切换
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const bridge = getBridge()
      setMousePos({ x: event.clientX, y: event.clientY })
      if (motionRef.current.kind === 'dragging') return // 拖拽中保持可交互
      if (!bridge) return
      const bbox = { x: positionRef.current.x, y: positionRef.current.y, width: PET_W, height: PET_H }
      const inside = isPointInBbox({ x: event.clientX, y: event.clientY }, bbox, 8)
      if (inside !== interactiveRef.current) {
        interactiveRef.current = inside
        bridge.setInteractive(inside)
      }
    }
    const onDown = (event: MouseEvent): void => {
      const bbox = { x: positionRef.current.x, y: positionRef.current.y, width: PET_W, height: PET_H }
      if (!isPointInBbox({ x: event.clientX, y: event.clientY }, bbox, 8)) return
      // grab → dragging
      const ctx: MotionContext = { now: performance.now(), walkArea: windowBounds(), position: positionRef.current }
      motionRef.current = transitionPetMotion(motionRef.current, { type: 'grab' }, ctx)
      draggingOffsetRef.current = { dx: event.clientX - positionRef.current.x, dy: event.clientY - positionRef.current.y }
      interactiveRef.current = true
      getBridge()?.setInteractive(true)
    }
    const onUp = (): void => {
      if (motionRef.current.kind !== 'dragging') return
      const ctx: MotionContext = { now: performance.now(), walkArea: windowBounds(), position: positionRef.current }
      motionRef.current = transitionPetMotion(motionRef.current, { type: 'release' }, ctx)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 常驻 rAF 主循环：物理 + 粒子 + 状态机
  useEffect(() => {
    let raf = 0
    let lastFrame = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(now - lastFrame, 50) // 钳制 dt 防卡顿后大跳
      lastFrame = now
      const state = motionRef.current
      const pos = positionRef.current
      const groundY = window.innerHeight - PET_H - GROUND_INSET
      const ctx: MotionContext = { now, walkArea: windowBounds(), position: pos }

      // 状态转移
      if (isMotionTimedOut(state, now)) {
        motionRef.current = transitionPetMotion(state, { type: 'timeout' }, ctx)
      }

      const current = motionRef.current
      if (current.kind === 'dragging') {
        // 跟随鼠标
        if (mousePos) {
          setPosition({
            x: mousePos.x - draggingOffsetRef.current.dx,
            y: mousePos.y - draggingOffsetRef.current.dy
          })
        }
      } else if (current.kind === 'falling') {
        const r = computeFallStep(pos.y, current.vy, dt, groundY)
        setPosition({ x: pos.x, y: r.y })
        if (r.landed) {
          motionRef.current = transitionPetMotion(current, { type: 'land' }, ctx)
          // 落地扬尘 + 眩晕
          setDustParticles((p) => [...p, ...spawnDustParticles(pos.x + PET_W / 2, groundY + PET_H, 16)])
          setShowDizzy(true)
          window.setTimeout(() => setShowDizzy(false), 1200)
        } else {
          motionRef.current = { kind: 'falling', vy: r.vy }
        }
      } else if (current.kind === 'wander') {
        if (hasReachedTarget(pos, current.target)) {
          motionRef.current = transitionPetMotion(current, { type: 'reached' }, ctx)
        } else {
          // 撞墙检测（简化：触左右边）
          if (pos.x <= 0) {
            motionRef.current = transitionPetMotion(current, { type: 'hitWall', fromLeft: true }, ctx)
          } else if (pos.x >= window.innerWidth - PET_W) {
            motionRef.current = transitionPetMotion(current, { type: 'hitWall', fromLeft: false }, ctx)
          } else {
            const dx = current.target.x - pos.x
            const dy = current.target.y - pos.y
            const dist = Math.hypot(dx, dy)
            const step = Math.min(dist, WALK_SPEED * dt)
            if (dist > 0) {
              setPosition({ x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step })
            }
          }
        }
      }

      // 粒子推进
      if (dustParticles.length > 0) {
        setDustParticles((p) => stepParticles(p, dt))
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mousePos, dustParticles.length])

  // idle 时跟随鼠标视线
  const isIdle = motionRef.current.kind === 'idle'
  const tilt = isIdle && mousePos
    ? computeGazeTilt({ x: position.x + PET_W / 2, y: position.y + PET_H / 2 }, mousePos)
    : 0

  // 各状态的视觉变形
  const isDragging = motionRef.current.kind === 'dragging'
  const isFalling = motionRef.current.kind === 'falling'
  const isLanded = motionRef.current.kind === 'landed'
  const isBonk = motionRef.current.kind === 'bonk'
  const airborne = isDragging || isFalling // 悬空（阴影变小变淡）

  // 姿态选择
  const pose = isDragging || isFalling ? 'talk' // 慌张/惊讶
    : isLanded ? 'sad' // 屁股着地委屈
      : isBonk ? 'talk'
        : motionRef.current.kind === 'idle' ? 'stand'
          : 'walk' // wander

  return (
    <>
      {/* 季节/天气粒子层（背景，pointer-events none） */}
      <EnvironmentLayer season={env.season} weather={env.weather} />

      {/* 物理阴影（地面椭圆，悬空变小变淡） */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: position.x + PET_W * 0.1,
          top: window.innerHeight - GROUND_INSET - 12,
          width: PET_W * 0.8,
          height: 18,
          borderRadius: '50%',
          background: `rgba(0,0,0,${airborne ? 0.1 : 0.25})`,
          transform: `scale(${airborne ? 0.7 : 1})`,
          transition: 'transform 0.15s ease-out, background 0.15s ease-out',
          pointerEvents: 'none'
        }}
      />

      {/* 扬尘粒子（落地特效） */}
      {dustParticles.map((p, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: `rgba(180,160,120,${p.life / p.maxLife * 0.6})`,
            transform: `rotate(${p.rotation}rad)`,
            pointerEvents: 'none'
          }}
        />
      ))}

      {/* 眩晕星 */}
      {showDizzy && (
        <div aria-hidden style={{
          position: 'absolute',
          left: position.x + PET_W / 2 - 20,
          top: position.y - 28,
          fontSize: 20,
          animation: 'pet-dizzy-spin 1s linear infinite',
          pointerEvents: 'none'
        }}>⭐⭐</div>
      )}

      {/* 精灵本体 */}
      <div
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          width: PET_W,
          height: PET_H,
          // 待机呼吸（idle 时微幅起伏，永远在动）
          animation: isIdle ? 'pet-breathe 2.4s ease-in-out infinite' : undefined,
          // 落地弹性 squash、悬空慌张抖动
          transform: `${isLanded ? 'scale(1.15, 0.7)' : ''} ${isDragging ? `rotate(${Math.sin(performance.now() / 50) * 6}deg)` : ''} ${isBonk ? 'scale(0.9, 1.05)' : ''} rotate(${isFalling ? 0 : tilt}deg)`,
          transformOrigin: 'bottom center',
          transition: isIdle ? 'transform 0.4s ease-out' : 'none',
          pointerEvents: 'none'
        }}
      >
        <img
          src={petFigure(pose)}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* 内联 keyframes（呼吸 + 眩晕） */}
      <style>{`
        @keyframes pet-breathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.01); }
        }
        @keyframes pet-dizzy-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}

function windowBounds() {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

/** 季节/天气粒子层（简化版：根据天气渲染不同粒子）。 */
function EnvironmentLayer({ season, weather }: { season: Season; weather: Weather }): ReactElement {
  // 用一组 CSS 动画的粒子表现天气。M1 范围内做基础呈现。
  const particleColor =
    weather === 'snow' ? 'rgba(255,255,255,0.85)'
      : weather === 'rain' ? 'rgba(150,180,200,0.6)'
        : season === 'autumn' ? 'rgba(220,140,60,0.6)'
          : 'rgba(255,220,150,0.4)'
  const count = weather === 'sunny' ? 12 : 30
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${(i * 37) % 100}%`,
            top: `-20px`,
            width: weather === 'rain' ? 2 : 6,
            height: weather === 'rain' ? 16 : 6,
            borderRadius: '50%',
            background: particleColor,
            animation: `pet-weather-fall ${4 + (i % 5)}s linear ${(i % 7) * 0.5}s infinite`,
            opacity: 0.7
          }}
        />
      ))}
      <style>{`
        @keyframes pet-weather-fall {
          from { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 0.7; }
          to { transform: translateY(100vh); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
