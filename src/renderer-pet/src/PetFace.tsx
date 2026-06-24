/**
 * 桌面宠物 —— 程序化面部合成器（P1）。
 *
 * 用 SVG 实时合成五官（眼/嘴/腮红/头顶符号），叠加在身体帧之上。
 * 这样 9 个基础帧 + 25+ 表情组合 → 数百种视觉状态，逼近 QQ 的表情丰富度。
 *
 * PetFace 渲染层；表情参数来自 shared/pet-expressions（纯数据，可测）。
 */
import { type ReactElement } from 'react'
import type { FaceParams } from '@shared/pet-expressions'

/**
 * 面部合成器。在 (cx, cy) 中心绘制五官。
 * faceWidth 控制五官展开宽度（适配不同 stage 体型）。
 */
export function PetFace({
  face,
  cx,
  cy,
  faceWidth = 56
}: {
  face: FaceParams
  cx: number
  cy: number
  faceWidth?: number
}): ReactElement {
  const eyeDx = faceWidth * 0.22
  const eyeY = cy - faceWidth * 0.05
  const mouthY = cy + faceWidth * 0.35
  const blushDx = faceWidth * 0.32
  const blushY = cy + faceWidth * 0.1

  return (
    <g>
      {/* 腮红 */}
      {face.blush > 0 && (
        <>
          <ellipse cx={cx - blushDx} cy={blushY} rx={faceWidth * 0.1} ry={faceWidth * 0.07}
            fill={`rgba(255,140,160,${face.blush * 0.6})`} />
          <ellipse cx={cx + blushDx} cy={blushY} rx={faceWidth * 0.1} ry={faceWidth * 0.07}
            fill={`rgba(255,140,160,${face.blush * 0.6})`} />
        </>
      )}

      {/* 眼睛 */}
      <Eye shape={face.eyes} cx={cx - eyeDx} cy={eyeY} r={faceWidth * 0.08} />
      <Eye shape={face.eyes} cx={cx + eyeDx} cy={eyeY} r={faceWidth * 0.08} mirror />

      {/* 嘴巴 */}
      <Mouth shape={face.mouth} cx={cx} cy={mouthY} w={faceWidth * 0.22} />

      {/* 头顶符号 */}
      {face.topEmoji && (
        <text x={cx} y={cy - faceWidth * 0.7} textAnchor="middle" fontSize={faceWidth * 0.4}>
          {face.topEmoji}
        </text>
      )}
    </g>
  )
}

