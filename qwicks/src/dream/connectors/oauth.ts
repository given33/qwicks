/**
 * Dream 连接器 OAuth 基础设施 —— 1:1 对齐 Python `dream/connectors/oauth.py`。
 *
 * - OAuthToken:单账号 token(isExpired + toDict/fromDict)
 * - OAuthTokenStore:持久化到 oauth_tokens.jsonl(加密:sha256 派生 key + Fernet 风格;
 *   TS 端用 AES-256-GCM 或 base64 回退)
 * - TokenRefresher:接近 expires_at 时用 refresh_token 换新(注入 network,生产走真实 Google/MS token endpoint)
 * - PermissionRevocation:撤销 record(tombstone 传播用)
 *
 * 加密:TS 端用 Node crypto 的 createCipheriv(aes-256-gcm),密钥从 passphrase sha256 派生。
 * 无 DREAM_OAUTH_KEY 时用 base64 回退(对齐 Python 的降级)。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface OAuthTokenDict {
  access_token: string
  refresh_token: string
  expires_at: number
  scopes: string[]
  client_id: string
  client_secret: string
  account_email: string
  provider: string
  issued_at: number
}

export class OAuthToken {
  constructor(
    public accessToken: string,
    public refreshToken: string,
    /** unix timestamp (秒)。 */
    public expiresAt: number,
    public scopes: string[] = [],
    public clientId: string = '',
    public clientSecret: string = '',
    public accountEmail: string = '',
    public provider: string = 'google',
    public issuedAt: number = Math.floor(Date.now() / 1000)
  ) {}

  isExpired(opts: { skewSec?: number; now?: () => Date } = {}): boolean {
    const skew = opts.skewSec ?? 60
    const now = opts.now ? Math.floor(opts.now().getTime() / 1000) : Math.floor(Date.now() / 1000)
    return now >= this.expiresAt - skew
  }

  toDict(): OAuthTokenDict {
    return {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt,
      scopes: [...this.scopes],
      client_id: this.clientId,
      client_secret: this.clientSecret,
      account_email: this.accountEmail,
      provider: this.provider,
      issued_at: this.issuedAt
    }
  }

  static fromDict(d: Partial<OAuthTokenDict>): OAuthToken {
    return new OAuthToken(
      String(d.access_token ?? ''),
      String(d.refresh_token ?? ''),
      Number(d.expires_at ?? 0),
      Array.isArray(d.scopes) ? [...d.scopes] : [],
      String(d.client_id ?? ''),
      String(d.client_secret ?? ''),
      String(d.account_email ?? ''),
      String(d.provider ?? 'google'),
      Number(d.issued_at ?? Math.floor(Date.now() / 1000))
    )
  }
}

// ----------------------------------------------------------------
// 加密:aes-256-gcm(密钥从 passphrase sha256 派生);无 passphrase 时 base64 回退。
// ----------------------------------------------------------------

function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase, 'utf8').digest() // 32 bytes
}

