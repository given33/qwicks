import { describe, expect, it } from 'vitest'
import { synthesizePreviewPatch } from './synthesize-preview-patch'

describe('synthesizePreviewPatch', () => {
  it('produces a unified diff header + hunk for a changed line', () => {
    const patch = synthesizePreviewPatch('src/foo.ts', 'line a\nline b\nline c', 'line a\nline B\nline c')
    expect(patch).toContain('--- a/src/foo.ts')
    expect(patch).toContain('+++ b/src/foo.ts')
    expect(patch).toContain('@@')
    expect(patch).toContain('-line b')
    expect(patch).toContain('+line B')
    expect(patch).toContain(' line a')
    expect(patch).toContain(' line c')
  })

  it('returns empty string when old and new are identical', () => {
    expect(synthesizePreviewPatch('x.ts', 'same\ncontent', 'same\ncontent')).toBe('')
  })

  it('handles pure insertion (new lines added)', () => {
    const patch = synthesizePreviewPatch('new.ts', 'a', 'a\nb\nc')
    expect(patch).toContain('+b')
    expect(patch).toContain('+c')
  })

  it('handles pure deletion (lines removed)', () => {
    const patch = synthesizePreviewPatch('del.ts', 'a\nb\nc', 'a')
    expect(patch).toContain('-b')
    expect(patch).toContain('-c')
  })

  it('includes 3 lines of context around changes', () => {
    const oldText = '1\n2\n3\n4\n5\n6\n7'
    const newText = '1\n2\n3\nCHANGED\n5\n6\n7'
    const patch = synthesizePreviewPatch('ctx.ts', oldText, newText)
    // context lines around the change at line 4
    expect(patch).toContain(' 1')
    expect(patch).toContain(' 7')
  })

  it('produces parseable unified diff (DiffView can consume)', () => {
    const patch = synthesizePreviewPatch('app.tsx', 'export const x = 1', 'export const x = 2')
    // must have the @@ hunk header and +/- lines
    expect(patch.match(/^@@/m)).not.toBeNull()
    expect(patch.includes('-export const x = 1')).toBe(true)
    expect(patch.includes('+export const x = 2')).toBe(true)
  })

  it('handles empty old text (pure new file)', () => {
    const patch = synthesizePreviewPatch('newfile.ts', '', 'hello\nworld')
    expect(patch).toContain('+hello')
    expect(patch).toContain('+world')
  })
})