function Eye({
  shape, cx, cy, r, mirror
}: {
  shape: FaceParams['eyes']
  cx: number
  cy: number
  r: number
  mirror?: boolean
}): ReactElement {
  const fill = '#3a2a1a'
  const flip = mirror ? -1 : 1

  switch (shape) {
    case 'happy':
      // 弯月眼 ^^
      return <path d={`M ${cx - r} ${cy} Q ${cx} ${cy - r * 1.5} ${cx + r} ${cy}`}
        stroke={fill} strokeWidth={r * 0.6} fill="none" strokeLinecap="round" />
    case 'sad':
      // 倒弯月（垂眼）
      return <path d={`M ${cx - r} ${cy + r * 0.3} Q ${cx} ${cy - r * 0.8} ${cx + r} ${cy + r * 0.3}`}
        stroke={fill} strokeWidth={r * 0.5} fill="none" strokeLinecap="round" />
    case 'closed':
      // 一字眼 -_-
      return <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={fill} strokeWidth={r * 0.5} strokeLinecap="round" />
    case 'wide':
      // 大圆眼
      return <circle cx={cx} cy={cy} r={r * 1.3} fill={fill} />
    case 'wink':
      // 单眼弯（左眼弯，右眼正常）
      return mirror
        ? <circle cx={cx} cy={cy} r={r} fill={fill} />
        : <path d={`M ${cx - r} ${cy} Q ${cx} ${cy - r * 1.5} ${cx + r} ${cy}`}
            stroke={fill} strokeWidth={r * 0.6} fill="none" strokeLinecap="round" />
    case 'heart':
      // 爱心眼
      return <text x={cx} y={cy + r * 0.7} textAnchor="middle" fontSize={r * 2.5} fill="#e84a6a">♥</text>
    case 'star':
      // 星星眼
      return <text x={cx} y={cy + r * 0.8} textAnchor="middle" fontSize={r * 2.2}>⭐</text>
    case 'angry':
      // 怒眼（> <）
      return <>
        <line x1={cx - r} y1={cy - r * 0.7} x2={cx} y2={cy} stroke={fill} strokeWidth={r * 0.4} strokeLinecap="round" />
        <line x1={cx + r} y1={cy - r * 0.7} x2={cx} y2={cy} stroke={fill} strokeWidth={r * 0.4} strokeLinecap="round" transform={`scale(${flip},1)`} transform-origin={cx} />
        <circle cx={cx} cy={cy + r * 0.2} r={r * 0.5} fill={fill} />
      </>
    case 'dizzy':
      // 晕眩眼（螺旋）
      return <text x={cx} y={cy + r * 0.7} textAnchor="middle" fontSize={r * 1.8}>🌀</text>
    case 'sparkle':
      // 闪光眼
      return <>
        <circle cx={cx} cy={cy} r={r} fill={fill} />
        <circle cx={cx + r * 0.3} cy={cy - r * 0.3} r={r * 0.3} fill="#fff" />
      </>
    case 'half':
      // 半睁（慵懒）
      return <path d={`M ${cx - r} ${cy} Q ${cx} ${cy - r * 0.4} ${cx + r} ${cy} Z`} fill={fill} />
    case 'triangle':
      // 三角眼（机敏）
      return <polygon points={`${cx},${cy - r} ${cx - r},${cy + r * 0.7} ${cx + r},${cy + r * 0.7}`} fill={fill} />
    case 'x':
      // X 眼（晕/垮）
      return <>
        <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={fill} strokeWidth={r * 0.4} strokeLinecap="round" />
        <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={fill} strokeWidth={r * 0.4} strokeLinecap="round" />
      </>
    case 'spiral':
      // 螺旋眼（深度晕）
      return <text x={cx} y={cy + r * 0.8} textAnchor="middle" fontSize={r * 1.8}>🌀</text>
    case 'lined':
      // 横线眼（无语/冷漠）
      return <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={fill} strokeWidth={r * 0.3} />
    case 'worried':
      // 担忧眼（八字眉 + 点眼）
      return <>
        <line x1={cx - r} y1={cy - r} x2={cx} y2={cy - r * 0.4} stroke={fill} strokeWidth={r * 0.3} transform={`scale(${mirror ? -1 : 1},1)`} transform-origin={cx} />
        <circle cx={cx} cy={cy + r * 0.1} r={r * 0.55} fill={fill} />
      </>
    case 'smug':
      // 得意眼（半闭+挑）
      return <path d={`M ${cx - r} ${cy + r * 0.2} Q ${cx} ${cy - r * 0.6} ${cx + r} ${cy + r * 0.2}`}
        stroke={fill} strokeWidth={r * 0.5} fill="none" strokeLinecap="round" />
    case 'teary':
      // 含泪眼
      return <>
        <circle cx={cx} cy={cy} r={r} fill={fill} />
        <ellipse cx={cx - r * 0.8} cy={cy + r * 0.8} rx={r * 0.35} ry={r * 0.6} fill="#7ec8e3" />
      </>
    case 'normal':
    default:
      return <circle cx={cx} cy={cy} r={r} fill={fill} />
  }
}

