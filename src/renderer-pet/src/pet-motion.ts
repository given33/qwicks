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

/**
 * 运动状态机（M1 idle/wander + M3 dragging/falling/landed/bonk）。
 * 互斥状态，任何时刻宠物只处于其一，避免"边拖边漫步"等非法组合。
 */
export type PetMotionState =
  | { kind: 'idle'; until: number } // 站立待机
  | { kind: 'wander'; target: Vec2; until: number } // 走向目标
  | { kind: 'dragging' } // 被鼠标按住悬空（位置由鼠标驱动，不自主移动）
  | { kind: 'falling'; vy: number } // 松手后下坠，vy=垂直速度（px/ms）
  | { kind: 'landed'; until: number } // 屁股着地，短暂不动后回 idle
  | { kind: 'bonk'; until: number; fromLeft: boolean } // 撞墙回弹，until=回弹结束

export type PetMotionEvent =
  | { type: 'timeout' } // idle/wander/landed/bonk 计时到
  | { type: 'reached' } // wander 到达目标
  | { type: 'grab' } // 鼠标按下精灵 → dragging（M3）
  | { type: 'release' } // 拖拽松手 → falling（M3）
  | { type: 'land' } // falling 触底 → landed（M3）
  | { type: 'hitWall'; fromLeft: boolean } // wander 撞屏边 → bonk（M3）
  | { type: 'abort' } // 外部打断

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
/** landed（屁股着地）持续时间 ms，之后回 idle */
const LANDED_DURATION_MS = 1200
/** bonk（撞墙回弹）持续时间 ms */
const BONK_DURATION_MS = 800

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
 * 状态转移纯函数。返回下一状态。
 * 覆盖 M1 idle/wander + M3 dragging/falling/landed/bonk 全部转移。
 */
export function transitionPetMotion(
  state: PetMotionState,
  event: PetMotionEvent,
  ctx: MotionContext
): PetMotionState {
  const rng = ctx.random ?? defaultRandom

  // 任何非 falling/dragging 状态收到 grab → dragging（M3 拖拽开始）
  if (event.type === 'grab' && state.kind !== 'dragging' && state.kind !== 'falling') {
    return { kind: 'dragging' }
  }

  switch (state.kind) {
    case 'idle': {
      if (event.type === 'timeout') {
        if (rng() < WANDER_PROBABILITY) {
          return { kind: 'wander', target: pickWanderTarget(ctx), until: ctx.now + WANDER_TIMEOUT_MS }
        }
        return makeIdle(ctx.now, rng)
      }
      return state
    }
    case 'wander': {
      if (event.type === 'reached') return makeIdle(ctx.now, rng)
      if (event.type === 'hitWall') return { kind: 'bonk', until: ctx.now + BONK_DURATION_MS, fromLeft: event.fromLeft }
      if (event.type === 'timeout') {
        if (rng() < 0.5) {
          return { kind: 'wander', target: pickWanderTarget(ctx), until: ctx.now + WANDER_TIMEOUT_MS }
        }
        return makeIdle(ctx.now, rng)
      }
      return state
    }
    case 'dragging': {
      // 松手 → falling，初速 0
      if (event.type === 'release') return { kind: 'falling', vy: 0 }
      return state
    }
    case 'falling': {
      // 触底 → landed
      if (event.type === 'land') return { kind: 'landed', until: ctx.now + LANDED_DURATION_MS }
      return state
    }
    case 'landed': {
      if (event.type === 'timeout') return makeIdle(ctx.now, rng)
      return state
    }
    case 'bonk': {
      if (event.type === 'timeout') {
        // 回弹后概率回 idle 或反向 wander
        if (rng() < 0.5) {
          return { kind: 'wander', target: pickWanderTarget(ctx), until: ctx.now + WANDER_TIMEOUT_MS }
        }
        return makeIdle(ctx.now, rng)
      }
      return state
    }
  }
}

/** 判定 wander 是否到达目标（足够近） */
export function hasReachedTarget(position: Vec2, target: Vec2, threshold = 6): boolean {
  return Math.hypot(position.x - target.x, position.y - target.y) <= threshold
}

/** 判定当前是否该触发 timeout 事件（landed/bonk/idle/wander 有 until） */
export function isMotionTimedOut(state: PetMotionState, now: number): boolean {
  return 'until' in state ? now >= state.until : false
}

/**
 * 重力步进纯函数（M3-T4）。给定当前垂直速度、帧间隔、地面 Y，返回新位置与速度。
 * 带空气阻力（终端速度上限），下落姿态随速度变化由渲染层处理。
 *
 * 返回 { position: 新Y, vy: 新速度, landed: 是否触底 }。
 * 触底时把位置钳到 groundY，vy 归零，调用方据此发 land 事件。
 */
export function computeFallStep(
  currentY: number,
  vy: number,
  dtMs: number,
  groundY: number,
  gravity = 0.0018, // px/ms²
  terminalVelocity = 1.5 // px/ms 上限，防下落过快
): { y: number; vy: number; landed: boolean } {
  const newVy = Math.min(vy + gravity * dtMs, terminalVelocity)
  const newY = currentY + newVy * dtMs
  if (newY >= groundY) {
    return { y: groundY, vy: 0, landed: true }
  }
  return { y: newY, vy: newVy, landed: false }
}
