import { describe, expect, it } from 'vitest'
import { canReportMemoryData } from './data-control.js'

describe('canReportMemoryData (Batch F)', () => {
  it('default-off: both false → cannot report for improvement or training', () => {
    expect(canReportMemoryData({ allowModelImprovement: false, allowTraining: false }, 'improvement')).toBe(false)
    expect(canReportMemoryData({ allowModelImprovement: false, allowTraining: false }, 'training')).toBe(false)
  })
  it('improvement allowed but training off → improvement yes, training no', () => {
    const s = { allowModelImprovement: true, allowTraining: false }
    expect(canReportMemoryData(s, 'improvement')).toBe(true)
    expect(canReportMemoryData(s, 'training')).toBe(false)
  })
  it('both on → both yes', () => {
    const s = { allowModelImprovement: true, allowTraining: true }
    expect(canReportMemoryData(s, 'improvement')).toBe(true)
    expect(canReportMemoryData(s, 'training')).toBe(true)
  })
})
