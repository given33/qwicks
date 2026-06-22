/**
 * 生成暖黄形象占位精灵图（M2 临时资产）。
 *
 * 真实暖黄形象精灵图由用户提供后会替换此文件。在拿到原图前，
 * 用这张占位图让裁切脚本、atlas 映射、petFrame()、所有引用替换都能跑通。
 *
 * 9 行姿态：stand / walk / sit / wave / talk / sad / sleep / think / wonder。
 * 用 jimp 1.x API 生成。
 */
const { Jimp } = require('jimp')
const { mkdirSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')

const FRAME_W = 96
const FRAME_H = 120
// #f5c451 → 0xF5C451FF (RGBA)
const BODY_COLOR = 0xf5c451ff
const EYE_COLOR = 0x3c2814ff
const OUT_DIR = resolve(__dirname, '../src/asset/img/pet')

const POSES = ['stand', 'walk', 'sit', 'wave', 'talk', 'sad', 'sleep', 'think', 'wonder']
// 不同姿态的眼睛 Y 偏移（让预览页能区分）
const EYE_Y = [50, 48, 58, 47, 45, 62, 64, 52, 50]

function makeFrame(pose, index) {
  const img = new Jimp({ width: FRAME_W, height: FRAME_H, color: 0x00000000 })
  const eyeY = EYE_Y[index] ?? 50
  const cx = FRAME_W / 2
  const cy = FRAME_H * 0.55
  const rx = FRAME_W * 0.42
  const ry = FRAME_H * 0.38
  for (let y = 0; y < FRAME_H; y += 1) {
    for (let x = 0; x < FRAME_W; x += 1) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) {
        img.setPixelColor(BODY_COLOR, x, y)
      }
    }
  }
  // 眼睛
  for (const ex of [38, 39, 58, 59]) {
    img.setPixelColor(EYE_COLOR, ex, eyeY)
    img.setPixelColor(EYE_COLOR, ex, eyeY + 1)
  }
  return img
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (let i = 0; i < POSES.length; i += 1) {
    const img = makeFrame(POSES[i], i)
    const buf = await img.getBuffer('image/png')
    await writeFile(resolve(OUT_DIR, `${POSES[i]}.png`), buf)
    console.log('wrote', POSES[i] + '.png')
  }
  // 合并 atlas（供裁切脚本测试）
  const atlas = new Jimp({ width: FRAME_W, height: FRAME_H * POSES.length, color: 0x00000000 })
  for (let i = 0; i < POSES.length; i += 1) {
    const frame = makeFrame(POSES[i], i)
    atlas.composite(frame, 0, i * FRAME_H)
  }
  const atlasBuf = await atlas.getBuffer('image/png')
  await writeFile(resolve(OUT_DIR, 'pet-atlas.png'), atlasBuf)
  console.log('wrote pet-atlas.png')

  // 托盘/窗口图标占位（用 stand 帧）
  const tray = makeFrame('stand', 0)
  const trayBuf = await tray.getBuffer('image/png')
  await writeFile(resolve(OUT_DIR, 'pet_mac.png'), trayBuf)
  await writeFile(resolve(OUT_DIR, 'pet_tray.png'), trayBuf)
  console.log('wrote pet_mac.png, pet_tray.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
