/**
 * 桌面宠物 —— 虚拟桌面几何工具（M1）。
 *
 * petWindow 是一个覆盖"所有显示器并集"的透明置顶窗口，宠物在这个连续的
 * 逻辑像素坐标空间里无缝游走。本文件提供计算并集、判定点是否落在真实屏内、
 * 求当前屏等纯函数 —— 全部无副作用，可在 Vitest 里直接喂数据验证。
 *
 * 坐标系约定：Electron 的 `screen.Display.bounds` 用逻辑像素，x/y 可为负
 * （副屏在主屏左/上方时）。并集矩形的 x/y 取所有屏的最小值，因此也可能为负。
 * petWindow 用 `setBounds(union)` 铺满，宠物坐标减去并集原点即窗口内坐标。
 */

export type DisplayBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type VirtualDesktopBounds = DisplayBounds & {
  /** 并集左上角在屏幕坐标系的位置（可能为负） */
  originX: number
  originY: number
}

/**
 * 计算所有显示器 bounds 的并集矩形。无显示器时返回 1x1 兜底（不应发生，
 * 但避免除零）。多屏错位排列（如副屏在主屏右下方）也能正确取到外接矩形。
 */
export function computeVirtualDesktopBounds(displays: readonly DisplayBounds[]): VirtualDesktopBounds {
  if (displays.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1, originX: 0, originY: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const display of displays) {
    if (display.x < minX) minX = display.x
    if (display.y < minY) minY = display.y
    const right = display.x + display.width
    if (right > maxX) maxX = right
    const bottom = display.y + display.height
    if (bottom > maxY) maxY = bottom
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    originX: minX,
    originY: minY
  }
}

/**
 * 判定一个屏幕坐标点是否落在任意一块真实显示器内。
 * 用于漫步寻路时排除"死区"（屏幕之间没有显示器的空白坐标）。
 */
export function isPointOnAnyDisplay(point: { x: number; y: number }, displays: readonly DisplayBounds[]): boolean {
  return displays.some((display) => isPointInBounds(point, display))
}

export function isPointInBounds(point: { x: number; y: number }, bounds: DisplayBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

/**
 * 找出某屏幕坐标点所在的显示器。用于跨屏游走时确定宠物当前在哪块屏，
 * 以便应用该屏的 DPI / work area 约束。点不在任何屏上时返回 null。
 */
export function findDisplayAtPoint(
  point: { x: number; y: number },
  displays: readonly DisplayBounds[]
): DisplayBounds | null {
  return displays.find((display) => isPointInBounds(point, display)) ?? null
}

/**
 * 把一个屏幕坐标转换为 petWindow 内的窗口坐标（用于渲染层定位精灵）。
 * 窗口坐标始终从 (0,0) 开始，因此 = 屏幕坐标 - 并集原点。
 */
export function screenToWindowCoordinate(
  point: { x: number; y: number },
  union: VirtualDesktopBounds
): { x: number; y: number } {
  return { x: point.x - union.originX, y: point.y - union.originY }
}

/**
 * 把 petWindow 内的窗口坐标还原为屏幕坐标。持久化的宠物位置用屏幕坐标
 * （显示器变化时语义稳定），渲染时才转窗口坐标。
 */
export function windowToScreenCoordinate(
  point: { x: number; y: number },
  union: VirtualDesktopBounds
): { x: number; y: number } {
  return { x: point.x + union.originX, y: point.y + union.originY }
}
