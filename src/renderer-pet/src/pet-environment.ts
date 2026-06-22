/**
 * 桌面宠物 —— 环境与特效纯逻辑（M3-T7/T8）。
 *
 * 季节判定、天气权重、粒子初速度生成等可单测的逻辑集中在此。
 * 实际粒子渲染（Canvas/CSS）在 PetEnvironment.tsx，本模块只管"算"。
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Weather = 'sunny' | 'rain' | 'snow' | 'fog'

/** 按北半球月份判定季节（月从 0 起）。可注入 now 便于测试。 */
export function seasonForDate(date: Date): Season {
  const month = date.getMonth() + 1 // 1-12
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

/** 各季节的默认天气权重（越大约可能）。 */
export const SEASON_WEATHER_WEIGHTS: Record<Season, Record<Weather, number>> = {
  spring: { sunny: 0.5, rain: 0.4, snow: 0, fog: 0.1 },
  summer: { sunny: 0.8, rain: 0.15, snow: 0, fog: 0.05 },
  autumn: { sunny: 0.5, rain: 0.3, snow: 0, fog: 0.2 },
  winter: { sunny: 0.4, rain: 0.1, snow: 0.4, fog: 0.1 }
}

/** 按权重随机选天气。注入 random 便于测试。 */
export function pickWeather(season: Season, random: () => number = Math.random): Weather {
  const weights = SEASON_WEATHER_WEIGHTS[season]
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let r = random() * total
  for (const [weather, w] of Object.entries(weights)) {
    r -= w
    if (r <= 0) return weather as Weather
  }
  return 'sunny'
}

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number // 剩余生命 ms
  maxLife: number
  size: number
  rotation: number
  vr: number // 角速度
}

/**
 * 生成一组扬尘粒子（落地特效用）。
 * 从中心点向四周爆开，带初速度 + 重力 + 随机旋转。纯函数，注入 random 可测。
 */
export function spawnDustParticles(
  centerX: number,
  centerY: number,
  count: number,
  random: () => number = Math.random
): Particle[] {
  const particles: Particle[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2
    const speed = 0.3 + random() * 0.5
    const maxLife = 400 + random() * 300
    particles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed,
      vy: -Math.abs(Math.sin(angle) * speed) - 0.2, // 略向上
      life: maxLife,
      maxLife,
      size: 2 + random() * 3,
      rotation: random() * Math.PI * 2,
      vr: (random() - 0.5) * 0.2
    })
  }
  return particles
}

/**
 * 推进一步粒子（重力 + 衰减）。返回新粒子数组（filter 掉寿命结束的）。
 * 纯函数，dt 单位 ms。
 */
export function stepParticles(particles: Particle[], dtMs: number, gravity = 0.002): Particle[] {
  const next: Particle[] = []
  for (const p of particles) {
    const life = p.life - dtMs
    if (life <= 0) continue
    next.push({
      ...p,
      x: p.x + p.vx * dtMs,
      y: p.y + p.vy * dtMs,
      vy: p.vy + gravity * dtMs,
      rotation: p.rotation + p.vr * dtMs,
      life
    })
  }
  return next
}
