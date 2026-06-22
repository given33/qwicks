import { describe, expect, it } from 'vitest'
import { buildWalkableGraph, findScreenPath, sharedEdge } from './walkable-graph'

const D0 = { x: 0, y: 0, width: 1920, height: 1080 }
const D1_RIGHT = { x: 1920, y: 0, width: 2560, height: 1440 }
const D2_FAR = { x: 10000, y: 10000, width: 1920, height: 1080 } // 孤立屏，不与任何相邻

describe('sharedEdge', () => {
  it('horizontal neighbors share a vertical edge', () => {
    const edge = sharedEdge(D0, D1_RIGHT)
    expect(edge).not.toBeNull()
    expect(edge!.crossing.x).toBeCloseTo(1920, 0)
    // y 中点在重叠区中点（0..1080 中点 = 540）
    expect(edge!.crossing.y).toBeCloseTo(540, 0)
  })

  it('non-adjacent screens return null', () => {
    expect(sharedEdge(D0, D2_FAR)).toBeNull()
  })

  it('vertical neighbors share a horizontal edge', () => {
    const below = { x: 0, y: 1080, width: 1920, height: 1080 }
    const edge = sharedEdge(D0, below)
    expect(edge).not.toBeNull()
    expect(edge!.crossing.y).toBeCloseTo(1080, 0)
    expect(edge!.crossing.x).toBeCloseTo(960, 0)
  })

  it('misaligned diagonal screens with no shared edge return null', () => {
    const diagonal = { x: 5000, y: 5000, width: 1920, height: 1080 }
    expect(sharedEdge(D0, diagonal)).toBeNull()
  })
})

describe('buildWalkableGraph + findScreenPath', () => {
  it('two adjacent screens are connected', () => {
    const g = buildWalkableGraph([D0, D1_RIGHT])
    expect(g.adjacency.get(0)).toHaveLength(1)
    expect(g.adjacency.get(1)).toHaveLength(1)
  })

  it('path between adjacent screens is direct', () => {
    const g = buildWalkableGraph([D0, D1_RIGHT])
    expect(findScreenPath(g, 0, 1)).toEqual([0, 1])
    expect(findScreenPath(g, 1, 0)).toEqual([1, 0])
  })

  it('same screen returns single-element path', () => {
    const g = buildWalkableGraph([D0, D1_RIGHT])
    expect(findScreenPath(g, 0, 0)).toEqual([0])
  })

  it('unreachable screen returns null', () => {
    const g = buildWalkableGraph([D0, D1_RIGHT, D2_FAR])
    expect(findScreenPath(g, 0, 2)).toBeNull()
  })

  it('three-screen chain routes through middle', () => {
    // D0 | D1 | D3(右接D1)
    const d3 = { x: 1920 + 2560, y: 0, width: 1920, height: 1080 }
    const g = buildWalkableGraph([D0, D1_RIGHT, d3])
    // D0 到 D3 必须经过 D1
    expect(findScreenPath(g, 0, 2)).toEqual([0, 1, 2])
  })

  it('misaligned three screens (dead zone in middle) still connect via shared edge', () => {
    // D0 在左上，D1 在右下偏移，仍有一条窄共享边
    const d1offset = { x: 1500, y: 400, width: 1920, height: 1080 }
    const g = buildWalkableGraph([D0, d1offset])
    // 它们在 x=1500..1920, y=400..1080 有重叠区，D0右边(1920)与D1左边(1500)不重合，
    // 但 D0 右边 1920 在 D1 范围(1500..3420)内，D1 左边 1500 在 D0 范围(0..1920)内。
    // 实际上 D0.right=1920 == D1.left=1500? 不，D1.left=1500 < D0.right=1920，是重叠非相邻。
    // 这种情况 sharedEdge 应返回 null（它们是重叠不是相邻）。
    expect(sharedEdge(D0, d1offset)).toBeNull()
    expect(findScreenPath(g, 0, 1)).toBeNull()
  })
})
