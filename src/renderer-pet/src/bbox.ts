/**
 * 桌面宠物 —— 几何热区工具（M1）。
 *
 * 点击穿透机制：petWindow 默认全窗穿透到桌面，靠渲染层检测鼠标是否进入
 * 精灵 bbox 决定何时切回可交互。本文件提供热区判定纯函数，可单测。
 */

export type Point = { x: number; y: number }
export type BBox = { x: number; y: number; width: number; height: number }

/**
 * 判定点是否在 bbox 内（含外扩 padding 余量）。
 * 余量让边缘交互不断裂 —— 贴边拖拽时鼠标稍微越界仍算"在精灵上"。
 */
export function isPointInBbox(point: Point, bbox: BBox, padding = 0): boolean {
  return (
    point.x >= bbox.x - padding &&
    point.x <= bbox.x + bbox.width + padding &&
    point.y >= bbox.y - padding &&
    point.y <= bbox.y + bbox.height + padding
  )
}
