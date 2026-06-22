/**
 * 桌面宠物 —— 运动状态机（M1-T6 漫步引擎核心）。
 *
 * 宠物在任意时刻处于一个互斥的运动状态。M1 只用 idle/wander 两个状态
 * （当前屏内走动）；M3 会扩展 dragging/falling/landed/bonk + 跨屏寻路。
 *
 * 纯函数 transitionPetMotion(state, event, ctx) 返回下一状态；
 * 选目标点 pickWanderTarget 抽出来便于 mock 随机数单测。
 * 真正的逐帧移动（速度积分）在 WalkEngine.tsx 的 rAF 循环里做。
 */

export type Vec2 = { x: number; y: number }

export type PetMotionState =
  | { kind: 'idle'; until: number } // 站立待机，until=下次状态切换的墙钟 ms
  | { kind: 'wander'; target: Vec2; until: number } // 走向 target，until=放弃时刻

export type PetMotionEvent =
  | { type: 'timeout' } // idle/wander 计时到
  | { type: 'reached' } // wander 到达目标
  | { type: 'abort' } // 外部打断（如拖拽开始，M3）

export type MotionContext = {
  now: number
  /** 当前所在屏的可走区域（work area，逻辑像素），用于选合法目标点 */
  walkArea: { x: number; y: number; width: number; height: number }
  /** 当前精灵位置（用于 wander 放弃判定与朝向） */
  position: Vec2
  /** 随机数生成器，默认 Math.random；测试里注入可控 RNG */
  random?: () => number
}

/** idle 待机时长范围（ms） */
const IDLE_MIN_MS = 3000
const IDLE_MAX_MS = 8000
/** wander 超时放弃时长（ms，走太久没到就放弃换目标） */
const WANDER_TIMEOUT_MS = 12000
/** wander 触发概率（idle 超时时） */
const WANDER_PROBABILITY = 0.6

/** 精灵半尺寸，用于把目标点限制在"精灵中心不越出 work area" */
const SPRITE_HALF = { w: 48, h: 60 }

function defaultRandom(): number {
  return Math.random()
}

/**
 * 在 work area 内选一个随机目标点（精灵中心坐标）。
 * 距离当前位置至少 80px，避免原地踏步。
 */
export function pickWanderTarget(ctx: MotionContext): Vec2 {
  const rng = ctx.random ?? defaultRandom
  const minX = ctx.walkArea.x + SPRITE_HALF.w
  const maxX = ctx.walkArea.x + ctx.walkArea.width - SPRITE_HALF.w
  const minY = ctx.walkArea.y + SPRITE_HALF.h
  const maxY = ctx.walkArea.y + ctx.walkArea.height - SPRITE_HALF.h
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = minX + rng() * (maxX - minX)
    const y = minY + rng() * (maxY - minY)
    if (Math.hypot(x - ctx.position.x, y - ctx.position.y) >= 80) return { x, y }
  }
  // 多次都不够远，退而求其次
  return { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) }
}

/** 生成一个 idle 状态（带随机待机时长） */
export function makeIdle(now: number, random: () => number = defaultRandom): PetMotionState {
  const until = now + IDLE_MIN_MS + random() * (IDLE_MAX_MS - IDLE_MIN_MS)
  return { kind: 'idle', until }
}

/**
 * 状态转移纯函数。返回下一状态（不变则返回原 state 引用语义相同的新对象）。
 * 这是漫步引擎的可单测核心：注入可控 now/random/walkArea/position 即可覆盖所有分支。
 */
export function transitionPetMotion(
  state: PetMotionState,
  event: PetMotionEvent,
  ctx: MotionContext
): PetMotionState {
  const rng = ctx.random ?? defaultRandom

  if (state.kind === 'idle') {
    if (event.type === 'timeout') {
      // 待机结束：概率转 wander，否则继续 idle
      if (rng() < WANDER_PROBABILITY) {
        const target = pickWanderTarget(ctx)
        return { kind: 'wander', target, until: ctx.now + WANDER_TIMEOUT_MS }
      }
      return makeIdle(ctx.now, rng)
    }
    return state
  }

  // wander
  if (event.type === 'reached') {
    // 到达目标 → 进入 idle
    return makeIdle(ctx.now, rng)
  }
  if (event.type === 'timeout') {
    // 超时还没到 → 放弃，重新选目标或 idle
    if (rng() < 0.5) {
      const target = pickWanderTarget(ctx)
      return { kind: 'wander', target, until: ctx.now + WANDER_TIMEOUT_MS }
    }
    return makeIdle(ctx.now, rng)
  }
  // abort：交由 M3 处理（拖拽），M1 不触发
  return state
}

/** 判定 wander 是否到达目标（足够近） */
export function hasReachedTarget(position: Vec2, target: Vec2, threshold = 6): boolean {
  return Math.hypot(position.x - target.x, position.y - target.y) <= threshold
}

/** 判定当前是否该触发 timeout 事件 */
export function isMotionTimedOut(state: PetMotionState, now: number): boolean {
  return now >= state.until
}
