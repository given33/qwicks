/**
 * 桌面宠物 —— 婚育系统（M12）。
 *
 * 成年后可相亲结婚 + 培育宠物蛋。纯函数。
 * 本地多存档"送蛋"留架构（partnerId 占位）。
 */
import type { PetGrowth } from './pet-growth'

export type MarriageState = {
  partnerId: string | null   // 伴侣 id（本地生成的候选）
  partnerName: string | null
  marriedAt: number | null
  eggs: number               // 已培育的蛋数
}

export function defaultMarriage(): MarriageState {
  return { partnerId: null, partnerName: null, marriedAt: null, eggs: 0 }
}

/** 是否可结婚：成年。 */
export function canMarry(growth: PetGrowth): boolean {
  return growth.stage === 'adult'
}

/** 生成本地候选伴侣。注入 random 便于测试。 */
export function generateSuitor(random: () => number = Math.random): { id: string; name: string } {
  const surnames = ['小', '阿', '大', '萌', '乖']
  const names = ['花', '宝', '豆', '糖', '团', '球', '咪', '喵']
  const surname = surnames[Math.floor(random() * surnames.length)] ?? '小'
  const name = names[Math.floor(random() * names.length)] ?? '宝'
  return { id: `suitor-${Date.now()}-${Math.floor(random() * 1000)}`, name: surname + name }
}

/** 结婚。 */
export function marry(state: MarriageState, suitor: { id: string; name: string }, now: number): MarriageState {
  if (state.marriedAt !== null) return state // 已婚
  return { ...state, partnerId: suitor.id, partnerName: suitor.name, marriedAt: now }
}

/** 培育宠物蛋：婚后可培育，每次 +1 蛋。返回 { state, laid }。 */
export function layEgg(state: MarriageState, now: number): { state: MarriageState; laid: boolean } {
  if (state.marriedAt === null) return { state, laid: false }
  return { state: { ...state, eggs: state.eggs + 1 }, laid: true }
}

/** 离婚（重置）。 */
export function divorce(state: MarriageState): MarriageState {
  return { ...defaultMarriage() }
}
