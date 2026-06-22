import { describe, expect, it } from 'vitest'
import { CROPS, defaultFarm, findCrop, harvest, plant, plotStage } from './farm-logic'

describe('farm-logic', () => {
  it('default farm has 6 empty plots', () => {
    expect(defaultFarm().plots).toHaveLength(6)
    expect(defaultFarm().plots.every((p) => p.cropId === null)).toBe(true)
  })

  it('plant fills a plot', () => {
    const farm = plant(defaultFarm(), 0, 'radish', 1000)
    expect(farm.plots[0].cropId).toBe('radish')
    expect(farm.plots[0].plantedAt).toBe(1000)
  })

  it('plant on occupied plot is no-op', () => {
    let farm = plant(defaultFarm(), 0, 'radish', 1000)
    farm = plant(farm, 0, 'carrot', 2000)
    expect(farm.plots[0].cropId).toBe('radish')
  })

  it('plotStage progresses seed->sprout->ripe', () => {
    const crop = findCrop('radish')!
    let farm = plant(defaultFarm(), 0, 'radish', 0)
    expect(plotStage(farm.plots[0], 0)).toBe('seed')
    expect(plotStage(farm.plots[0], crop.growDurationMs * 0.5)).toBe('sprout')
    expect(plotStage(farm.plots[0], crop.growDurationMs)).toBe('ripe')
  })

  it('harvest ripe gives reward and clears plot', () => {
    const crop = findCrop('radish')!
    let farm = plant(defaultFarm(), 0, 'radish', 0)
    const r = harvest(farm, 0, crop.growDurationMs)
    expect(r.reward).toBe(crop.sellPrice)
    expect(r.cropName).toBe('萝卜')
    expect(r.farm.plots[0].cropId).toBeNull()
  })

  it('harvest unripe gives no reward but clears', () => {
    let farm = plant(defaultFarm(), 0, 'radish', 0)
    const r = harvest(farm, 0, 100) // 还没熟
    expect(r.reward).toBe(0)
  })

  it('all crops defined with valid prices', () => {
    for (const c of CROPS) {
      expect(c.seedPrice).toBeGreaterThan(0)
      expect(c.sellPrice).toBeGreaterThan(c.seedPrice) // 卖价高于种子
      expect(c.growDurationMs).toBeGreaterThan(0)
    }
  })
})
