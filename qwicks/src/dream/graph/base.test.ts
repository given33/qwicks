import { describe, expect, it } from 'vitest'
import { InMemoryGraph } from './base.js'

describe('InMemoryGraph', () => {
  it('upserts nodes and edges, reports name', () => {
    const g = new InMemoryGraph()
    expect(g.name()).toBe('dream.in-memory-graph.v1')
    g.upsertNode({ id: 'a', label: 'A', type: 'memory', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'b', relation: 'related_to', weight: 1, attrs: {} })
    expect(g.edgesOf('a')).toHaveLength(1)
  })

  it('neighbors traverses up to maxHops (BFS)', () => {
    const g = new InMemoryGraph()
    g.upsertNode({ id: 'a', label: 'A', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'b', label: 'B', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'c', label: 'C', type: 'memory', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'b', relation: 'related_to', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'b', dst: 'c', relation: 'related_to', weight: 1, attrs: {} })
    // 1 hop → only b
    expect(g.neighbors('a', 1).map((n) => n.id)).toEqual(['b'])
    // 2 hops → b and c
    expect(g.neighbors('a', 2).map((n) => n.id).sort()).toEqual(['b', 'c'])
  })

  it('related filters by relation and respects limit', () => {
    const g = new InMemoryGraph()
    g.upsertNode({ id: 'a', label: 'A', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'b', label: 'B', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'c', label: 'C', type: 'memory', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'b', relation: 'related_to', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'c', relation: 'supersedes', weight: 1, attrs: {} })
    const onlySupersedes = g.related('a', { relation: 'supersedes' })
    expect(onlySupersedes.map(([n]) => n.id)).toEqual(['c'])
    const limited = g.related('a', { limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it('deleteNode removes the node and its incident edges', () => {
    const g = new InMemoryGraph()
    g.upsertNode({ id: 'a', label: 'A', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'b', label: 'B', type: 'memory', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'b', relation: 'related_to', weight: 1, attrs: {} })
    g.deleteNode('b')
    expect(g.related('a')).toEqual([])
  })

  it('snapshot serializes nodes + edges round-trip', () => {
    const g = new InMemoryGraph()
    g.upsertNode({ id: 'a', label: 'A', type: 'memory', weight: 1, attrs: {} })
    g.upsertEdge({ src: 'a', dst: 'b', relation: 'related_to', weight: 1, attrs: {} })
    const snap = g.snapshot()
    expect(snap.nodes).toHaveLength(1)
    expect(snap.edges).toHaveLength(1)
    expect(snap.edges[0]!.relation).toBe('related_to')
  })

  it('autoLink connects memories sharing tokens (same_topic / related_to)', () => {
    const g = new InMemoryGraph()
    g.upsertNode({ id: 'a', label: 'postgres replication guide', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'b', label: 'postgres replication tuning', type: 'memory', weight: 1, attrs: {} })
    g.upsertNode({ id: 'c', label: 'redis cache config', type: 'memory', weight: 1, attrs: {} })
    g.autoLink()
    // a and b share "postgres" / "replication"; c shares nothing with them
    const relatedA = g.related('a').map(([n]) => n.id)
    expect(relatedA).toContain('b')
    expect(relatedA).not.toContain('c')
  })
})
