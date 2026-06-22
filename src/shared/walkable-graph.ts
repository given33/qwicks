/**
 * 桌面宠物 —— 无缝跨屏可行走图（M3-T2，R8 阻断级）。
 *
 * 多显示器常错位排列，且屏之间可能有"死区"（无显示器的空白坐标）。
 * 宠物无缝跨屏需要：知道哪些屏相邻、能在屏之间规划只走真实屏坐标的路径。
 *
 * 本模块纯函数：
 *   - buildWalkableGraph(displays)：建邻接图（共享边的屏相连）
 *   - findScreenPath(graph, fromId, toId)：BFS 最短屏序列
 *   - sharedEdge(a, b)：两屏的共享边交叉点（穿越点）
 * 全部可在 Vitest 喂数据验证，覆盖错位/死区/不相邻中转场景。
 */

import type { DisplayBounds } from './pet-display'

export type ScreenId = number // 用 displays 数组下标作 id

export type ScreenEdge = {
  /** 共享边的穿越点（两屏 bounds 交集的中点，屏幕坐标） */
  crossing: { x: number; y: number }
}

export type WalkableGraph = {
  /** 邻接表：screenId → [{ to, edge }] */
  adjacency: Map<ScreenId, { to: ScreenId; edge: ScreenEdge }[]>
  screens: DisplayBounds[]
}

const ADJACENCY_TOLERANCE = 1 // 共享边判定容差（px）

/**
 * 判定两屏是否共享一条边，返回共享边的穿越点（中点），不共享返回 null。
 * 水平相邻：A 的右边 ≈ B 的左边，且 y 区间有交集。
 * 垂直相邻：A 的下边 ≈ B 的上边，且 x 区间有交集。
 */
export function sharedEdge(a: DisplayBounds, b: DisplayBounds): ScreenEdge | null {
  // 水平相邻：a 在左，b 在右
  const aRight = a.x + a.width
  const bLeft = b.x
  if (Math.abs(aRight - bLeft) <= ADJACENCY_TOLERANCE) {
    const yOverlap = overlapRange(a.y, a.y + a.height, b.y, b.y + b.height)
    if (yOverlap) {
      return { crossing: { x: (aRight + bLeft) / 2, y: (yOverlap[0] + yOverlap[1]) / 2 } }
    }
  }
  // 水平相邻：b 在左，a 在右
  const bRight = b.x + b.width
  const aLeft = a.x
  if (Math.abs(bRight - aLeft) <= ADJACENCY_TOLERANCE) {
    const yOverlap = overlapRange(a.y, a.y + a.height, b.y, b.y + b.height)
    if (yOverlap) {
      return { crossing: { x: (bRight + aLeft) / 2, y: (yOverlap[0] + yOverlap[1]) / 2 } }
    }
  }
  // 垂直相邻：a 在上，b 在下
  const aBottom = a.y + a.height
  const bTop = b.y
  if (Math.abs(aBottom - bTop) <= ADJACENCY_TOLERANCE) {
    const xOverlap = overlapRange(a.x, a.x + a.width, b.x, b.x + b.width)
    if (xOverlap) {
      return { crossing: { x: (xOverlap[0] + xOverlap[1]) / 2, y: (aBottom + bTop) / 2 } }
    }
  }
  // 垂直相邻：b 在上，a 在下
  const bBottom = b.y + b.height
  const aTop = a.y
  if (Math.abs(bBottom - aTop) <= ADJACENCY_TOLERANCE) {
    const xOverlap = overlapRange(a.x, a.x + a.width, b.x, b.x + b.width)
    if (xOverlap) {
      return { crossing: { x: (xOverlap[0] + xOverlap[1]) / 2, y: (bBottom + aTop) / 2 } }
    }
  }
  return null
}

function overlapRange(a1: number, a2: number, b1: number, b2: number): [number, number] | null {
  const start = Math.max(a1, b1)
  const end = Math.min(a2, b2)
  return end > start ? [start, end] : null
}

/** 建可行走图：每对共享边的屏连一条边。 */
export function buildWalkableGraph(displays: readonly DisplayBounds[]): WalkableGraph {
  const adjacency = new Map<ScreenId, { to: ScreenId; edge: ScreenEdge }[]>()
  for (let i = 0; i < displays.length; i += 1) adjacency.set(i, [])
  for (let i = 0; i < displays.length; i += 1) {
    for (let j = i + 1; j < displays.length; j += 1) {
      const edge = sharedEdge(displays[i], displays[j])
      if (edge) {
        adjacency.get(i)!.push({ to: j, edge })
        adjacency.get(j)!.push({ to: i, edge })
      }
    }
  }
  return { adjacency, screens: [...displays] }
}

/** BFS 找从 from 到 to 的最短屏序列。不可达返回 null。同屏返回 [from]。 */
export function findScreenPath(graph: WalkableGraph, from: ScreenId, to: ScreenId): ScreenId[] | null {
  if (from === to) return [from]
  if (!graph.adjacency.has(from) || !graph.adjacency.has(to)) return null
  const queue: ScreenId[] = [from]
  const prev = new Map<ScreenId, ScreenId | null>([[from, null]])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const { to: neighbor } of graph.adjacency.get(current) ?? []) {
      if (prev.has(neighbor)) continue
      prev.set(neighbor, current)
      if (neighbor === to) {
        // 重建路径
        const path: ScreenId[] = [to]
        let node: ScreenId | null = to
        while (node !== null) {
          const p = prev.get(node) ?? null
          if (p === null) break
          path.unshift(p)
          node = p
        }
        return path
      }
      queue.push(neighbor)
    }
  }
  return null
}
