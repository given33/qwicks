/**
 * 桌面宠物 —— 小游戏逻辑集合（M11）。
 *
 * 6 个小游戏的核心纯逻辑：
 *   - guess: 猜拳（石头剪刀布）
 *   - mouse: 打地鼠（随机出洞判定）
 *   - rope: 跳绳（节奏判定）
 *   - paopao: 泡泡龙/消消乐（颜色匹配消除）
 *   - match: 连连看（图案配对）
 *   - tower100: 100层（层数累积）
 * 每个返回得分，结算换元宝。
 */

/** 猜拳 */
export type RpsChoice = 'rock' | 'paper' | 'scissors'
export type RpsResult = 'win' | 'lose' | 'draw'

export function rpsJudge(player: RpsChoice, cpu: RpsChoice): RpsResult {
  if (player === cpu) return 'draw'
  if (
    (player === 'rock' && cpu === 'scissors') ||
    (player === 'paper' && cpu === 'rock') ||
    (player === 'scissors' && cpu === 'paper')
  ) return 'win'
  return 'lose'
}

export function rpsRandom(random: () => number = Math.random): RpsChoice {
  const choices: RpsChoice[] = ['rock', 'paper', 'scissors']
  return choices[Math.floor(random() * 3)] ?? 'rock'
}

/** 打地鼠：给定地鼠出现位置数组与玩家点击，判定命中。 */
export function whackJudge(moles: number[], clickIndex: number): { hit: boolean; score: number } {
  if (moles.includes(clickIndex)) return { hit: true, score: 1 }
  return { hit: false, score: 0 }
}

/** 随机生成 n 个洞里的地鼠分布。 */
export function whackSpawn(holeCount: number, random: () => number = Math.random): number[] {
  const moles: number[] = []
  const count = 1 + Math.floor(random() * 2)
  for (let i = 0; i < count && i < holeCount; i += 1) {
    const idx = Math.floor(random() * holeCount)
    if (!moles.includes(idx)) moles.push(idx)
  }
  return moles
}

/** 跳绳：节奏判定。给定完美时机与玩家时机，判定。 */
export function ropeJudge(perfectTs: number, playerTs: number, windowMs = 300): { result: 'perfect' | 'good' | 'miss'; score: number } {
  const diff = Math.abs(playerTs - perfectTs)
  if (diff <= windowMs / 2) return { result: 'perfect', score: 2 }
  if (diff <= windowMs) return { result: 'good', score: 1 }
  return { result: 'miss', score: 0 }
}

/** 泡泡消除：给定网格，找出 3+ 连同色组返回需消除的格子索引。 */
export function paopaoFindMatches(grid: string[], cols: number): number[] {
  const matched = new Set<number>()
  // 横向
  for (let i = 0; i < grid.length; i += 1) {
    if (!grid[i]) continue
    const row = Math.floor(i / cols)
    const run: number[] = [i]
    for (let j = i + 1; j < grid.length && Math.floor(j / cols) === row; j += 1) {
      if (grid[j] === grid[i]) run.push(j)
      else break
    }
    if (run.length >= 3) run.forEach((idx) => matched.add(idx))
  }
  // 纵向
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < Math.floor(grid.length / cols); r += 1) {
      const i = r * cols + c
      if (!grid[i]) continue
      const run: number[] = [i]
      for (let rr = r + 1; rr < Math.floor(grid.length / cols); rr += 1) {
        const ii = rr * cols + c
        if (grid[ii] === grid[i]) run.push(ii)
        else break
      }
      if (run.length >= 3) run.forEach((idx) => matched.add(idx))
    }
  }
  return [...matched]
}

/** 连连看：两格可消除当且仅当同色。 */
export function matchCanClear(grid: string[], a: number, b: number): boolean {
  if (a === b) return false
  if (!grid[a] || !grid[b]) return false
  return grid[a] === grid[b]
}

/** 100层：每层成功 +1，返回新层数。 */
export function tower100Advance(currentFloor: number, success: boolean): number {
  return success ? currentFloor + 1 : Math.max(0, currentFloor - 1)
}

/** 得分换元宝（统一结算）。 */
export function scoreToCoins(score: number): number {
  return Math.max(0, Math.floor(score * 2))
}
