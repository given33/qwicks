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
        })
        ws.on('error', () => {
          this.clients.delete(ws)
        })
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
      this.wss.close(() => resolve())
    })
  }
}

export class MeshTransportClient {
  private ws?: WebSocket
  private seq = 0
  private readonly pending = new Map<JsonRpcIdLike, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)
      this.ws.on('open', () => resolve())
      this.ws.on('error', (err) => {
        // Reject any in-flight requests, then surface connect errors.
        for (const id of this.pending.keys()) this.failPending(id, err)
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
      })
    })
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
