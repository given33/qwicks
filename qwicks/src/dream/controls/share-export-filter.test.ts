/**
 * Batch C (spec §3): share/export 双管道脱敏。
 * share(给别人)= 全剥离来源归因;export(给自己)= 全保真。
 * 规则 sourceType 驱动 + item.shareable override + sensitivityCategories override(接 Batch B)。
 */
import { describe, expect, it } from 'vitest'
import { SourceType } from '../types.js'
import { applyShareFilter, applyExportFilter } from './share-export-filter.js'
import type { ShareThread, ShareSourceAttribution, ExportPayload } from './share-export-filter.js'

function src(id: string, sourceType: string, opts: Partial<ShareSourceAttribution> = {}): ShareSourceAttribution {
  return {
    sourceId: id,
    sourceType: sourceType as SourceType,
    sourceText: `text-${id}`,
    rawTitle: opts.rawTitle ?? `title-${id}`,
    rawSnippet: opts.rawSnippet ?? `snippet-${id}`,
    itemId: opts.itemId ?? `item-${id}`,
    itemContent: opts.itemContent ?? `content-${id}`,
    itemShareable: opts.itemShareable ?? true,
    itemSensitivityCategories: opts.itemSensitivityCategories ?? [],
    hiddenWhenShared: opts.hiddenWhenShared ?? false
  }
}

function thread(attributions: ShareSourceAttribution[]): ShareThread {
  return { assistantText: 'the answer', sourceAttributions: attributions }
}

describe('applyShareFilter', () => {
  it('default private mode strips ALL source attribution', () => {
    const out = applyShareFilter(thread([src('s1', 'chat'), src('s2', 'gmail')]), 'private')
    expect(out.sourceAttributions).toEqual([])
    expect(out.assistantText).toBe('the answer')
  })

  it('gmail/drive/file sources NEVER appear, even in show-chat mode', () => {
    const out = applyShareFilter(
      thread([
        src('g', 'gmail'),
        src('d', 'drive'),
        src('f', 'file')
      ]),
      'show-chat'
    )
    expect(out.sourceAttributions).toEqual([])
  })

  it('chat/saved/custom sources appear only in show-chat mode', () => {
    const out = applyShareFilter(thread([src('c', 'chat'), src('sv', 'saved'), src('cu', 'custom')]), 'show-chat')
    // raw sourceId is scrubbed (it's the sensitive payload); assert on type instead.
    expect(out.sourceAttributions.map((a) => String(a.sourceType))).toEqual(['chat', 'saved', 'custom'])
  })

  it('item.shareable===false overrides: source attribution never appears', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { itemShareable: false })]), 'show-chat')
    expect(out.sourceAttributions).toEqual([])
  })

  it('sensitivityCategories ∩ {financial,health,identity} overrides (Batch B)', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { itemSensitivityCategories: ['health'] })]), 'show-chat')
    expect(out.sourceAttributions).toEqual([])
  })

  it('strips rawTitle / rawSnippet (the sensitive source payload), keeps the kept attribution', () => {
    const out = applyShareFilter(thread([src('c', 'chat', { rawTitle: 'Board meeting Q3 confidential' })]), 'show-chat')
    expect(out.sourceAttributions).toHaveLength(1)
    expect(out.sourceAttributions[0].rawTitle).toBeNull()
    expect(out.sourceAttributions[0].rawSnippet).toBeNull()
  })

  it('property: for ANY thread, private mode => attribution count == 0', () => {
    for (let i = 0; i < 200; i++) {
      const n = (i % 5) + 1
      const types = ['gmail', 'drive', 'file', 'chat', 'saved', 'custom'] as const
      const attrs = Array.from({ length: n }, (_, k) => src(`s${k}`, types[k % types.length]))
      const out = applyShareFilter(thread(attrs), 'private')
      expect(out.sourceAttributions.length).toBe(0)
    }
  })

  it('property: show-chat mode => no gmail/drive/file and no unshareable/sensitive items', () => {
    const blocked = new Set(['gmail', 'drive', 'file'])
    for (let i = 0; i < 200; i++) {
      const types = ['gmail', 'drive', 'file', 'chat', 'saved', 'custom'] as const
      const attrs = Array.from({ length: 4 }, (_, k) => src(`s${k}`, types[(i + k) % types.length]))
      const out = applyShareFilter(thread(attrs), 'show-chat')
      for (const a of out.sourceAttributions) {
        expect(blocked.has(String(a.sourceType))).toBe(false)
        expect(a.itemShareable).not.toBe(false)
      }
    }
  })
})

describe('applyExportFilter', () => {
  it('default (shareableOnly=false) is fully faithful — includes ALL sources incl connector', () => {
    const payload: ExportPayload = {
      items: [{ id: 'm1', content: 'goes to Singapore', sourceIds: ['g1', 'c1'] }],
      sourceRecords: [
        { id: 'g1', sourceType: 'gmail', title: 'flight', content: 'Flight to Singapore', shareable: false },
        { id: 'c1', sourceType: 'chat', title: null, content: null, shareable: true }
      ]
    }
    const out = applyExportFilter(payload)
    expect(out.sourceRecords).toHaveLength(2)
    expect(out.items).toHaveLength(1)
  })

  it('shareableOnly=true keeps only shareable source records', () => {
    const payload: ExportPayload = {
      items: [{ id: 'm1', content: 'x', sourceIds: ['g1'] }],
      sourceRecords: [{ id: 'g1', sourceType: 'gmail', title: 't', content: 'c', shareable: false }]
    }
    const out = applyExportFilter(payload, true)
    expect(out.sourceRecords).toEqual([])
  })

  it('two pipelines are independent — export keeps connector content that share strips', () => {
    const gmail = src('g', 'gmail', { rawTitle: 'Board meeting Q3 confidential', rawSnippet: 'top secret' })
    const shared = applyShareFilter(thread([gmail]), 'show-chat')
    const exported = applyExportFilter({
      items: [{ id: 'm1', content: 'Singapore', sourceIds: ['g'] }],
      sourceRecords: [{ id: 'g', sourceType: 'gmail', title: 'Board meeting Q3 confidential', content: 'top secret', shareable: false }]
    })
    expect(shared.sourceAttributions).toEqual([])
    expect(exported.sourceRecords[0].content).toBe('top secret')
  })
})
