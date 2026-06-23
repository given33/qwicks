import { describe, expect, it } from 'vitest'
import { DriveConnector } from './drive.js'
import { OAuthToken } from './oauth.js'

function token(): OAuthToken {
  return new OAuthToken('access', 'refresh', Math.floor(Date.now() / 1000) + 3600, ['drive.readonly'], 'cid', 'csec', 'alice@gmail.com', 'google')
}

describe('DriveConnector (doc §4.5/§6.6 — files as memory source)', () => {
  it('lists files with correct Drive API request', async () => {
    let capturedUrl = ''
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: 'Project Plan.md', mimeType: 'text/markdown' }] }), { status: 200 })
    }
    const drive = new DriveConnector({ token: token(), fetchImpl })
    const files = await drive.list({ maxResults: 5 })
    expect(capturedUrl).toContain('drive/v3/files')
    expect(capturedUrl).toContain('pageSize=5')
    expect(files[0]!.name).toBe('Project Plan.md')
  })

  it('fetches file content (export text)', async () => {
    const fetchImpl: typeof fetch = async () => new Response('The project deadline is Q3. Tech stack: Rust + Tauri.', { status: 200 })
    const drive = new DriveConnector({ token: token(), fetchImpl })
    const content = await drive.fetchContent({ id: 'f1', name: 'plan.md', mimeType: 'text/markdown' })
    expect(content).toContain('deadline is Q3')
  })

  it('extracts memory drafts from file content with source lineage', () => {
    const drive = new DriveConnector({ token: token(), fetchImpl: async () => new Response('') })
    const drafts = drive.extractDrafts({
      fileId: 'f1',
      fileName: 'Project Plan.md',
      content: 'The project deadline is Q3. We use Rust and Tauri for the desktop app.'
    }, 'alice@gmail.com')
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts[0]!.provenance.source).toBe('connector')
    expect(drafts[0]!.metadata.connector).toBe('drive')
    expect(drafts[0]!.metadata.source_file_id).toBe('f1')
  })

  it('returns empty drafts for low-signal file content', () => {
    const drive = new DriveConnector({ token: token(), fetchImpl: async () => new Response('') })
    const drafts = drive.extractDrafts({ fileId: 'f1', fileName: 'notes.md', content: 'grocery list: milk, eggs' }, 'alice@gmail.com')
    expect(drafts.length).toBe(0)
  })
})