function encrypt(plain: string, key: Buffer): string {
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    // 格式:GCM:<iv b64>:<tag b64>:<ct b64>
    return `GCM:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
  } catch {
    return 'B64:' + Buffer.from(plain, 'utf8').toString('base64')
  }
}

function decrypt(ciphered: string, key: Buffer): string {
  if (ciphered.startsWith('GCM:')) {
    try {
      const [, ivB64, tagB64, ctB64] = ciphered.split(':')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'))
      decipher.setAuthTag(Buffer.from(tagB64!, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(ctB64!, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      // fall through
    }
  }
  if (ciphered.startsWith('B64:')) {
    return Buffer.from(ciphered.slice(4), 'base64').toString('utf8')
  }
  return ciphered
}

// ----------------------------------------------------------------
// OAuthTokenStore
// ----------------------------------------------------------------

export interface OAuthTokenStoreOptions {
  persistDir: string
  /** 加密 passphrase;默认从 DREAM_OAUTH_KEY 环境变量读,无则 'dream-default-key'。 */
  passphrase?: string
}

export class OAuthTokenStore {
  private readonly path: string
  private readonly key: Buffer

  constructor(opts: OAuthTokenStoreOptions) {
    mkdirSync(opts.persistDir, { recursive: true })
    this.path = join(opts.persistDir, 'oauth_tokens.jsonl')
    const passphrase = opts.passphrase ?? process.env.DREAM_OAUTH_KEY ?? 'dream-default-key'
    this.key = deriveKey(passphrase)
  }

  save(account: string, token: OAuthToken): void {
    const line = {
      account,
      provider: token.provider,
      token_enc: encrypt(JSON.stringify(token.toDict()), this.key)
    }
    writeFileSync(this.path, JSON.stringify(line) + '\n', { flag: 'a', encoding: 'utf8' })
  }

  load(account: string): OAuthToken | null {
    if (!existsSync(this.path)) return null
    const lines = readFileSync(this.path, 'utf8').split(/\r?\n/).filter(Boolean)
    // 取最后一条匹配(最新)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const d = JSON.parse(lines[i]!) as { account?: string; token_enc?: string }
        if (d.account !== account) continue
        const raw = decrypt(String(d.token_enc), this.key)
        return OAuthToken.fromDict(JSON.parse(raw))
      } catch {
        continue
      }
    }
    return null
  }

  delete(account: string): boolean {
    if (!existsSync(this.path)) return false
    const lines = readFileSync(this.path, 'utf8').split(/\r?\n/).filter(Boolean)
    const kept: string[] = []
    let removed = false
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { account?: string }
        if (d.account === account) {
          removed = true
          continue
        }
      } catch {
        // 保留无法解析的行
      }
      kept.push(line)
    }
    writeFileSync(this.path, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8')
    return removed
  }

  listAccounts(): Array<{ account: string; provider: string }> {
    if (!existsSync(this.path)) return []
    const out: Array<{ account: string; provider: string }> = []
    for (const line of readFileSync(this.path, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const d = JSON.parse(line) as { account?: string; provider?: string }
        out.push({ account: String(d.account ?? ''), provider: String(d.provider ?? '') })
      } catch {
        continue
      }
    }
    return out
  }
}

// ----------------------------------------------------------------
// TokenRefresher
// ----------------------------------------------------------------

export interface RefreshNetwork {
  post(url: string, data: Record<string, string>): Promise<{
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>
}

export interface TokenRefresherOptions {
  network?: RefreshNetwork
}

export class TokenRefresher {
  static readonly GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
  static readonly MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

  constructor(private readonly opts: TokenRefresherOptions = {}) {}

  async refresh(token: OAuthToken): Promise<OAuthToken> {
    if (!token.refreshToken) throw new Error('no refresh_token to use')
    const url = token.provider === 'google' ? TokenRefresher.GOOGLE_TOKEN_URL : TokenRefresher.MS_TOKEN_URL
    const data = {
      client_id: token.clientId,
      client_secret: token.clientSecret,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token'
    }
    const resp = this.opts.network
      ? await this.opts.network.post(url, data)
      : this.mockRefresh(data)
    return new OAuthToken(
      resp.access_token ?? token.accessToken + '_refreshed',
      resp.refresh_token ?? token.refreshToken,
      Math.floor(Date.now() / 1000) + (resp.expires_in ?? 3600),
      typeof resp.scope === 'string' ? resp.scope.split(' ') : token.scopes,
      token.clientId,
      token.clientSecret,
      token.accountEmail,
      token.provider
    )
  }

  /** Mock HTTP refresh —— 不联网,返回合法结构(对齐 Python _mock_refresh)。 */
  private mockRefresh(data: Record<string, string>): {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
  } {
    return {
      access_token: `ya29.mock_refreshed_${Math.floor(Date.now() / 1000)}`,
      refresh_token: data.refresh_token!,
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly'
    }
  }
}

// ----------------------------------------------------------------
// PermissionRevocation
// ----------------------------------------------------------------

export class PermissionRevocation {
  revokedAt: number
  tombstoneIssued = false
  affectedCount = 0

  constructor(
    public account: string,
    public provider: string,
    public reason = 'user_request'
  ) {
    this.revokedAt = Math.floor(Date.now() / 1000)
  }
}
