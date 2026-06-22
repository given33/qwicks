/**
 * 桌面宠物舞台（M1：占位精灵 + 穿透切换 + 漫步引擎）。
 *
 * 职责：
 *   - 渲染暖黄占位精灵（M2 裁切精灵图后替换）
 *   - 监听 forward mousemove 做热区穿透切换（R2）
 *   - rAF 驱动漫步状态机（M1-T6）：idle 待机 ↔ wander 走向目标，当前屏内
 *
 * M3 起会在此扩展 dragging/falling/跨屏寻路/物理阴影/情绪表情等。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isPointInBbox } from './bbox'
import { computeGazeTilt } from './gaze'
import {
  hasReachedTarget,
  isMotionTimedOut,
  makeIdle,
  transitionPetMotion,
  type MotionContext,
  type PetMotionState
} from './pet-motion'

const PET_COLOR = '#f5c451'
const PET_SIZE = { width: 96, height: 120 }
const WALK_SPEED_PX_PER_MS = 0.06 // 约 60px/s

type PetBridge = { setInteractive: (interactive: boolean) => void }
function getPetBridge(): PetBridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: PetBridge }).pet ?? null : null
}

/** 取当前屏（精灵所在屏）的可走区域 = 整个窗口（透明窗铺满虚拟桌面）。M3 起按真实屏 work area 收窄。 */
function currentWalkArea(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

export function PetStage(): ReactElement {
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, Math.floor(window.innerWidth / 2 - PET_SIZE.width / 2)),
    y: Math.max(0, Math.floor(window.innerHeight / 2 - PET_SIZE.height / 2))
  }))
  const positionRef = useRef(position)
  positionRef.current = position

  const motionRef = useRef<PetMotionState>(makeIdle(performance.now()))
  const interactiveRef = useRef(false)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  // 热区穿透切换：forward mousemove 检测精灵 bbox
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const bridge = getPetBridge()
      setMousePos({ x: event.clientX, y: event.clientY })
      if (!bridge) return
      const bbox = {
        x: positionRef.current.x,
        y: positionRef.current.y,
        width: PET_SIZE.width,
        height: PET_SIZE.height
      }
      const inside = isPointInBbox({ x: event.clientX, y: event.clientY }, bbox, 8)
      if (inside !== interactiveRef.current) {
        interactiveRef.current = inside
        bridge.setInteractive(inside)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // 漫步引擎：rAF 单循环驱动 idle/wander
  useEffect(() => {
    let raf = 0
    let lastFrame = performance.now()
    const tick = (now: number): void => {
      const dt = now - lastFrame
      lastFrame = now
      let state = motionRef.current
      const pos = positionRef.current

      // 处理状态转移（timeout / reached）
      if (isMotionTimedOut(state, now)) {
        const ctx: MotionContext = { now, walkArea: currentWalkArea(), position: pos }
        state = transitionPetMotion(state, { type: 'timeout' }, ctx)
        motionRef.current = state
      }
      if (state.kind === 'wander') {
        if (hasReachedTarget(pos, state.target)) {
          const ctx: MotionContext = { now, walkArea: currentWalkArea(), position: pos }
          state = transitionPetMotion(state, { type: 'reached' }, ctx)
          motionRef.current = state
        } else {
          // 朝目标移动一步
          const dx = state.target.x - pos.x
          const dy = state.target.y - pos.y
          const dist = Math.hypot(dx, dy)
          const step = Math.min(dist, WALK_SPEED_PX_PER_MS * dt)
          if (dist > 0) {
            setPosition({ x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 窗口尺寸变化时把精灵拉回视口内
  useEffect(() => {
    const onResize = (): void => {
      setPosition((prev) => ({
        x: Math.min(prev.x, Math.max(0, window.innerWidth - PET_SIZE.width)),
        y: Math.min(prev.y, Math.max(0, window.innerHeight - PET_SIZE.height))
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 桌面感知：idle 时头部朝鼠标方向轻微倾斜（"它注意到你了"）
  const isIdle = motionRef.current.kind === 'idle'
  const tilt = isIdle && mousePos
    ? computeGazeTilt(
        { x: position.x + PET_SIZE.width / 2, y: position.y + PET_SIZE.height / 2 },
        mousePos
      )
    : 0

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: PET_SIZE.width,
        height: PET_SIZE.height,
        background: PET_COLOR,
        borderRadius: '48% 48% 42% 42%',
        boxShadow: '0 8px 16px rgba(0,0,0,0.18)',
        // 平滑过渡让倾斜变化柔和；位置变化不过渡（漫步要即时跟手）
        transition: 'transform 0.4s ease-out',
        transform: `rotate(${tilt}deg)`,
        transformOrigin: 'bottom center',
        pointerEvents: 'none'
      }}
    />
  )
}
