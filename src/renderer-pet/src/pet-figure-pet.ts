/**
 * 暖黄形象帧 import（pet renderer 侧，M3）。
 *
 * 桌面精灵窗口（renderer-pet）专用，与主窗口的 lib/pet-figure.ts 逻辑相同
 * 但图片 import 路径不同（vite per-bundle）。拿到真实精灵图后两边一起换资产。
 */
import type { PetPose } from '@shared/pet-sprite-atlas'
import standFrame from '@petAssets/stand.png'
import walkFrame from '@petAssets/walk.png'
import sitFrame from '@petAssets/sit.png'
import waveFrame from '@petAssets/wave.png'
import talkFrame from '@petAssets/talk.png'
import sadFrame from '@petAssets/sad.png'
import sleepFrame from '@petAssets/sleep.png'
import thinkFrame from '@petAssets/think.png'
import wonderFrame from '@petAssets/wonder.png'

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

export function petFigure(pose: PetPose): string {
  return PET_FRAMES[pose] ?? PET_FRAMES.stand
}
