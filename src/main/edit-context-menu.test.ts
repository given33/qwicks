import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildEditContextMenuTemplate, type EditContextMenuFlags } from './edit-context-menu'

const allEnabled: EditContextMenuFlags = {
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true
}

type LabeledMenuItem = MenuItemConstructorOptions & { label: string }

function isLabeled(item: MenuItemConstructorOptions): item is LabeledMenuItem {
  return typeof item.label === 'string'
}

function labeled(template: MenuItemConstructorOptions[]): LabeledMenuItem[] {
  return template.filter(isLabeled)
}

describe('buildEditContextMenuTemplate', () => {
  it('返回 剪切/复制/粘贴/分隔符/删除/全选 的有序模板', () => {
    const actions = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), remove: vi.fn(), selectAll: vi.fn() }
    const template = buildEditContextMenuTemplate(allEnabled, actions)

    expect(template.map((item) => ('label' in item ? item.label : item.type))).toEqual([
      '剪切',
      '复制',
      '粘贴',
      'separator',
      '删除',
      '全选'
    ])
  })

  it('每项在 accelerator 上标注快捷键', () => {
    const actions = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), remove: vi.fn(), selectAll: vi.fn() }
    const template = buildEditContextMenuTemplate(allEnabled, actions)

    expect(labeled(template).map((item) => item.accelerator)).toEqual([
      'CmdOrCtrl+X',
      'CmdOrCtrl+C',
      'CmdOrCtrl+V',
      'Delete',
      'CmdOrCtrl+A'
    ])
  })

  it('enabled 与传入的 flags 一一对应', () => {
    const flags: EditContextMenuFlags = {
      canCut: true,
      canCopy: false,
      canPaste: true,
      canDelete: false,
      canSelectAll: true
    }
    const actions = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), remove: vi.fn(), selectAll: vi.fn() }
    const template = buildEditContextMenuTemplate(flags, actions)

    expect(labeled(template).map((item) => item.enabled)).toEqual([true, false, true, false, true])
  })

  it('点击各菜单项分派到对应的 action', () => {
    const actions = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), remove: vi.fn(), selectAll: vi.fn() }
    const template = buildEditContextMenuTemplate(allEnabled, actions)

    for (const item of labeled(template)) item.click?.(undefined as never, undefined as never, undefined as never)

    expect(actions.cut).toHaveBeenCalledTimes(1)
    expect(actions.copy).toHaveBeenCalledTimes(1)
    expect(actions.paste).toHaveBeenCalledTimes(1)
    expect(actions.remove).toHaveBeenCalledTimes(1)
    expect(actions.selectAll).toHaveBeenCalledTimes(1)
  })
})
