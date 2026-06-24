import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

// 写作功能已下架（任务4）：WorkspaceModeTabs 现在只渲染 Code tab。
describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  function props(activeView: 'chat' | 'write' = 'chat') {
    return {
      activeView,
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn()
    }
  }

  it('renders a single Code tab button (write was removed)', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('Code')
    expect(html).not.toContain('Write')
    expect(html.match(/role="tab"/g)?.length).toBe(1)
  })

  it('uses horizontal row layout not vertical column', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('flex-row')
    expect(html).not.toContain('flex-col')
  })

  it('marks the Code button with aria-selected true when active', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('chat')))
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
  })

  it('preserves truncate class on button text for narrow sidebars', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html.match(/truncate/g)?.length).toBe(1)
  })

  it('preserves min-w-0 on buttons for flex truncation', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('min-w-0')
  })

  it('renders role="tablist" container with descriptive aria-label', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('role="tablist"')
  })

  it('does not render secondary switches in the sidebar mode tabs', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).not.toContain('role="switch"')
    expect(html.match(/role="tab"/g)?.length).toBe(1)
  })
})
