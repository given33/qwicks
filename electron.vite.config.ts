import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'fs'

function copyMqpetSpritesPlugin() {
  return {
    name: 'copy-mqpet-sprites',
    closeBundle(): void {
      cpSync(
        resolve('src/asset/img/mqpet/sprites'),
        resolve('out/renderer/assets/mqpet-sprites'),
        { recursive: true }
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'claw-schedule-mcp-node-entry': resolve('src/main/claw-schedule-mcp-node-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          mqpet: resolve('src/preload/mqpet.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@rendererMqpet': resolve('src/renderer-mqpet/src'),
        '@rendererMqconsole': resolve('src/renderer-mqconsole/src'),
        '@mqpetAssets': resolve('src/asset/img/mqpet'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // 多页：主窗口 index + MQPet(mqpet/mqconsole)。各 html 与其 renderer 源码同根。
        input: {
          index: resolve('src/renderer/index.html'),
          mqpet: resolve('src/renderer/mqpet.html'),
          mqconsole: resolve('src/renderer/mqconsole.html')
        }
      }
    },
    server: {
      // dev 模式允许访问项目根，使 mqpet.html 能引用 src/renderer-mqpet/ 下的 main.tsx
      fs: { allow: [resolve('.')] }
    },
    plugins: [react(), copyMqpetSpritesPlugin()]
  }
})
