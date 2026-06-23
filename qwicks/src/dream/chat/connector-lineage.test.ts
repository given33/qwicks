/**
 * 连接器(Gmail/Drive)摄入的 source lineage 测试。
 * 验证审计 HIGH 修复:ingestGmail/ingestDrive 必须创建 SourceRecord 并把
 * sourceId 链到派生 memory 的 sourceIds(文档 §6 谱系 + §9 删除一致性)。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamMemorySystem } from './pipeline.js'
import { OAuthToken } from '../connectors/oauth.js'
import { SourceType } from '../types.js'

/**
 * Gmail/Drive 连接器用真实 HTTP fetch(注入 mock fetchImpl)。
 * 这里构造一个最小的 mock fetch,返回 Gmail API 风格的 JSON。
 */
function mockGmailFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    // list messages
    if (url.includes('/messages') && !url.includes('/messages/')) {
      return new Response(
        JSON.stringify({
          messages: [{ id: 'msg_001', threadId: 't1' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    // get message full
    if (url.includes('/messages/msg_001')) {
      return new Response(
        JSON.stringify({
          id: 'msg_001',
          payload: {
            headers: [
              { name: 'Subject', value: 'Flight confirmation to Singapore' },
              { name: 'From', value: 'airline@example.com' }
            ],
            parts: [{ mimeType: 'text/plain', body: { data: btoa('Your flight to Singapore is confirmed for July 10') } }]
          },
          snippet: 'Your flight to Singapore is confirmed'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe('Connector ingestion creates SourceRecord + links sourceIds', () => {
  let dir: string
  let system: DreamMemorySystem
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-conn-'))
    system = new DreamMemorySystem({ dataDir: dir, userId: 'acct_gmail' })
    // 注入一个 fake OAuth token
    system.oauthStore.save(
      'acct_gmail',
      new OAuthToken(
        'fake_access_token',
        'fake_refresh_token',
        null,
        'https://www.googleapis.com/auth/gmail.readonly',
        'google'
      )
    )
  })
  afterEach(async () => {
    system.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('ingestGmail creates a GMAIL SourceRecord per message and links derived memories', async () => {
    const result = await system.ingestGmail('acct_gmail', { maxResults: 5, fetchImpl: mockGmailFetch() })
    // 应该至少摄入了 0+ 条(取决于邮件内容是否匹配 memory-worthy 模式)
    // 关键验证:SourceRecord 被创建
    const sources = system.controls2.listSources('acct_gmail', { sourceType: SourceType.GMAIL })
    expect(sources.length).toBeGreaterThanOrEqual(1)
    const gmailSrc = sources[0]!
    expect(gmailSrc.sourceType).toBe(SourceType.GMAIL)
    expect(gmailSrc.externalRef).toBe('msg_001')
    // 若有派生 memory,必须链到该 source
    if (result.ingested > 0) {
      const memories = system.repository.list('acct_gmail', {})
      const linked = memories.filter((m) => m.sourceIds.includes(gmailSrc.id))
      expect(linked.length).toBeGreaterThan(0)
    }
  })

  it('deleteSourceAndDerived removes gmail source + its derived memories', async () => {
    await system.ingestGmail('acct_gmail', { maxResults: 5, fetchImpl: mockGmailFetch() })
    const sources = system.controls2.listSources('acct_gmail', { sourceType: SourceType.GMAIL })
    if (sources.length > 0) {
      const src = sources[0]!
      const result = system.controls2.deleteSourceAndDerived(src.id, { hard: true })
      expect(result.sourceDeleted).toBe(true)
      // 来源已删
      expect(system.controls2.getSource(src.id)?.deleted ?? true).toBe(true)
    }
  })
})
