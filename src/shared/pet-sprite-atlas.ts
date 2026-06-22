/**
 * 暖黄形象精灵图裁切映射（M2-T1）。
 *
 * 暖黄形象精灵图是 9 行姿态网格。本模块定义：
 *   - PetPose：9 种姿态枚举
 *   - PET_FIGURE_BY_SLOT：UI 插件 7 槽位 → 姿态映射（喂给 mascot 系统替换旧美术）
 *   - petFrame(pose)：返回某姿态图片的运行时 URL（renderer import）
 *
 * 当前用的是占位帧（scripts/make-placeholder-pet-atlas.cjs 生成）。
 * 拿到真实暖黄精灵图后，跑裁切脚本覆盖 src/asset/img/pet/*.png 即可，
 * 本模块的映射逻辑不变。
 *
 * 注意：这是 shared 模块，被 renderer（主窗口 mascot）和 renderer-pet（桌面精灵）
 * 共同引用。图片 import 用相对路径，由各 renderer 的 vite 别名解析。
 * 这里用 `@petAsset` 别名指向 src/asset/img/pet/，需在 vite config 注册
 * （主 renderer 和 pet renderer 各自的 resolve.alias）。
 */

import type { UiPluginFigureSlot } from './ui-plugin'

/** 暖黄形象 9 种姿态（对应精灵图 9 行） */
export const PET_POSES = [
  'stand',
  'walk',
  'sit',
  'wave',
  'talk',
  'sad',
  'sleep',
  'think',
  'wonder'
] as const

export type PetPose = (typeof PET_POSES)[number]

/**
 * UI 插件 7 槽位 → 暖黄姿态映射。
 * 替换 AnimatedWorkLogo 等组件里旧 qwicks 与 iqwicks 美术的依据：
 *   swim(工作巡航) → walk 行走
 *   surf(冲浪)    → walk 行走（近似）
 *   greet(打招呼) → wave 挥手
 *   sleep(睡觉)   → sleep
 *   sit(坐着)     → sit
 *   run(奔跑)     → walk 行走（近似）
 *   toggleIcon    → stand 站立
 */
export const PET_FIGURE_BY_SLOT: Record<UiPluginFigureSlot, PetPose> = {
  swim: 'walk',
  surf: 'walk',
  greet: 'wave',
  sleep: 'sleep',
  sit: 'sit',
  run: 'walk',
  toggleIcon: 'stand'
}

/** 槽位 → 姿态的解析（带 fallback 链：找不到精确姿态时回退） */
export function poseForSlot(slot: UiPluginFigureSlot): PetPose {
  return PET_FIGURE_BY_SLOT[slot] ?? 'stand'
}

/** 校验某值是否为合法 PetPose */
export function isPetPose(value: unknown): value is PetPose {
  return typeof value === 'string' && (PET_POSES as readonly string[]).includes(value)
}
