/**
 * 桌面宠物 —— 道具目录（M4-T5）。
 *
 * 食物/清洁/药品/还魂丹/玩具各若干档。price 用元宝。
 * icon 当前用 emoji 占位（M9 起导入 QQ 道具图标后替换为 img path）。
 * 全部纯数据，可在测试里校验完整性。
 */
import type { PetItem } from './pet-state'

export const PET_CATALOG: PetItem[] = [
  // 食物
  { id: 'bun', type: 'food', name: '包子', effect: { hunger: 25, mood: 5 }, price: 10, },
  { id: 'rice', type: 'food', name: '米饭', effect: { hunger: 40 }, price: 20, },
  { id: 'feast', type: 'food', name: '满汉全席', effect: { hunger: 80, mood: 20 }, price: 80, },
  { id: 'snack', type: 'food', name: '零食', effect: { hunger: 10, mood: 15 }, price: 15, },
  // 清洁
  { id: 'towel', type: 'bath', name: '毛巾', effect: { cleanliness: 30 }, price: 10, },
  { id: 'soap', type: 'bath', name: '沐浴露', effect: { cleanliness: 60, mood: 5 }, price: 25, },
  { id: 'spa', type: 'bath', name: '搓澡套餐', effect: { cleanliness: 90, mood: 15 }, price: 60, },
  // 药品
  { id: 'cold-meds', type: 'medicine', name: '感冒药', effect: { health: 30 }, price: 30, },
  { id: 'special-meds', type: 'medicine', name: '特效药', effect: { health: 60 }, price: 70, },
  { id: 'iv-drip', type: 'medicine', name: '点滴', effect: { health: 80 }, price: 100, },
  // 还魂丹
  { id: 'revive', type: 'revive', name: '还魂丹', effect: {}, price: 200, },
  // 玩具
  { id: 'ball', type: 'toy', name: '小球', effect: { mood: 25 }, price: 15, },
  { id: 'puzzle', type: 'toy', name: '拼图', effect: { mood: 35 }, price: 25, }
]

/** 按 id 查道具。 */
export function findItem(id: string): PetItem | undefined {
  return PET_CATALOG.find((i) => i.id === id)
}

/** 按类型筛选（商店分类用）。 */
export function itemsByType(type: PetItem['type']): PetItem[] {
  return PET_CATALOG.filter((i) => i.type === type)
}
