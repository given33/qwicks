import Bonjour from 'bonjour-service'

/**
 * LAN discovery via mDNS (RFC 001 §3).
 *
 * Each Mesh-enabled QWicks advertises a `_qwicks._tcp` service carrying a TXT
 * record with its deviceId, public-key fingerprint, protocol version, device
 * name and manifest version. Peers browse the same service type, parse the
 * TXT, and surface discovered devices to the pairing UI.
 *
 * The `Bonjour`-shaped dependency is injectable so discovery wiring can be
 * tested without real multicast I/O.
 */

export interface DiscoveryInfo {
  deviceId: string
  fingerprint: string
  protocolVersion: string
  deviceName: string
  manifestVersion: number
}

export interface DiscoveredPeer {
  deviceId: string
  fingerprint: string
  protocolVersion: string
  deviceName: string
  manifestVersion: number
  host: string
  port: number
}

const SERVICE_TYPE = 'qwicks'
const PROTOCOL_VERSION = '1'

export function buildDiscoveryTxt(info: DiscoveryInfo): Record<string, string> {
  return {
    dv: info.deviceId,
    fp: info.fingerprint,
    pv: info.protocolVersion,
    dn: encodeURIComponent(info.deviceName),
    mn: String(info.manifestVersion)
  }
}

export function parseDiscoveryTxt(txt: Record<string, string>): DiscoveryInfo | null {
  const deviceId = txt.dv
  const fingerprint = txt.fp
  const protocolVersion = txt.pv
  const deviceName = txt.dn ? decodeURIComponent(txt.dn) : undefined
  const manifestVersion = txt.mn !== undefined ? Number(txt.mn) : undefined
  if (!deviceId || !fingerprint || !protocolVersion || !deviceName || manifestVersion === undefined) {
    return null
  }
  if (Number.isNaN(manifestVersion)) return null
  if (protocolVersion !== PROTOCOL_VERSION) return null
  return { deviceId, fingerprint, protocolVersion, deviceName, manifestVersion }
}

interface BonjourService {
  stop: () => void
}
export interface BonjourLike {
  publish(opts: { name: string; type: string; port: number; txt: Record<string, string> }): BonjourService
  find(opts: { type: string }, onUp: (service: unknown) => void): BonjourService
}

interface BonjourServiceEvent {
  name?: string
  port: number
  addresses?: string[]
  txt?: Record<string, string>
}

export class MeshDiscovery {
  private readonly identity: DiscoveryInfo
  private readonly port: number
  private readonly selfDeviceId: string
  private readonly bonjour: BonjourLike
  private published?: BonjourService
  private browser?: BonjourService
  private started = false

  constructor(opts: {
    identity: DiscoveryInfo
    port: number
    selfDeviceId: string
    bonjour?: BonjourLike
  }) {
    this.identity = opts.identity
    this.port = opts.port
    this.selfDeviceId = opts.selfDeviceId
    this.bonjour = opts.bonjour ?? (new Bonjour() as unknown as BonjourLike)
  }

  start(onPeer: (peer: DiscoveredPeer) => void): void {
    if (this.started) return
    this.started = true
    this.published = this.bonjour.publish({
      name: `qwicks-${this.identity.deviceId.slice(0, 8)}`,
      type: SERVICE_TYPE,
      port: this.port,
      txt: buildDiscoveryTxt(this.identity)
    })
    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service: unknown) => {
      const parsed = this.toPeer(service as BonjourServiceEvent)
      if (parsed) onPeer(parsed)
    })
  }

  private toPeer(service: BonjourServiceEvent): DiscoveredPeer | null {
    if (!service.txt) return null
    const peer = parseDiscoveryTxt(service.txt)
    if (!peer) return null
    if (peer.deviceId === this.selfDeviceId) return null
    const host = service.addresses?.[0]
    if (!host) return null
    return { ...peer, host, port: service.port }
  }

  stop(): void {
    this.published?.stop()
    this.browser?.stop()
    this.published = undefined
    this.browser = undefined
    this.started = false
  }
}
