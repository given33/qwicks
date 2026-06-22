import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildVectorDb } from './registry.js'

describe('buildVectorDb registry', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dream-vec-reg-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('builds a flat index by default', () => {
    const db = buildVectorDb({ backend: 'flat', dim: 4, persistDir: dir })
    expect(db.name()).toBe('dream.flat-vector.v1')
    expect(db.dim()).toBe(4)
  })

  it('builds an ivf index', () => {
    const db = buildVectorDb({ backend: 'ivf', dim: 4, nlist: 4 })
    expect(db.name()).toBe('dream.ivf-vector.v1')
  })

  it('throws on an unknown backend', () => {
    expect(() => buildVectorDb({ backend: 'faiss' as never, dim: 4, persistDir: dir })).toThrow(
      /unknown vectordb backend/
    )
  })
})
