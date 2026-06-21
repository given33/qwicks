import { describe, it, expect, vi } from 'vitest'
import {
  buildDiscoveryTxt,
  parseDiscoveryTxt,
  MeshDiscovery,
  type BonjourLike,
  type DiscoveredPeer
} from '@qwicks/mesh/discovery/mdns.js'

const info = {
  deviceId: 'd-aaa',
  fingerprint: '0123456789abcdef',
  protocolVersion: '1',
  deviceName: 'gpu-host',
  manifestVersion: 3
}

describe('mDNS TXT (RFC 001 §3.1)', () => {
  it('round-trips discovery info through TXT records', () => {
    const txt = buildDiscoveryTxt(info)
    expect(txt.dv).toBe('d-aaa')
    expect(txt.fp).toBe('0123456789abcdef')
    expect(txt.pv).toBe('1')
    expect(txt.dn).toBe('gpu-host')
    expect(txt.mn).toBe('3')
    const parsed = parseDiscoveryTxt(txt)
    expect(parsed).toEqual(expect.objectContaining(info))
  })

  it('returns null for a TXT missing required keys', () => {
    expect(parseDiscoveryTxt({ dv: 'd', fp: 'fp', pv: '1', dn: 'n' })).toBeNull() // no mn
    expect(parseDiscoveryTxt({ fp: 'fp', pv: '1', dn: 'n', mn: '1' })).toBeNull() // no dv
  })

  it('returns null for incompatible protocol version', () => {
    expect(parseDiscoveryTxt({ dv: 'd', fp: 'fp', pv: '2', dn: 'n', mn: '1' })).toBeNull()
  })

  it('URL-decodes the device name', () => {
    const txt = buildDiscoveryTxt({ ...info, deviceName: '我的 设备' })
    const parsed = parseDiscoveryTxt(txt)
    expect(parsed?.deviceName).toBe('我的 设备')
  })
})

/** A minimal fake of bonjour-service that captures the find callback and
 *  lets the test trigger discovered-service events via emit(). */
function fakeBonjour(): BonjourLike & { emit: (service: unknown) => void } {
  let onUp: ((service: unknown) => void) | null = null
  const stop = () => {}
  return {
    publish: () => ({ stop }),
    find: (_opts, cb) => {
      onUp = cb
      return { stop }
    },
    emit: (service: unknown) => {
      onUp?.(service)
    }
  }
}

describe('MeshDiscovery (RFC 001 §3, §4)', () => {
  it('advertises + browses, parses discovered peers, ignores self', () => {
    const bj = fakeBonjour()
    const discovery = new MeshDiscovery({
      identity: info,
      port: 47131,
      selfDeviceId: 'd-aaa',
      bonjour: bj
    })
    const onPeer = vi.fn()
    discovery.start(onPeer)

    // A foreign peer is discovered.
    bj.emit({
      name: 'qwicks-d-bbb',
      type: 'qwicks',
      port: 41000,
      addresses: ['192.168.1.5'],
      txt: buildDiscoveryTxt({ ...info, deviceId: 'd-bbb', deviceName: 'laptop', manifestVersion: 1 })
    })
    expect(onPeer).toHaveBeenCalledTimes(1)
    const peer: DiscoveredPeer = onPeer.mock.calls[0][0]
    expect(peer.deviceId).toBe('d-bbb')
    expect(peer.host).toBe('192.168.1.5')
    expect(peer.port).toBe(41000)

    // The advertiser's own service echoes back — must be ignored.
    bj.emit({
      name: 'qwicks-d-aaa',
      type: 'qwicks',
      port: 47131,
      addresses: ['192.168.1.4'],
      txt: buildDiscoveryTxt(info)
    })
    expect(onPeer).toHaveBeenCalledTimes(1)

    discovery.stop()
  })

  it('ignores a discovered peer with an incompatible protocol version', () => {
    const bj = fakeBonjour()
    const discovery = new MeshDiscovery({
      identity: info,
      port: 47131,
      selfDeviceId: 'd-aaa',
      bonjour: bj
    })
    const onPeer = vi.fn()
    discovery.start(onPeer)
    bj.emit({
      name: 'qwicks-d-bbb',
      type: 'qwicks',
      port: 41000,
      addresses: ['192.168.1.5'],
      txt: { dv: 'd-bbb', fp: 'fp', pv: '99', dn: 'laptop', mn: '1' }
    })
    expect(onPeer).not.toHaveBeenCalled()
    discovery.stop()
  })
})
