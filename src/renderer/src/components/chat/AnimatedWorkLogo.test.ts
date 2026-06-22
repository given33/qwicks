import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveUiPluginFigure } from '@shared/ui-plugin'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import {
  AnimatedWorkLogo,
  IQWICKS_CAMEO_DURATIONS_MS,
  IQWICKS_CAMEO_TYPES,
  IqwicksCameo,
  IQWICKS_WORK_LOGO_VARIANTS,
  IQWICKS_WORK_LOGO_VARIANT_LABEL_KEYS,
  QWICKS_CELEBRATION_DURATIONS_MS,
  QWICKS_CELEBRATION_VARIANTS,
  QWicksCelebration,
  QWicksStateFigure,
  SidebarMascot,
  UI_PLUGIN_CAMEO_SLOTS,
  UI_PLUGIN_CELEBRATION_SLOTS,
  UI_PLUGIN_STATE_SLOTS,
  WORK_LOGO_SWIM_MODES,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  pickIqwicksCameo,
  pickQWicksCelebration
} from './AnimatedWorkLogo'
import { WorkMetaRow } from './message-timeline-cards'

describe('AnimatedWorkLogo', () => {
  it('ships the warm-yellow pet figure assets (M2 reskin)', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    // M2 换皮后旧 qwicks_*.png / iqwicks_*.png 已移除，全部用暖黄形象帧。
    // 只验证关键帧存在且是合法 PNG。
    for (const pose of ['stand', 'walk', 'wave', 'sleep', 'sit'] as const) {
      const figure = await readFile(new URL(`../../../../asset/img/pet/${pose}.png`, import.meta.url))
      const dims = pngDimensions(figure)
      expect(dims.width).toBeGreaterThan(0)
      expect(dims.height).toBeGreaterThan(0)
    }
  })

  it('renders layered logo markup for swim animation', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, className: 'extra-class', size: 'md' })
    )

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-md')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).toContain('is-active')
    expect(html).toContain('extra-class')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-current')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-ripple')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-wake')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).toContain('ds-work-logo-bubbles')
    expect(html).toContain('ds-work-logo-echo')
    expect(html).toContain('ds-work-logo-track')
    expect(html).toContain('ds-work-logo-body')
    expect(html).toContain('ds-work-logo-image')
    expect(html).toContain('ds-iqwicks-logo')
    expect(html).toContain('ds-iqwicks-figure')
    expect(html).toMatch(/ds-iqwicks-logo-(dribble|run|boba)/)
    expect(html).toMatch(/ds-work-logo-mode-(propel|sprint|dive|surf)/)
  })

  it('renders the state figures with their kind classes', () => {
    for (const kind of ['greet', 'sleep', 'sit'] as const) {
      const html = renderToStaticMarkup(createElement(QWicksStateFigure, { kind }))
      expect(html).toContain(`ds-qwicks-state-${kind}`)
      expect(html).toContain('ds-qwicks-state-figure')
      expect(html).toContain('ds-iqwicks-state-figure')
    }
  })

  describe('UI plugin slot fallback chains', () => {
    const figures = {
      swim: 'data:image/png;base64,SWIM',
      greet: 'data:image/png;base64,GREET'
    }

    it('every surface chain ends at swim so partial skins always resolve', () => {
      const chains = [
        ...Object.values(UI_PLUGIN_STATE_SLOTS),
        ...Object.values(UI_PLUGIN_CAMEO_SLOTS),
        ...Object.values(UI_PLUGIN_CELEBRATION_SLOTS)
      ]
      for (const chain of chains) {
        expect(chain[chain.length - 1]).toBe('swim')
      }
    })

    it('resolves missing slots through the chains', () => {
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_STATE_SLOTS.greet)).toBe(figures.greet)
      // sleep 槽位缺失 → 回退链最终落到 swim
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_STATE_SLOTS.sleep)).toBe(figures.swim)
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_CAMEO_SLOTS.dash)).toBe(figures.swim)
      expect(resolveUiPluginFigure(figures, UI_PLUGIN_CELEBRATION_SLOTS.cheer)).toBe(figures.greet)
      expect(resolveUiPluginFigure(null, UI_PLUGIN_STATE_SLOTS.greet)).toBeNull()
    })

    it('keeps default art when no plugin is active', () => {
      expect(useUiPluginStore.getState().activeRuntime).toBeNull()
      const html = renderToStaticMarkup(createElement(QWicksStateFigure, { kind: 'greet' }))
      expect(html).not.toContain('data:image')
      expect(html).toContain('ds-qwicks-state-figure')
    })
  })

  it('pins the swim mode when one is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, mode: 'dive' })
    )

    expect(html).toContain('ds-work-logo-mode-dive')
  })

  it('pins the iqwicks variant when one is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, iqwicksVariant: 'boba' })
    )

    expect(html).toContain('ds-iqwicks-logo-boba')
  })

  it('renders the sidebar mascot with a state figure', () => {
    const html = renderToStaticMarkup(createElement(SidebarMascot))

    expect(html).toContain('ds-sidebar-mascot')
    expect(html).toMatch(/ds-qwicks-state-(sit|greet|sleep)/)
  })

  it('renders every iqwicks cameo type with side classes', () => {
    for (const type of ['dash', 'peek', 'boba', 'nap'] as const) {
      const html = renderToStaticMarkup(createElement(IqwicksCameo, { cameo: { type, side: 'left' } }))
      expect(html).toContain(`ds-iqwicks-cameo-${type}`)
      expect(html).toContain('is-left')
      expect(html).toContain('ds-iqwicks-cameo-figure')
    }

    const chaseHtml = renderToStaticMarkup(
      createElement(IqwicksCameo, { cameo: { type: 'chase', side: 'right' } })
    )
    expect(chaseHtml.match(/ds-iqwicks-cameo-dash/g)?.length).toBe(2)
    expect(chaseHtml).toContain('is-second')
  })

  it('renders every celebration variant with dual figures and confetti', () => {
    for (const variant of QWICKS_CELEBRATION_VARIANTS) {
      const html = renderToStaticMarkup(createElement(QWicksCelebration, { variant }))
      expect(html).toContain(`ds-qwicks-celebration-${variant}`)
      expect(html).toContain('is-qwicks')
      expect(html).toContain('is-iqwicks')
      expect(html).toContain('ds-qwicks-confetti')
      expect(html.match(/<i><\/i>/g)?.length).toBe(10)
      expect(QWICKS_CELEBRATION_DURATIONS_MS[variant]).toBeGreaterThan(0)
    }
  })

  it('picks valid celebration variants with increasing ids', () => {
    const first = pickQWicksCelebration()
    const second = pickQWicksCelebration()

    expect(QWICKS_CELEBRATION_VARIANTS).toContain(first.variant)
    expect(second.id).toBeGreaterThan(first.id)
  })

  it('picks valid cameo specs with increasing ids and complete durations', () => {
    const first = pickIqwicksCameo()
    const second = pickIqwicksCameo()

    expect(IQWICKS_CAMEO_TYPES).toContain(first.type)
    expect(['left', 'right']).toContain(first.side)
    expect(second.id).toBeGreaterThan(first.id)

    for (const type of IQWICKS_CAMEO_TYPES) {
      expect(IQWICKS_CAMEO_DURATIONS_MS[type]).toBeGreaterThan(0)
    }
  })

  it('maps every swim mode and iqwicks variant to a status label key in both locales', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const zh = JSON.parse(await readFile(new URL('../../locales/zh/common.json', import.meta.url), 'utf8'))
    const en = JSON.parse(await readFile(new URL('../../locales/en/common.json', import.meta.url), 'utf8'))

    for (const swimMode of WORK_LOGO_SWIM_MODES) {
      const labelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
      expect(labelKey).toBeTruthy()
      expect(zh[labelKey]).toBeTruthy()
      expect(en[labelKey]).toBeTruthy()
    }

    for (const variant of IQWICKS_WORK_LOGO_VARIANTS) {
      const labelKey = IQWICKS_WORK_LOGO_VARIANT_LABEL_KEYS[variant]
      expect(labelKey).toBeTruthy()
      expect(zh[labelKey]).toBeTruthy()
      expect(en[labelKey]).toBeTruthy()
    }
  })

  it('defaults to a static logo unless active', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo))

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).not.toContain('is-active')
  })

  it('keeps wave and splash layers mounted in static state to avoid layout churn', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { size: 'sm' }))

    expect(html).toContain('ds-work-logo-sm')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).not.toContain('is-active')
  })

  it('can render a desynchronized trailing phase', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { active: true, phase: 'trail' }))

    expect(html).toContain('is-active')
    expect(html).toContain('ds-work-logo-phase-trail')
  })

  it('keeps the processing work row as text-only status', () => {
    const html = renderToStaticMarkup(
      createElement(WorkMetaRow, {
        processing: true,
        stepCount: 3,
        expanded: true,
        onToggle: () => undefined
      })
    )

    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo-slot')
  })

  it('keeps the swim animation layers wired in CSS', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const baseShellCss = await readFile(new URL('../../styles/base-shell.css', import.meta.url), 'utf8')

    for (const layer of [
      'gust',
      'swell',
      'wave-front',
      'breaker',
      'wake',
      'foam',
      'waterline',
      'crest',
      'splash',
      'spray',
      'bubbles'
    ]) {
      expect(baseShellCss).toContain(`ds-work-logo-${layer}`)
    }

    expect(baseShellCss).toContain('.ds-work-logo.is-active .ds-work-logo-body::after')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-waterline')
    expect(baseShellCss).not.toContain('ds-work-logo-tail')
    expect(baseShellCss).not.toContain('transform: translateZ(0) scaleX(-1)')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-sprint')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-dive')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-surf')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-sprint-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-figure')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-surf-path')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-greet-wave')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-sleep-breathe')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-sit-sway')
    expect(baseShellCss).toContain('.ds-work-logo:hover')
    expect(baseShellCss).toContain('.ds-qwicks-state:hover')
    expect(baseShellCss).toContain("[data-iqwicks-mode='on'] .ds-work-logo .ds-iqwicks-logo")
    expect(baseShellCss).toContain("[data-iqwicks-mode='on'] {")
    expect(baseShellCss).toContain("[data-theme='dark'][data-iqwicks-mode='on'],")
    expect(baseShellCss).toContain("[data-theme='dark'][data-iqwicks-mode='on'] .ds-workbench-shell")
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-dribble')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-run')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-boba')
    expect(baseShellCss).toContain('.ds-iqwicks-cameo-layer')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-cameo-cross')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-cameo-peek')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-cameo-rise')
    expect(baseShellCss).toContain('@keyframes ds-iqwicks-cameo-doze')
    expect(baseShellCss).toContain('.ds-qwicks-celebration-layer')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-celebrate-cheer')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-celebrate-lap')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-celebrate-toast')
    expect(baseShellCss).toContain('@keyframes ds-qwicks-confetti-burst')
    // M2: prefers-reduced-motion 降级已移除（特效无条件全开）
    expect(baseShellCss).not.toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-iqwicks-cameo-layer")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-qwicks-celebration-layer")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-qwicks-state")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-work-logo")
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-work-logo-slot:has(.ds-work-logo)")
    expect(baseShellCss).toContain('display: none !important;')
    expect(baseShellCss).not.toContain("[data-focus-mode='on'] .ds-shiny-text")
    expect(baseShellCss).not.toContain("[data-focus-mode='on'] .ds-runtime-wake-shell::before")
  })

  it('ships warm-yellow pet icon assets for app/tray (M2 reskin)', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    // M2 换皮：app/tray 图标改用暖黄形象，旧 qwicks*.png 已移除。
    for (const name of ['pet/stand.png', 'pet/pet_mac.png', 'pet/pet_tray.png'] as const) {
      const icon = await readFile(new URL(`../../../../asset/img/${name}`, import.meta.url))
      const dims = pngDimensions(icon)
      expect(dims.width).toBeGreaterThan(0)
      expect(dims.height).toBeGreaterThan(0)
    }
  })
})

function pngDimensions(buffer: Uint8Array): { width: number; height: number } {
  const signature = [...buffer.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(signature).toBe('89504e470d0a1a0a')
  return {
    width: readUint32BE(buffer, 16),
    height: readUint32BE(buffer, 20)
  }
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] * 16_777_216 +
    buffer[offset + 1] * 65_536 +
    buffer[offset + 2] * 256 +
    buffer[offset + 3]
  )
}
