/**
 * 桌面宠物 —— 跟随鼠标视线（M1-T10 桌面感知）。
 *
 * idle 时宠物头部朝鼠标方向轻微旋转，营造"它注意到你了"的活物感。
 * 角度按"精灵中心 → 鼠标"的向量算，并限幅避免头部转过头。
 * 纯函数，可单测。
 */

export type Vec2 = { x: number; y: number }

/**
 * 计算从 from 指向 to 的角度（度），y 轴向下为正（屏幕坐标系）。
 * 返回 [-180, 180]。
 */
export function angleBetween(from: Vec2, to: Vec2): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

/**
 * 把角度限幅到 [-maxAbs, maxAbs]，超出则钳到边界。
 * 宠物头部只应小幅转动（比如 ±12°），避免整个翻转。
 */
export function clampAngle(angle: number, maxAbs: number): number {
  if (angle > maxAbs) return maxAbs
  if (angle < -maxAbs) return -maxAbs
  return angle
}

/**
 * 给定精灵（眼睛）位置和鼠标位置，算头部旋转角度（度）。
 * x 轴方向映射成俯仰感的"左右偏头"：鼠标在右→头顺时针微转。
 * 这里用水平偏移主导角度（atan2(dy, dx) 但只取水平分量做旋转量），
 * 让宠物主要"侧头看"而非"上下点头"，更自然。
 *
 * maxTilt 限制最大偏转角（默认 12°）。
 */
export function computeGazeTilt(eye: Vec2, mouse: Vec2, maxTilt = 12): number {
  const dx = mouse.x - eye.x
  // 用水平距离归一化，越远偏转越接近 maxTilt 但平滑趋近（sigmoid 感）
  const sign = dx >= 0 ? 1 : -1
  const magnitude = Math.min(1, Math.abs(dx) / 300)
  return sign * magnitude * maxTilt
}
