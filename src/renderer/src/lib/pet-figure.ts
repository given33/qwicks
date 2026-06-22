/**
 * 暖黄形象帧 import 与 petFigure() 解析（renderer 侧，M2）。
 *
 * 集中 import 9 帧暖黄姿态图，供主窗口的 mascot 系统
 * （AnimatedWorkLogo / SidebarMascot / 彩蛋 / 庆祝）替换旧的 qwicks 与 iqwicks 美术。
 * 图片由 scripts/make-placeholder-pet-atlas.cjs 生成，拿到真实精灵图后覆盖。
 *
 * 桌面精灵窗口（renderer-pet）有自己的同名模块（路径不同），
 * 因为 vite 的图片 import 是 per-bundle 的，不能跨 renderer 共享 import 语句。
 */
import type { PetPose } from '@shared/pet-sprite-atlas'
import { PET_FIGURE_BY_SLOT } from '@shared/pet-sprite-atlas'
import type { UiPluginFigureSlot } from '@shared/ui-plugin'
import standFrame from '../../../asset/img/pet/stand.png'
import walkFrame from '../../../asset/img/pet/walk.png'
import sitFrame from '../../../asset/img/pet/sit.png'
import waveFrame from '../../../asset/img/pet/wave.png'
import talkFrame from '../../../asset/img/pet/talk.png'
import sadFrame from '../../../asset/img/pet/sad.png'
import sleepFrame from '../../../asset/img/pet/sleep.png'
import thinkFrame from '../../../asset/img/pet/think.png'
import wonderFrame from '../../../asset/img/pet/wonder.png'

const PET_FRAMES: Record<PetPose, string> = {
  stand: standFrame,
  walk: walkFrame,
  sit: sitFrame,
  wave: waveFrame,
  talk: talkFrame,
  sad: sadFrame,
  sleep: sleepFrame,
  think: thinkFrame,
  wonder: wonderFrame
}

/** 取某姿态的图片 URL */
export function petFigure(pose: PetPose): string {
  return PET_FRAMES[pose] ?? PET_FRAMES.stand
}

/** 取某 UI 插件槽位对应的暖黄帧（替换旧 qwicks/iqwicks 美术用） */
export function petFigureForSlot(slot: UiPluginFigureSlot): string {
  return petFigure(PET_FIGURE_BY_SLOT[slot])
}
