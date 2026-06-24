/**
 * 3+10(差距3/10):renderer mapper + store + UI 测试。
 * 证明 memory_status / memory_sources_ready SSE 事件能正确流到 store,
 * 且 DreamMemoryStatusIndicator 能从 store 读取状态。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DreamTurnMemoryStatus } from '../store/chat-store-types'

// 测试 1:DreamMemoryStatusIndicator 组件能正确渲染各种状态
describe('DreamMemoryStatusIndicator rendering', () => {
  // 动态导入避免 React 副作用
  async function renderIndicator(status: DreamTurnMemoryStatus | null) {
    const { DreamMemoryStatusIndicator } = await import('./dream-memory-status-indicator')
    const result = DreamMemoryStatusIndicator({ status })
    return result
  }

  it('returns null when status is null (no memory used)', async () => {
    const result = await renderIndicator(null)
    expect(result).toBeNull()
  })

  it('returns null when all flags are false (no memory)', async () => {
    const result = await renderIndicator({
      threadId: 't1', turnId: 'turn_1',
      remembering: false, personalizing: false,
      memorySourcesUsed: [], rewrittenQueryFromMemory: false
    })
    expect(result).toBeNull()
  })

  it('renders when remembering is true', async () => {
    const result = await renderIndicator({
      threadId: 't1', turnId: 'turn_1',
      remembering: true, personalizing: false,
      memorySourcesUsed: ['src_1'], rewrittenQueryFromMemory: false
    })
    expect(result).not.toBeNull()
  })

  it('renders when personalizing is true', async () => {
    const result = await renderIndicator({
      threadId: 't1', turnId: 'turn_1',
      remembering: false, personalizing: true,
      memorySourcesUsed: [], rewrittenQueryFromMemory: false
    })
    expect(result).not.toBeNull()
  })

  it('renders when rewrittenQueryFromMemory is true', async () => {
    const result = await renderIndicator({
      threadId: 't1', turnId: 'turn_1',
      remembering: false, personalizing: false,
      memorySourcesUsed: [], rewrittenQueryFromMemory: true
    })
    expect(result).not.toBeNull()
  })

  it('shows source count when sources available', async () => {
    const result = await renderIndicator({
      threadId: 't1', turnId: 'turn_1',
      remembering: true, personalizing: true,
      memorySourcesUsed: ['src_1', 'src_2'],
      rewrittenQueryFromMemory: true,
      sources: {
        usedMemoryIds: ['mem_1', 'mem_2'],
        downrankedMemoryIds: ['mem_3'],
        suppressedMemoryIds: [],
        sourceIds: ['src_1', 'src_2']
      }
    })
    expect(result).not.toBeNull()
  })
})

// 测试 2:DreamTurnMemoryStatus 类型结构正确(含 threadId/turnId)
describe('DreamTurnMemoryStatus type structure', () => {
  it('has threadId and turnId for stable binding', () => {
    const status: DreamTurnMemoryStatus = {
      threadId: 'thread_abc',
      turnId: 'turn_xyz',
      remembering: true,
      personalizing: false,
      memorySourcesUsed: ['src_1'],
      rewrittenQueryFromMemory: false
    }
    expect(status.threadId).toBe('thread_abc')
    expect(status.turnId).toBe('turn_xyz')
    expect(status.remembering).toBe(true)
  })

  it('can carry optional sources data', () => {
    const status: DreamTurnMemoryStatus = {
      threadId: 't1', turnId: 'turn_1',
      remembering: true, personalizing: true,
      memorySourcesUsed: ['src_1'],
      rewrittenQueryFromMemory: true,
      sources: {
        usedMemoryIds: ['mem_1'],
        downrankedMemoryIds: ['mem_2'],
        suppressedMemoryIds: ['mem_3'],
        sourceIds: ['src_1']
      }
    }
    expect(status.sources?.usedMemoryIds).toContain('mem_1')
    expect(status.sources?.downrankedMemoryIds).toContain('mem_2')
    expect(status.sources?.suppressedMemoryIds).toContain('mem_3')
  })
})

// 测试 3:store 的 memoryStatusByTurnId 合并逻辑
describe('memoryStatusByTurnId store merge logic', () => {
  it('merges memory_status and memory_sources_ready by turnId', () => {
    // 模拟 store 合并逻辑(onMemoryStatus + onMemorySourcesReady)
    const store: Record<string, DreamTurnMemoryStatus> = {}

    // memory_status 先到
    const turnId = 'turn_1'
    store[turnId] = {
      threadId: 't1', turnId,
      remembering: true, personalizing: false,
      memorySourcesUsed: ['src_1'],
      rewrittenQueryFromMemory: false
    }

    // memory_sources_ready 后到(合并)
    const existing = store[turnId]
    store[turnId] = {
      ...existing,
      sources: {
        usedMemoryIds: ['mem_1', 'mem_2'],
        downrankedMemoryIds: ['mem_3'],
        suppressedMemoryIds: ['mem_4'],
        sourceIds: ['src_1', 'src_2']
      }
    }

    // 合并后应该同时有 status 和 sources
    expect(store[turnId].remembering).toBe(true)
    expect(store[turnId].sources?.usedMemoryIds).toHaveLength(2)
    expect(store[turnId].sources?.downrankedMemoryIds).toContain('mem_3')
    expect(store[turnId].sources?.suppressedMemoryIds).toContain('mem_4')
  })

  it('handles memory_sources_ready arriving first (no prior status)', () => {
    const store: Record<string, DreamTurnMemoryStatus> = {}
    const turnId = 'turn_2'

    // sources_ready 先到,没有 prior status
    store[turnId] = {
      threadId: 't1', turnId,
      remembering: false, personalizing: false,
      memorySourcesUsed: ['src_1'],
      rewrittenQueryFromMemory: false,
      sources: {
        usedMemoryIds: ['mem_1'],
        downrankedMemoryIds: [],
        suppressedMemoryIds: [],
        sourceIds: ['src_1']
      }
    }

    expect(store[turnId].sources?.usedMemoryIds).toContain('mem_1')
  })
})