function Mouth({
  shape, cx, cy, w
}: {
  shape: FaceParams['mouth']
  cx: number
  cy: number
  w: number
}): ReactElement {
  const fill = '#3a2a1a'
  const h = w * 0.5

  switch (shape) {
    case 'smile':
      return <path d={`M ${cx - w} ${cy} Q ${cx} ${cy + h} ${cx + w} ${cy}`}
        stroke={fill} strokeWidth={w * 0.2} fill="none" strokeLinecap="round" />
    case 'open':
      return <ellipse cx={cx} cy={cy + h * 0.3} rx={w * 0.6} ry={h * 0.7} fill={fill} />
    case 'frown':
      return <path d={`M ${cx - w} ${cy + h * 0.5} Q ${cx} ${cy - h * 0.3} ${cx + w} ${cy + h * 0.5}`}
        stroke={fill} strokeWidth={w * 0.2} fill="none" strokeLinecap="round" />
    case 'o':
      return <circle cx={cx} cy={cy + h * 0.2} r={w * 0.4} fill="none" stroke={fill} strokeWidth={w * 0.15} />
    case 'tongue':
      return <>
        <path d={`M ${cx - w} ${cy} Q ${cx} ${cy + h} ${cx + w} ${cy}`} stroke={fill} strokeWidth={w * 0.2} fill="none" strokeLinecap="round" />
        <ellipse cx={cx} cy={cy + h * 0.8} rx={w * 0.3} ry={h * 0.4} fill="#e87a8a" />
      </>
    case 'cat':
      // 猫嘴 ≈∈≈
      return <path d={`M ${cx - w} ${cy} Q ${cx - w * 0.4} ${cy + h} ${cx} ${cy} Q ${cx + w * 0.4} ${cy + h} ${cx + w} ${cy}`}
        stroke={fill} strokeWidth={w * 0.18} fill="none" strokeLinecap="round" />
    case 'shocked':
      return <ellipse cx={cx} cy={cy + h * 0.4} rx={w * 0.45} ry={h * 0.9} fill={fill} />
    case 'whistle':
      return <path d={`M ${cx - w} ${cy + h * 0.2} L ${cx + w * 0.5} ${cy + h * 0.2}`}
        stroke={fill} strokeWidth={w * 0.2} strokeLinecap="round" />
    case 'grin':
      // 露齿大笑
      return <>
        <path d={`M ${cx - w} ${cy} Q ${cx} ${cy + h * 1.3} ${cx + w} ${cy} Z`} fill={fill} />
        <path d={`M ${cx - w * 0.7} ${cy + h * 0.1} L ${cx + w * 0.7} ${cy + h * 0.1}`} stroke="#fff" strokeWidth={h * 0.3} />
      </>
    case 'pout':
      // 嘟嘴（撒娇）
      return <ellipse cx={cx} cy={cy + h * 0.4} rx={w * 0.3} ry={h * 0.4} fill="#e87a8a" />
    case 'side':
      // 歪嘴（坏笑）
      return <path d={`M ${cx - w * 0.6} ${cy + h * 0.2} Q ${cx} ${cy + h * 0.8} ${cx + w * 0.9} ${cy - h * 0.1}`}
        stroke={fill} strokeWidth={w * 0.18} fill="none" strokeLinecap="round" />
    case 'wavy':
      // 波浪嘴（哭腔）
      return <path d={`M ${cx - w} ${cy} Q ${cx - w * 0.5} ${cy + h * 0.6} ${cx} ${cy} T ${cx + w} ${cy}`}
        stroke={fill} strokeWidth={w * 0.18} fill="none" strokeLinecap="round" />
    case 'zipper':
      // 拉链嘴（闭嘴不说）
      return <>
        <line x1={cx - w * 0.7} y1={cy + h * 0.2} x2={cx + w * 0.7} y2={cy + h * 0.2} stroke={fill} strokeWidth={w * 0.2} strokeLinecap="round" />
        <line x1={cx - w * 0.5} y1={cy + h * 0.2} x2={cx - w * 0.5} y2={cy + h * 0.5} stroke={fill} strokeWidth={w * 0.15} />
      </>
    case 'smirk':
      // 单边上扬（邪魅）
      return <path d={`M ${cx - w * 0.5} ${cy + h * 0.3} Q ${cx} ${cy - h * 0.2} ${cx + w} ${cy - h * 0.1}`}
        stroke={fill} strokeWidth={w * 0.2} fill="none" strokeLinecap="round" />
    case 'teeth':
      // 咬牙（忍）
      return <>
        <line x1={cx - w} y1={cy + h * 0.2} x2={cx + w} y2={cy + h * 0.2} stroke={fill} strokeWidth={w * 0.25} strokeLinecap="round" />
        <line x1={cx - w * 0.5} y1={cy + h * 0.1} x2={cx - w * 0.5} y2={cy + h * 0.3} stroke={fill} strokeWidth={w * 0.1} />
        <line x1={cx} y1={cy + h * 0.1} x2={cx} y2={cy + h * 0.3} stroke={fill} strokeWidth={w * 0.1} />
        <line x1={cx + w * 0.5} y1={cy + h * 0.1} x2={cx + w * 0.5} y2={cy + h * 0.3} stroke={fill} strokeWidth={w * 0.1} />
      </>
    case 'flat':
    default:
      return <line x1={cx - w * 0.7} y1={cy + h * 0.2} x2={cx + w * 0.7} y2={cy + h * 0.2}
        stroke={fill} strokeWidth={w * 0.18} strokeLinecap="round" />
  }
}
