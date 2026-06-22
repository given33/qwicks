/**
 * 桌面宠物舞台（M1 最小实现）。
 *
 * 当前职责：
 *   - 渲染一个暖黄占位精灵（M2 裁切精灵图后替换为真实姿态）
 *   - 监听 forward 透传的 mousemove，鼠标进入/离开精灵 bbox 时调 IPC 切换穿透态
 *     （R2 点击穿透准确性的渲染层一半，主进程一半在 pet-window.ts）
 *
 * 后续扩展：漫步引擎（M1-T6）、物理交互（M3）、情绪表情（M4）都在此挂载。
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isPointInBbox } from './bbox'

// 暖黄形象的品牌色（M2 裁切后替换为真实精灵图，这里先占位）
const PET_COLOR = '#f5c451'
const PET_SIZE = { width: 96, height: 120 }

// 渲染层通过 preload 暴露的 window.pet 调用穿透切换
type PetBridge = { setInteractive: (interactive: boolean) => void }
function getPetBridge(): PetBridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { pet?: PetBridge }).pet ?? null : null
}

export function PetStage(): ReactElement {
  // 精灵位置（窗口内坐标）。M1 先固定在窗口中部偏下；漫步引擎（M1-T6）接管后动态变化。
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, Math.floor(window.innerWidth / 2 - PET_SIZE.width / 2)),
    y: Math.max(0, Math.floor(window.innerHeight / 2 - PET_SIZE.height / 2))
  }))
  const interactiveRef = useRef(false)

  // 监听 forward 透传的 mousemove，做热区检测切换穿透态。
  // 穿透态下普通鼠标事件（mouseenter/leave on element）不会触发，必须靠 mousemove + bbox 判定。
  useEffect(() => {
    const bbox = () => ({ x: position.x, y: position.y, width: PET_SIZE.width, height: PET_SIZE.height })
    const onMove = (event: MouseEvent): void => {
      const bridge = getPetBridge()
      if (!bridge) return
      const inside = isPointInBbox({ x: event.clientX, y: event.clientY }, bbox(), 8)
      if (inside !== interactiveRef.current) {
        interactiveRef.current = inside
        bridge.setInteractive(inside)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [position])

  // 窗口尺寸变化时把精灵拉回视口内（防显示器变化后跑到屏外）
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

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: PET_SIZE.width,
        height: PET_SIZE.height,
        // 占位暖黄椭圆 + 圆润感。M2 替换为 <img src={petFrame('stand')} />
        background: PET_COLOR,
        borderRadius: '48% 48% 42% 42%',
        boxShadow: '0 8px 16px rgba(0,0,0,0.18)',
        // pointer-events none：穿透态下窗口本身不收事件，靠 forward mousemove；
        // 切到可交互后整窗可收事件，这个 none 不影响（精灵用单独命中区由 bbox 把控）
        pointerEvents: 'none'
      }}
    />
  )
}
