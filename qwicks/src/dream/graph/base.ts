/**
 * Dream 记忆图谱 —— 1:1 对齐 Python `dream/graph/base.py` 的 InMemoryGraph。
 *
 * 决策:仅 in-memory 后端(桌面单用户不需要 Neo4j)。
 *
 * 边类型:related_to / derived_from / supersedes / contradicts / same_topic。
 * autoLink:扫所有节点,共享 token 的节点连 same_topic 边(对齐 Python auto_link)。
 */
export interface GraphNode {
  id: string
  label: string
  type?: string
  weight?: number
  attrs?: Record<string, unknown>
}

export interface GraphEdge {
  src: string
  dst: string
  relation: string
  weight?: number
  attrs?: Record<string, unknown>
}

export interface GraphSnapshot {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphBackend {
  name(): string
  upsertNode(node: GraphNode): void
  upsertEdge(edge: GraphEdge): void
  deleteNode(nodeId: string): void
  deleteEdge(src: string, dst: string, relation?: string): void
  neighbors(nodeId: string, maxHops?: number): GraphNode[]
  edgesOf(nodeId: string): GraphEdge[]
  related(nodeId: string, opts?: { relation?: string; limit?: number }): Array<[GraphNode, GraphEdge]>
  snapshot(): GraphSnapshot
  autoLink(): void
}

const SAME_TOPIC_MIN_OVERLAP = 2 // 共享 ≥2 token 才连 same_topic

export class InMemoryGraph implements GraphBackend {
  private readonly nodes = new Map<string, GraphNode>()
  /** src -> outgoing edges;dst 也建空槽以便 neighbors 双向遍历。 */
  private readonly adjacency = new Map<string, GraphEdge[]>()

  name(): string {
    return 'dream.in-memory-graph.v1'
  }

  upsertNode(node: GraphNode): void {
    this.nodes.set(node.id, { ...node })
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, [])
  }

  upsertEdge(edge: GraphEdge): void {
    if (!this.adjacency.has(edge.src)) this.adjacency.set(edge.src, [])
    if (!this.adjacency.has(edge.dst)) this.adjacency.set(edge.dst, [])
    this.adjacency.get(edge.src)!.push({ ...edge })
  }

  deleteNode(nodeId: string): void {
    this.nodes.delete(nodeId)
    this.adjacency.delete(nodeId)
    for (const [src, edges] of this.adjacency) {
      this.adjacency.set(
        src,
        edges.filter((e) => e.dst !== nodeId && e.src !== nodeId)
      )
    }
  }

  deleteEdge(src: string, dst: string, relation?: string): void {
    const edges = this.adjacency.get(src) ?? []
    this.adjacency.set(
      src,
      edges.filter((e) => {
        if (e.dst !== dst) return true
        if (relation && e.relation !== relation) return true
        if (!relation && e.relation !== '') return true
        return false
      })
    )
  }

  neighbors(nodeId: string, maxHops = 2): GraphNode[] {
    const seen = new Set<string>([nodeId])
    const frontier: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }]
    const out: GraphNode[] = []
    while (frontier.length > 0) {
      const cur = frontier.shift()!
      if (cur.depth >= maxHops) continue
      for (const edge of this.adjacency.get(cur.id) ?? []) {
        const other = edge.src === cur.id ? edge.dst : edge.src
        if (seen.has(other)) continue
        seen.add(other)
        const node = this.nodes.get(other)
        if (node) out.push(node)
        frontier.push({ id: other, depth: cur.depth + 1 })
      }
    }
    return out
  }

  edgesOf(nodeId: string): GraphEdge[] {
    return [...(this.adjacency.get(nodeId) ?? [])]
  }

  related(
    nodeId: string,
    opts: { relation?: string; limit?: number } = {}
  ): Array<[GraphNode, GraphEdge]> {
    const limit = opts.limit ?? 16
    const out: Array<[GraphNode, GraphEdge]> = []
    for (const edge of this.adjacency.get(nodeId) ?? []) {
      if (opts.relation && edge.relation !== opts.relation) continue
      const otherId = edge.src === nodeId ? edge.dst : edge.src
      const node = this.nodes.get(otherId)
      if (node) out.push([node, edge])
      if (out.length >= limit) break
    }
    return out
  }

  snapshot(): GraphSnapshot {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.adjacency.values()].flat()
    }
  }

  /**
   * 扫所有节点,共享 ≥SAME_TOPIC_MIN_OVERLAP token 的节点连 same_topic 边(对齐 auto_link)。
   * 简单 O(n²);桌面单用户规模可接受。避免自环和重复边。
   */
  autoLink(): void {
    const nodeTokens = new Map<string, Set<string>>()
    for (const [id, node] of this.nodes) {
      nodeTokens.set(id, graphTokens(node.label))
    }
    const existing = new Set<string>()
    for (const edges of this.adjacency.values()) {
      for (const e of edges) existing.add(`${e.src}|${e.dst}|${e.relation}`)
    }
    const ids = [...this.nodes.keys()]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!
        const b = ids[j]!
        const ta = nodeTokens.get(a)!
        const tb = nodeTokens.get(b)!
        let overlap = 0
        for (const t of ta) if (tb.has(t)) overlap += 1
        if (overlap >= SAME_TOPIC_MIN_OVERLAP) {
          const key = `${a}|${b}|same_topic`
          if (!existing.has(key)) {
            this.upsertEdge({ src: a, dst: b, relation: 'same_topic', weight: overlap })
            existing.add(key)
          }
        }
      }
    }
  }
}

function graphTokens(label: string): Set<string> {
  const out = new Set<string>()
  for (const w of label.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []) out.add(w)
  for (const run of label.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2))
  }
  return out
}
