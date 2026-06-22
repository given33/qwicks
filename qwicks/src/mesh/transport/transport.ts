import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import {
  parseJsonRpcMessage,
  encodeJsonRpcResponse,
  encodeJsonRpcError,
  encodeJsonRpcRequest,
  type JsonRpcMessage,
  type JsonRpcError
} from './json-rpc.js'

/**
 * WebSocket transport (RFC 000 §8.1).
 *
 * `MeshTransportServer` listens on a port (0 = OS-assigned) and dispatches
 * decoded JSON-RPC messages to a handler, which replies with a result or an
 * error. `MeshTransportClient` connects, sends requests (awaiting responses by
 * id) and notifications. This layer carries frames; envelope signing/MAC and
 * replay protection are applied by the caller before send/after receive.
 */

export type Reply =
  | { result: unknown }
  | { error: JsonRpcError }

export class MeshTransportServer {
  private wss?: WebSocketServer
  private port = 0
  private readonly clients = new Set<WebSocket>()
  /** Optional observer for transport-layer events (connect/disconnect/error).
   *  Wired by `bootMesh` to surface diagnostics. Defaults to no-op. */
  onClientEvent: ((event: 'connect' | 'disconnect' | 'error', detail?: string) => void) | undefined

  async start(handler: (msg: JsonRpcMessage, reply: (r: Reply) => void) => void): Promise<{ port: number }> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: 0 })
      this.wss.on('listening', () => {
        const addr = this.wss!.address()
        this.port = typeof addr === 'object' && addr !== null ? (addr as { port: number }).port : 0
        resolve({ port: this.port })
      })
      this.wss.on('connection', (ws) => {
        this.clients.add(ws)
        this.onClientEvent?.('connect')
        ws.on('message', (data) => {
          const msg = parseJsonRpcMessage(String(data))
          if (!msg) return
          handler(msg, (r) => {
            if (msg.type !== 'request') return // no id → nothing to reply to
            const text =
              'result' in r ? encodeJsonRpcResponse(msg.id, r.result) : encodeJsonRpcError(msg.id, r.error.code, r.error.message)
            ws.send(text)
          })
        })
        ws.on('close', () => {
          this.clients.delete(ws)
          this.onClientEvent?.('disconnect')
        })
        ws.on('error', (err) => {
          this.clients.delete(ws)
          this.onClientEvent?.('error', err instanceof Error ? err.message : String(err))
        })
      })
      this.wss.on('error', (err) => {
        this.onClientEvent?.('error', `server: ${err instanceof Error ? err.message : String(err)}`)
      })
    })
  }

  /** Broadcast a JSON-RPC notification to all connected peers (RFC 006 §5.4). */
  broadcast(method: string, params?: unknown): void {
    const text = JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text)
      }
    }
  }

  /** Number of currently connected peers. */
  get clientCount(): number {
    return this.clients.size
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve()
      // Close every connected client socket first so peers detect the drop
      // promptly (otherwise they only learn via TCP keepalive timeout).
      for (const ws of this.clients) {
        try {
          ws.close()
        } catch {
          // best-effort
        }
      }
      this.clients.clear()
      this.wss.close(() => resolve())
    })
  }
}

export class MeshTransportClient {
  private ws?: WebSocket
  private seq = 0
  private readonly pending = new Map<JsonRpcIdLike, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  /** Fired when the underlying socket drops (close or error). The dispatch
   *  bridge uses this to trigger reconnection. */
  onDisconnected: (() => void) | undefined
  private disconnectedFired = false

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnectedFired = false
      this.ws = new WebSocket(url)
      this.ws.on('open', () => resolve())
      this.ws.on('error', (err) => {
        // Reject any in-flight requests, then surface connect errors.
        for (const id of this.pending.keys()) this.failPending(id, err)
        this.fireDisconnected()
        reject(err)
      })
      this.ws.on('message', (data) => {
        const msg = parseJsonRpcMessage(String(data))
        if (msg?.type !== 'response') return
        const id = String(msg.id) as JsonRpcIdLike
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        if (msg.error) entry.reject(msg.error)
        else entry.resolve(msg.result)
      })
      this.ws.on('close', () => {
        for (const id of this.pending.keys()) this.failPending(id, new Error('connection closed'))
        this.fireDisconnected()
      })
    })
  }

  private fireDisconnected(): void {
    if (this.disconnectedFired) return
    this.disconnectedFired = true
    try {
      this.onDisconnected?.()
    } catch {
      // observer errors must never propagate into the transport
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('socket not open'))
    }
    const id = this.nextId()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(encodeJsonRpcRequest(id, method, params))
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(
      JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })
    )
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws) return resolve()
      this.ws.on('close', () => resolve())
      this.ws.close()
    })
  }

  /** Whether the underlying socket is currently open and usable. */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private nextId(): JsonRpcIdLike {
    this.seq += 1
    return `${randomUUID()}-${this.seq}` as JsonRpcIdLike
  }

  private failPending(id: JsonRpcIdLike, err: unknown): void {
    const entry = this.pending.get(id)
    if (entry) {
      this.pending.delete(id)
      entry.reject(err)
    }
  }
}

type JsonRpcIdLike = string
