/**
 * 桌面宠物 —— 桌面窗口避让（M1-T10 桌面感知）。
 *
 * 宠物漫步时应避开桌面上其他可见窗口（尤其是用户正在操作的前台窗口），
 * 营造"它知道桌面上有什么"的感觉。主进程收集其他窗口的 bounds 推给渲染层，
 * 渲染层在选目标点 / 移动时绕开这些"障碍区"。
 *
 * 本文件提供障碍区的纯几何工具，可在 Vitest 里喂数据验证。
 */

export type Rect = { x: number; y: number; width: number; height: number }
export type Vec2 = { x: number; y: number }

/**
 * 判定点是否落在任一障碍区内（含 padding 缓冲）。
 * 用于漫步目标点合法性校验：目标点不能落在别的窗口上。
 */
export function isPointBlockedByAny(
  point: Vec2,
  obstacles: readonly Rect[],
  padding = 0
): boolean {
  return obstacles.some((rect) => isPointInRect(point, rect, padding))
}

export function isPointInRect(point: Vec2, rect: Rect, padding = 0): boolean {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  )
}

/**
 * 过滤掉尺寸过小或不在屏幕可见区的"障碍"（如隐藏的最小化窗口 bounds 退化）。
 * 主进程收集到的 window bounds 里可能含 width/height 为 0 的无效项。
 */
export function filterValidObstacles(obstacles: readonly Rect[]): Rect[] {
  return obstacles.filter((rect) => rect.width > 1 && rect.height > 1)
}
