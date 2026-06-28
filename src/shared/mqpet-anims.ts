// src/shared/mqpet-anims.ts
// 动画时间轴数据。JSON 文件由 tools/mqpet-convert/convert_anims.py 生成，
// 运行时通过 import.meta.glob 加载（electron-vite/Vite 原生支持）。
//
// NOTE: glob uses a relative path from this module so it resolves identically
// in dev and build (Vite resolves import.meta.glob relative to the importing
// module's directory).

export interface MqAnimFrame {
  sprite: string; // filename under sprites/
  duration_ms: number;
}
export interface MqAnim {
  name: string;
  fps: number;
  loop: boolean;
  frames: MqAnimFrame[];
}

// Relative to src/shared/ -> ../asset/img/mqpet/anims/
const modules = import.meta.glob('../asset/img/mqpet/anims/*.json', { eager: true, import: 'default' }) as
  Record<string, MqAnim>;

const ANIMS: Record<string, MqAnim> = {};
for (const [path, anim] of Object.entries(modules)) {
  const name = path.split('/').pop()!.replace(/\.json$/, '');
  ANIMS[name] = anim;
}

export function getAnim(name: string): MqAnim | undefined {
  return ANIMS[name];
}

export function listAnimNames(): string[] {
  return Object.keys(ANIMS);
}

