import { describe, expect, it } from 'vitest'
import {
  matchCanClear,
  paopaoFindMatches,
  rpsJudge,
  rpsRandom,
  ropeJudge,
  scoreToCoins,
  tower100Advance,
  whackJudge,
  whackSpawn
} from './minigame-logic'

describe('rps', () => {
  it('judges win/lose/draw', () => {
    expect(rpsJudge('rock', 'scissors')).toBe('win')
    expect(rpsJudge('rock', 'paper')).toBe('lose')
    expect(rpsJudge('rock', 'rock')).toBe('draw')
  })
  it('random returns valid choice', () => {
    expect(['rock', 'paper', 'scissors']).toContain(rpsRandom())
  })
})

describe('whack', () => {
  it('hit when clicking mole position', () => {
    expect(whackJudge([1, 3], 3)).toEqual({ hit: true, score: 1 })
    expect(whackJudge([1, 3], 0)).toEqual({ hit: false, score: 0 })
  })
  it('spawn returns valid indices', () => {
    const moles = whackSpawn(9)
    for (const m of moles) expect(m).toBeGreaterThanOrEqual(0)
    expect(moles.length).toBeGreaterThan(0)
  })
})

describe('rope', () => {
  it('perfect within half window', () => {
    expect(ropeJudge(1000, 1000).result).toBe('perfect')
    expect(ropeJudge(1000, 1050).result).toBe('perfect')
  })
  it('good within window', () => {
    expect(ropeJudge(1000, 1200).result).toBe('good')
  })
  it('miss outside window', () => {
    expect(ropeJudge(1000, 1500).result).toBe('miss')
  })
})

describe('paopao', () => {
  it('finds horizontal 3-match', () => {
    const grid = ['r', 'r', 'r', 'b', 'b', 'b']
    const m = paopaoFindMatches(grid, 3)
    expect(m.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('finds vertical 3-match', () => {
    const grid = ['r', 'b', 'r', 'b', 'r', 'b']
    const m = paopaoFindMatches(grid, 2)
    expect(m).toContain(0)
    expect(m).toContain(2)
    expect(m).toContain(4)
  })
  it('no match for isolated', () => {
    const grid = ['r', 'b', 'g', 'r', 'b', 'g']
    expect(paopaoFindMatches(grid, 3)).toHaveLength(0)
  })
})

describe('match (连连看)', () => {
  it('same symbol can clear', () => {
    expect(matchCanClear(['a', 'b', 'a'], 0, 2)).toBe(true)
    expect(matchCanClear(['a', 'b', 'a'], 0, 1)).toBe(false)
  })
})

describe('tower100', () => {
  it('advance on success, retreat on fail', () => {
    expect(tower100Advance(5, true)).toBe(6)
    expect(tower100Advance(5, false)).toBe(4)
    expect(tower100Advance(0, false)).toBe(0) // 不负
  })
})

describe('scoreToCoins', () => {
  it('converts score to coins (x2, floored)', () => {
    expect(scoreToCoins(5)).toBe(10)
    expect(scoreToCoins(0)).toBe(0)
    expect(scoreToCoins(-1)).toBe(0)
  })
})
