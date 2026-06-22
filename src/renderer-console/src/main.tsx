/**
 * 宠物控制台渲染入口（M4-T7）。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConsoleApp } from './ConsoleApp'

const container = document.getElementById('root')
if (!container) throw new Error('console root not found')

createRoot(container).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>
)
