/**
 * Drive Connector —— 文档 §4.5/§6.6(Plus/Pro 可用文件库里的文件作 memory source)。
 *
 * 真实化:注入 fetch,调用 Drive API v3。
 * - list:GET /drive/v3/files?pageSize=N&q=...(文本类文件)
 * - fetchContent:GET /drive/v3/files/{id}/export?mimeType=text/plain(或 media)
 * - extractDrafts:把文件里的事实/项目/技术栈转成 MemoryItemDraft,lineage connector='drive'。
 */
import { MemoryItemDraft, MemoryProvenance, MemoryType } from '../types.js'
import type { OAuthToken } from './oauth.js'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
}

export interface DriveConnectorOptions {
  token: OAuthToken
  fetchImpl?: typeof fetch
}

const MEMORY_WORTHY_PATTERNS = [
  /(?:deadline|milestone|roadmap|target|截止|里程碑|路线图)/i,
  /(?:project|architecture|tech stack|技术栈|架构|项目)/i,
  /(?:team|role|responsibility|团队|职责)/i,
  /(?:goal|objective|目标)/i,
  /(?:preference|constraint|偏好|约束|要求)/i
]

export class DriveConnector {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: DriveConnectorOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async list(opts: { maxResults?: number; query?: string } = {}): Promise<DriveFile[]> {
    const url = new URL(`${DRIVE_API}/files`)
    url.searchParams.set('pageSize', String(opts.maxResults ?? 10))
    url.searchParams.set('fields', 'files(id,name,mimeType)')
    // 默认只看文本文档(避免拉图片/视频)
    const q = opts.query ?? "mimeType contains 'text' or mimeType contains 'document' or mimeType contains 'markdown'"
    url.searchParams.set('q', q)
    const res = await this.fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${this.opts.token.accessToken}` }
    })
    if (!res.ok) throw new Error(`drive list HTTP ${res.status}`)
    const json = (await res.json()) as { files?: DriveFile[] }
    return json.files ?? []
  }

  async fetchContent(file: DriveFile): Promise<string> {
    const url = `${DRIVE_API}/files/${file.id}/export?mimeType=${encodeURIComponent('text/plain')}`
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.opts.token.accessToken}` }
    })
    if (!res.ok) throw new Error(`drive fetchContent HTTP ${res.status}`)
    return res.text()
  }

  /** 把文件内容里有记忆价值的段落转成 MemoryItemDraft(带 connector lineage)。 */
  extractDrafts(input: { fileId: string; fileName: string; content: string }, account: string): MemoryItemDraft[] {
    const drafts: MemoryItemDraft[] = []
    // 按句子/行切分,每段独立评估
    const segments = input.content.split(/[。\n.!?！？]/).map((s) => s.trim()).filter((s) => s.length >= 8 && s.length <= 300)
    for (const seg of segments) {
      if (!MEMORY_WORTHY_PATTERNS.some((p) => p.test(seg))) continue
      let type = MemoryType.FACT
      if (/(?:deadline|milestone|target|截止|里程碑)/i.test(seg)) type = MemoryType.GOAL
      else if (/(?:project|architecture|tech stack|技术栈|架构|项目)/i.test(seg)) type = MemoryType.PROJECT
      else if (/(?:preference|constraint|偏好|约束|要求)/i.test(seg)) type = MemoryType.PREFERENCE
      drafts.push(
        new MemoryItemDraft(
          type,
          seg.slice(0, 240),
          [],
          0.5,
          0.55,
          undefined,
          new MemoryProvenance('connector', null, null, null, 0.55, 'drive'),
          {
            connector: 'drive',
            source_file_id: input.fileId,
            source_file_name: input.fileName,
            source_account: account
          }
        )
      )
      if (drafts.length >= 10) break
    }
    return drafts
  }
}
