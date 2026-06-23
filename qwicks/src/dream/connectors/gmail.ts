/**
 * Gmail Connector —— 文档 §4.6(连接 Gmail,从邮件里抽取记忆 + source lineage)。
 *
 * 真实化(对齐 Python gmail.py 的 mock→real 意图):注入 fetch,调用 Gmail API v1。
 * - list:GET /gmail/v1/users/me/messages?maxResults=N
 * - fetch:GET /gmail/v1/users/me/messages/{id}(拿 snippet + headers)
 * - extractDrafts:把有记忆价值的邮件(旅行确认/项目细节/日程)转成 MemoryItemDraft,
 *   provenance.source='connector',metadata 带 connector='gmail' + source_message_id(lineage)。
 */
import { MemoryItemDraft, MemoryProvenance, MemoryType } from '../types.js'
import type { OAuthToken } from './oauth.js'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailMessage {
  id: string
  snippet: string
  from: string
  subject: string
  date?: string
}

export interface GmailConnectorOptions {
  token: OAuthToken
  fetchImpl?: typeof fetch
}

const MEMORY_WORTHY_PATTERNS = [
  /(?:flight|hotel|reservation|booking|确认|预订|机票|酒店)/i,
  /(?:deadline|due date|reminder|截止|提醒|到期)/i,
  /(?:project|milestone|kickoff|review|项目|里程碑)/i,
  /(?:invoice|receipt|order|发票|订单)/i,
  /(?:meeting|schedule|calendar|会议|日程)/i
]

export class GmailConnector {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: GmailConnectorOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async list(opts: { maxResults?: number; query?: string } = {}): Promise<Array<{ id: string; threadId?: string }>> {
    const url = new URL(`${GMAIL_API}/messages`)
    url.searchParams.set('maxResults', String(opts.maxResults ?? 10))
    if (opts.query) url.searchParams.set('q', opts.query)
    const res = await this.fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${this.opts.token.accessToken}` }
    })
    if (!res.ok) throw new Error(`gmail list HTTP ${res.status}`)
    const json = (await res.json()) as { messages?: Array<{ id: string; threadId?: string }> }
    return json.messages ?? []
  }

  async fetch(messageId: string): Promise<GmailMessage> {
    const res = await this.fetchImpl(`${GMAIL_API}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { authorization: `Bearer ${this.opts.token.accessToken}` }
    })
    if (!res.ok) throw new Error(`gmail fetch HTTP ${res.status}`)
    const json = (await res.json()) as {
      id: string
      snippet: string
      payload?: { headers?: Array<{ name: string; value: string }> }
    }
    const headers = json.payload?.headers ?? []
    const get = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
    return {
      id: json.id,
      snippet: json.snippet ?? '',
      from: get('from'),
      subject: get('subject'),
      date: get('date') || undefined
    }
  }

  /** 把有记忆价值的邮件转成 MemoryItemDraft(带 connector source lineage)。 */
  extractDrafts(msg: GmailMessage, account: string): MemoryItemDraft[] {
    const text = `${msg.subject} ${msg.snippet}`
    const isWorthy = MEMORY_WORTHY_PATTERNS.some((p) => p.test(text))
    if (!isWorthy) return []

    let type = MemoryType.FACT
    if (/(?:flight|hotel|reservation|booking|确认|预订|机票|酒店)/i.test(text)) type = MemoryType.EPISODE
    else if (/(?:deadline|due|reminder|截止|提醒|到期)/i.test(text)) type = MemoryType.GOAL
    else if (/(?:project|milestone|kickoff|项目|里程碑)/i.test(text)) type = MemoryType.PROJECT

    return [
      new MemoryItemDraft(
        type,
        text.slice(0, 240),
        [],
        0.5,
        0.6,
        undefined,
        new MemoryProvenance('connector', null, null, null, 0.6, 'gmail'),
        {
          connector: 'gmail',
          source_message_id: msg.id,
          source_account: account,
          source_from: msg.from,
          source_subject: msg.subject
        }
      )
    ]
  }
}
