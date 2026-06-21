import { describe, it, expect, afterEach } from 'vitest'
import {
  encodeJsonRpcRequest,
  encodeJsonRpcResponse,
  encodeJsonRpcError,
  encodeJsonRpcNotification,
  parseJsonRpcMessage
} from '@qwicks/mesh/transport/json-rpc.js'
import { MeshTransportServer, MeshTransportClient } from '@qwicks/mesh/transport/transport.js'

describe('JSON-RPC 2.0 codec', () => {
  it('round-trips a request', () => {
    const text = encodeJsonRpcRequest('1', 'task/run', { taskId: 't1' })
    const msg = parseJsonRpcMessage(text)
    expect(msg?.type).toBe('request')
    if (msg?.type === 'request') {
      expect(msg.id).toBe('1')
      expect(msg.method).toBe('task/run')
      expect(msg.params).toEqual({ taskId: 't1' })
    }
  })

  it('round-trips a response and a notification', () => {
    const resp = parseJsonRpcMessage(encodeJsonRpcResponse('1', { ok: true }))
    expect(resp?.type).toBe('response')
    if (resp?.type === 'response') expect(resp.result).toEqual({ ok: true })

    const note = parseJsonRpcMessage(encodeJsonRpcNotification('task/progress', { seq: 1 }))
    expect(note?.type).toBe('notification')
    if (note?.type === 'notification') expect(note.method).toBe('task/progress')
  })

  it('parses an error response', () => {
    const msg = parseJsonRpcMessage(encodeJsonRpcError('1', -32002, 'unauthorized'))
    if (msg?.type === 'response') {
      expect(msg.error?.code).toBe(-32002)
      expect(msg.error?.message).toBe('unauthorized')
    }
  })

  it('rejects non-2.0 and malformed frames', () => {
    expect(parseJsonRpcMessage('not json')).toBeNull()
    expect(parseJsonRpcMessage(JSON.stringify({ jsonrpc: '1.0', method: 'x' }))).toBeNull()
  })
})

describe('MeshTransport loopback (RFC 000 §8.1)', () => {
  const servers: MeshTransportServer[] = []
  const clients: MeshTransportClient[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})))
    await Promise.all(servers.splice(0).map((s) => s.stop().catch(() => {})))
  })

  it('routes a request/response round-trip over a real loopback socket', async () => {
    const server = new MeshTransportServer()
    servers.push(server)
    const { port } = await server.start((msg, reply) => {
      if (msg.type === 'request' && msg.method === 'ping') {
        reply({ result: { pong: true } })
      }
    })

    const client = new MeshTransportClient()
    clients.push(client)
    await client.connect(`ws://127.0.0.1:${port}`)

    const result = await client.request('ping', { hello: 'mesh' })
    expect(result).toEqual({ pong: true })
  })

  it('delivers notifications without expecting a response', async () => {
    let receivedMethod = ''
    const server = new MeshTransportServer()
    servers.push(server)
    const { port } = await server.start((msg) => {
      if (msg.type === 'notification') receivedMethod = msg.method
    })

    const client = new MeshTransportClient()
    clients.push(client)
    await client.connect(`ws://127.0.0.1:${port}`)
    client.notify('task/progress', { seq: 7 })

    // Poll briefly for the notification to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(receivedMethod).toBe('task/progress')
  })

  it('surfaces a JSON-RPC error from the server as a rejected request', async () => {
    const server = new MeshTransportServer()
    servers.push(server)
    const { port } = await server.start((_msg, reply) => {
      reply({ error: { code: -32002, message: 'unauthorized' } })
    })

    const client = new MeshTransportClient()
    clients.push(client)
    await client.connect(`ws://127.0.0.1:${port}`)
    await expect(client.request('whatever', {})).rejects.toMatchObject({ code: -32002 })
  })
})
