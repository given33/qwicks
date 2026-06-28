import { readFile, stat, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 形象换皮：预装插件改用 MQPet 企鹅形象姿态帧。
import petWalkRef from '../asset/img/mqpet/ui-figures/walk.png?url'
import petWaveRef from '../asset/img/mqpet/ui-figures/wave.png?url'
import petSleepRef from '../asset/img/mqpet/ui-figures/sleep.png?url'
import petSitRef from '../asset/img/mqpet/ui-figures/sit.png?url'
import petStandRef from '../asset/img/mqpet/ui-figures/stand.png?url'
import { UI_PLUGIN_BUNDLED_IQWICKS_ID } from '../shared/ui-plugin'
import { seedUiPlugin, uiPluginsRootDir } from './services/ui-plugin-service'

/**
 * 预装 UI 插件:iQWicks 模式就是形象工坊的官方示例插件,
 * 首次启动时自动安装进 ~/.qwicks/ui-plugins/iqwicks/。
 * 安装只做一次(种子标记),用户删掉后不会被强行复活。
 *
 * 形象统一为 MQPet 企鹅形象。
 */

const BUNDLED_SEED_MARKER = '.bundled-seed-v2'

/**
 * iQWicks 的 manifest。注意:激活 id 为 'iqwicks' 的插件时,渲染层会额外点亮
 * data-iqwicks-mode 的手工 CSS 机制(暖黄氛围、动画变体),
 * 所以这里的 figures 主要服务于工坊预览与通用槽位兜底。
 */
const BUNDLED_IQWICKS_MANIFEST = {
  id: UI_PLUGIN_BUNDLED_IQWICKS_ID,
  name: 'iQWicks 模式',
  version: '1.0.0',
  author: 'QWicks Team',
  description: '预装示例形象:暖黄宠物全家福,附手工动画与出没彩蛋。',
  figures: {
    swim: 'img/walk.png',
    run: 'img/walk.png',
    greet: 'img/wave.png',
    sleep: 'img/sleep.png',
    sit: 'img/sit.png',
    toggleIcon: 'img/stand.png'
  },
  features: {
    cameos: true
  }
}

const BUNDLED_IQWICKS_FIGURE_REFS: Record<string, string> = {
  swim: petWalkRef,
  run: petWalkRef,
  greet: petWaveRef,
  sleep: petSleepRef,
  sit: petSitRef,
  toggleIcon: petStandRef
}

/** bundle 所在目录,用于把 ?url 的 /chunks/xxx.png 还原为真实文件路径 */
const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 资源引用在打包/开发下可能是:
 *   - data URL ("data:image/png;base64,...")  → 直接 base64 解码
 *   - Vite ?url 在主进程中的 web 路径 ("/chunks/xxx.png") → 相对 bundle 目录拼绝对路径
 */
async function bytesFromAssetRef(ref: string): Promise<Buffer> {
  if (ref.startsWith('data:')) {
    const base64 = ref.slice(ref.indexOf(',') + 1)
    return Buffer.from(base64, 'base64')
  }
  return readFile(join(BUNDLE_DIR, ref))
}

let seedPromise: Promise<void> | null = null

export function ensureBundledUiPlugins(qwicksHomeDir: string): Promise<void> {
  seedPromise ??= (async () => {
    const rootDir = uiPluginsRootDir(qwicksHomeDir)
    const markerPath = join(rootDir, BUNDLED_SEED_MARKER)
    try {
      await stat(markerPath)
      return
    } catch {
      // 尚未播种
    }
    let seeded = false
    try {
      const figureBytes: Record<string, Buffer> = {}
      for (const [slot, ref] of Object.entries(BUNDLED_IQWICKS_FIGURE_REFS)) {
        figureBytes[slot] = await bytesFromAssetRef(ref)
      }
      const result = await seedUiPlugin(qwicksHomeDir, BUNDLED_IQWICKS_MANIFEST, figureBytes)
      if (result.ok) {
        seeded = true
      } else {
        console.error('[ui-plugin] failed to seed bundled iqwicks plugin:', result.errors.join('; '))
      }
    } catch (error) {
      console.error('[ui-plugin] bundled seed error:', error)
    }
    // 只有成功播种才写标记,失败时下次启动允许重试
    if (seeded) {
      try {
        await mkdir(rootDir, { recursive: true })
        await writeFile(markerPath, 'iqwicks\n', 'utf8')
      } catch {
        // 标记写入失败可接受,下次会重试播种
      }
    }
  })()
  return seedPromise
}
