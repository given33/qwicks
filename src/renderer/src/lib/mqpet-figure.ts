/**
 * MQPet 企鹅形象帧 import 与 petFigure() 解析（renderer 主窗口侧）。
 *
 * 替换原暖黄形象：主窗口的 mascot 系统（AnimatedWorkLogo / 标题栏图标 /
 * 彩蛋 / 庆祝）改用 QQ 企鹅精灵帧。帧来自 resources/mqpet/sprites/，
 * 由 tools/mqpet-convert/extract_sprites.py 烘焙。
 *
 * 保留 petFigure()/petFigureForSlot() 的旧 API 名，主窗口调用方只需改 import 路径。
 */
import type { UiPluginFigureSlot } from '@shared/ui-plugin'

// 载入全部企鹅精灵帧，文件名 -> 解析 URL。
// Relative to src/renderer/src/lib/ -> ../../../asset/img/mqpet/sprites/
const SPRITE_URLS: Record<string, string> = {}
for (const [path, url] of Object.entries(
  import.meta.glob('../../../asset/img/mqpet/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
)) {
  SPRITE_URLS[path.split('/').pop()!] = url
}

// 主窗口用到的姿态 -> 企鹅精灵帧（取对应动画第一帧）。
//   stand/walk/sit/wave/sleep/talk/sad/think/wonder 全部归一到一个站姿帧，
//   因为主窗口 mascot 只需要静态/简单切换，不需要完整动画。
const PENGUIN_STAND = SPRITE_URLS['sp_01c0c4ac.png'] ?? ''

const PET_FRAMES: Record<string, string> = {
  stand: PENGUIN_STAND,
  walk: SPRITE_URLS['sp_57aa1885.png'] ?? PENGUIN_STAND,
  sit: PENGUIN_STAND,
  wave: PENGUIN_STAND,
  talk: PENGUIN_STAND,
  sad: PENGUIN_STAND,
  sleep: PENGUIN_STAND,
  think: PENGUIN_STAND,
  wonder: PENGUIN_STAND,
}

/** 取某姿态的图片 URL */
export function petFigure(pose: string): string {
  return PET_FRAMES[pose] ?? PET_FRAMES.stand
}

/** 取某 UI 插件槽位对应的企鹅帧（替换旧 qwicks/iqwicks 美术用） */
export function petFigureForSlot(slot: UiPluginFigureSlot): string {
  return PET_FRAMES.stand
}
