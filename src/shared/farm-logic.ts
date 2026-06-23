/**
 * 桌面宠物 —— 农场玩法逻辑（M10）。
 *
 * 买种子 → 种下 → 定时生长（种子→发芽→成熟）→ 收获换元宝。
 * 纯函数：作物定义、生长阶段推进、收获判定。
 */

export type CropStage = 'seed' | 'sprout' | 'ripe'

export type CropDef = {
  id: string
  name: string
  seedPrice: number
  sellPrice: number
  growDurationMs: number // 总生长时长
}

/** 可种作物。 */
export const CROPS: CropDef[] = [
  { id: 'radish', name: '萝卜', seedPrice: 5, sellPrice: 15, growDurationMs: 30 * 1000 },
  { id: 'carrot', name: '胡萝卜', seedPrice: 8, sellPrice: 24, growDurationMs: 60 * 1000 },
  { id: 'pumpkin', name: '南瓜', seedPrice: 15, sellPrice: 50, growDurationMs: 2 * 60 * 1000 },
  { id: 'strawberry', name: '草莓', seedPrice: 20, sellPrice: 70, growDurationMs: 3 * 60 * 1000 }
]

export type Plot = {
  cropId: string | null
  plantedAt: number | null  // ms
}

export type FarmState = {
  plots: Plot[]  // 固定 6 块地
}

export function defaultFarm(): FarmState {
  return { plots: Array.from({ length: 6 }, () => ({ cropId: null, plantedAt: null })) }
}

export function findCrop(id: string): CropDef | undefined {
  return CROPS.find((c) => c.id === id)
}

/**
 * 计算某块地的当前生长阶段。
 * 空地或刚种：seed；长到 50%：sprout；满：ripe。
 */
export function plotStage(plot: Plot, now: number): CropStage {
  if (!plot.cropId || plot.plantedAt === null) return 'seed'
  const crop = findCrop(plot.cropId)
  if (!crop) return 'seed'
  const elapsed = now - plot.plantedAt
  const ratio = elapsed / crop.growDurationMs
  if (ratio >= 1) return 'ripe'
  if (ratio >= 0.5) return 'sprout'
  return 'seed'
}

/** 种下作物（需先扣种子价）。返回新 farm。 */
export function plant(farm: FarmState, plotIndex: number, cropId: string, now: number): FarmState {
  if (plotIndex < 0 || plotIndex >= farm.plots.length) return farm
  const plot = farm.plots[plotIndex]
  if (plot.cropId) return farm // 已种
  const plots = [...farm.plots]
  plots[plotIndex] = { cropId, plantedAt: now }
  return { ...farm, plots }
}

/** 收获：返回 { farm, reward }。未成熟奖励 0。 */
export function harvest(farm: FarmState, plotIndex: number, now: number): { farm: FarmState; reward: number; cropName: string | null } {
  if (plotIndex < 0 || plotIndex >= farm.plots.length) return { farm, reward: 0, cropName: null }
  const plot = farm.plots[plotIndex]
  if (!plot.cropId || plot.plantedAt === null) return { farm, reward: 0, cropName: null }
  const crop = findCrop(plot.cropId)
  if (!crop) return { farm, reward: 0, cropName: null }
  const stage = plotStage(plot, now)
  // BUG-24 修复：未成熟时不销毁作物（只返回 reward:0，保留 cropId 让它继续长）
  if (stage !== 'ripe') {
    return { farm, reward: 0, cropName: null }
  }
  const plots = [...farm.plots]
  plots[plotIndex] = { cropId: null, plantedAt: null }
  return { farm: { ...farm, plots }, reward: crop.sellPrice, cropName: crop.name }
}

/** 阶段对应的 emoji（渲染用）。 */
export function stageEmoji(stage: CropStage, cropId: string | null): string {
  if (!cropId) return '🟫'
  return stage === 'seed' ? '🌱' : stage === 'sprout' ? '🌿' : cropEmoji(cropId)
}

function cropEmoji(cropId: string): string {
  return cropId === 'radish' ? '🪵'
    : cropId === 'carrot' ? '🥕'
      : cropId === 'pumpkin' ? '🎃'
        : cropId === 'strawberry' ? '🍓'
          : '🌾'
}
