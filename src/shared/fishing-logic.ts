/**
 * 桌面宠物 —— 钓鱼玩法逻辑（M9）。
 *
 * 参考 QQ 宠物钓鱼：抛竿 → 等待咬钩（随机时间）→ 提竿时机判定 → 收获。
 * 纯函数：咬钩时间、收获表、连击加成。可单测。
 */
export type FishRarity = 'common' | 'uncommon' | 'rare' | 'junk'

export type FishCatch = {
  name: string
  rarity: FishRarity
  /** 卖给商店的元宝价 */
  value: number
}

/** 咬钩等待时间范围（ms）。 */
export const BITE_MIN_MS = 1500
export const BITE_MAX_MS = 5000
/** 咬钩窗口：鱼咬钩后多久没提竿就跑掉（ms）。 */
export const BITE_WINDOW_MS = 1200

const FISH_TABLE: { catch: FishCatch; weight: number }[] = [
  { catch: { name: '小鱼苗', rarity: 'common', value: 5 }, weight: 40 },
  { catch: { name: '鲫鱼', rarity: 'common', value: 10 }, weight: 25 },
  { catch: { name: '鲤鱼', rarity: 'uncommon', value: 20 }, weight: 15 },
  { catch: { name: '草鱼', rarity: 'uncommon', value: 30 }, weight: 10 },
  { catch: { name: '金龙鱼', rarity: 'rare', value: 80 }, weight: 5 },
  { catch: { name: '破靴子', rarity: 'junk', value: 1 }, weight: 5 }
]

/** 随机咬钩等待时间。注入 random 便于测试。 */
export function rollBiteDelay(random: () => number = Math.random): number {
  return BITE_MIN_MS + random() * (BITE_MAX_MS - BITE_MIN_MS)
}

/**
 * 按权重随机决定钓到什么。连击 combo 越高，稀有鱼概率越大。
 */
export function rollCatch(combo = 0, random: () => number = Math.random): FishCatch {
  const luckBoost = Math.min(combo * 0.05, 0.3) // 连击提升稀有度上限 30%
  const adjusted = FISH_TABLE.map((e) => ({
    catch: e.catch,
    weight: e.catch.rarity === 'rare' ? e.weight * (1 + luckBoost * 4)
      : e.catch.rarity === 'uncommon' ? e.weight * (1 + luckBoost)
        : e.weight
  }))
  const total = adjusted.reduce((s, e) => s + e.weight, 0)
  let r = random() * total
  for (const e of adjusted) {
    r -= e.weight
    if (r <= 0) return e.catch
  }
  return adjusted[adjusted.length - 1].catch
}

/**
 * 判定提竿结果。
 *   - 提竿太早（咬钩前）：空竿，连击清零
 *   - 提竿在咬钩窗口内：成功，连击 +1
 *   - 鱼跑了（咬钩后超窗口未提）：空竿，连击清零
 *
 * elapsedSinceCast: 抛竿后经过 ms
 * bitAt: 鱼咬钩时刻（相对抛竿 ms），null=还没咬
 */
export type CastResult =
  | { outcome: 'early'; combo: 0 }
  | { outcome: 'success'; combo: number; catch: FishCatch }
  | { outcome: 'escaped'; combo: 0 }

export function judgeCast(elapsedSinceCast: number, bitAt: number | null, currentCombo: number, random: () => number = Math.random): CastResult {
  if (bitAt === null) {
    // 还没咬钩就提竿
    return { outcome: 'early', combo: 0 }
  }
  const sinceBite = elapsedSinceCast - bitAt
  // BUG-6 修复：时间倒流（提竿早于咬钩）判 early
  if (sinceBite < 0) {
    return { outcome: 'early', combo: 0 }
  }
  if (sinceBite > BITE_WINDOW_MS) {
    return { outcome: 'escaped', combo: 0 }
  }
  // 成功
  const newCombo = currentCombo + 1
  return { outcome: 'success', combo: newCombo, catch: rollCatch(newCombo, random) }
}
