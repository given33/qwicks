import { describe, it, expect } from 'vitest'
import { detectCycle, exceedsDepth, appendProvenance, canDispatchTo } from '@qwicks/mesh/roles/provenance.js'

describe('provenance (RFC 007 §7)', () => {
  it('detects a cycle when the target device is already in the chain', () => {
    expect(detectCycle(['d-a', 'd-b'], 'd-a')).toBe(true)
    expect(detectCycle(['d-a', 'd-b'], 'd-c')).toBe(false)
  })

  it('enforces a max chain depth', () => {
    expect(exceedsDepth(['d-a', 'd-b', 'd-c'], 5)).toBe(false)
    expect(exceedsDepth(['d-a', 'd-b', 'd-c', 'd-d', 'd-e', 'd-f'], 5)).toBe(true)
  })

  it('appends a device to the provenance chain immutably', () => {
    expect(appendProvenance(['d-a'], 'd-b')).toEqual(['d-a', 'd-b'])
  })

  it('canDispatchTo allows a fresh device within depth, blocks cycles and over-deep chains', () => {
    expect(canDispatchTo({ provenance: ['d-a', 'd-b'], targetDeviceId: 'd-c', maxDepth: 5 })).toBe(true)
    expect(canDispatchTo({ provenance: ['d-a', 'd-b'], targetDeviceId: 'd-a', maxDepth: 5 })).toBe(false) // cycle
    expect(canDispatchTo({ provenance: ['d-a', 'd-b', 'd-c', 'd-d', 'd-e'], targetDeviceId: 'd-f', maxDepth: 5 })).toBe(false) // depth 5→6
  })
})
