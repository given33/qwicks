import { describe, expect, it } from 'vitest'
import { GmailConnector } from './gmail.js'
import { OAuthToken } from './oauth.js'
import type { MemoryItemDraft } from '../types.js'

function token(): OAuthToken {
  return new OAuthToken('access', 'refresh', Math.floor(Date.now() / 1000) + 3600, ['gmail.readonly'], 'cid', 'csec', 'alice@gmail.com', 'google')
}

describe('GmailConnector (doc §4.6 — emails as memory source)', () => {
  it('builds the correct Gmail API list request (URL + auth header)', async () => {
    let captured: { url: string; headers: Record<string, string> } | null = null
    const fetchImpl: typeof fetch = async (url, init?) => {
      captured = { url: String(url), headers: init?.headers as Record<string, string> }
      return new Response(JSON.stringify({ messages: [{ id: 'm1' }], resultSizeEstimate: 1 }), { status: 200 })
    }
    const gmail = new GmailConnector({ token: token(), fetchImpl })
    await gmail.list({ maxResults: 5 })
    expect(captured!.url).toContain('gmail/v1/users/me/messages')
    expect(captured!.url).toContain('maxResults=5')
    expect(captured!.headers.authorization).toBe('Bearer access')
  })

  it('fetches a message and parses it into structured content', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          id: 'm1',
          snippet: 'Your flight to Singapore is confirmed',
          payload: { headers: [{ name: 'From', value: 'airline@example.com' }, { name: 'Subject', value: 'Flight confirmation' }] }
        }),
        { status: 200 }
      )
    const gmail = new GmailConnector({ token: token(), fetchImpl })
    const msg = await gmail.fetch('m1')
    expect(msg.id).toBe('m1')
    expect(msg.from).toBe('airline@example.com')
    expect(msg.subject).toBe('Flight confirmation')
    expect(msg.snippet).toContain('Singapore')
  })

  it('extracts memory drafts from fetched emails with source lineage (connector)', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          id: 'm1',
          snippet: 'Your project deadline is next Friday',
          payload: { headers: [{ name: 'Subject', value: 'Deadline reminder' }] }
        }),
        { status: 200 }
      )
    const gmail = new GmailConnector({ token: token(), fetchImpl })
    const msg = await gmail.fetch('m1')
    const drafts = gmail.extractDrafts(msg, 'alice@gmail.com')
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts[0]!.provenance.source).toBe('connector')
    expect(drafts[0]!.metadata.connector).toBe('gmail')
    expect(drafts[0]!.metadata.source_message_id).toBe('m1')
  })

  it('returns empty drafts for irrelevant emails (no memory-worthy content)', async () => {
    const gmail = new GmailConnector({ token: token(), fetchImpl: async () => new Response(JSON.stringify({ id: 'm1', snippet: 'unsubscribe', payload: { headers: [] } }), { status: 200 }) })
    const msg = await gmail.fetch('m1')
    const drafts = gmail.extractDrafts(msg, 'alice@gmail.com')
    expect(drafts.length).toBe(0)
  })
})
