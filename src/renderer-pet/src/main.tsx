/**
 * 桌面宠物渲染层入口（M1）。
 *
 * 这是 petWindow 加载的独立 React 应用，与主窗口（AI 工作流）完全解耦：
 * 主窗口崩溃/重载/关闭不影响宠物（后台保活见 M1-T7）。
 *
 * 当前 M1 最小实现：渲染一个占位暖黄精灵 + 点击穿透热区切换（验证 R2）。
 * 漫步引擎（M1-T6）、物理交互（M3）、属性表情（M4）后续在此基础上扩展。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PetStage } from './PetStage'

const container = document.getElementById('root')
if (!container) throw new Error('pet renderer root not found')

createRoot(container).render(
  <StrictMode>
    <PetStage />
  </StrictMode>
)
