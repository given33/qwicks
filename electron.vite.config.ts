import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'app-main': resolve('src/main/app-main.ts'),
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
          pet: resolve('src/preload/pet.ts')
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
        '@rendererPet': resolve('src/renderer-pet/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // 多页：主窗口 index + 桌面宠物 pet。两个 html 都在 src/renderer/（renderer root 内），
        // 避免 vite 用相对路径 emit 导致 rollup 报错。pet 源码在 src/renderer-pet/src，经 alias 引用。
        input: {
          index: resolve('src/renderer/index.html'),
          pet: resolve('src/renderer/pet.html')
        }
      }
    },
    plugins: [react()]
  }
})
