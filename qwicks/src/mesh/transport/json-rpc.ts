/**
 * JSON-RPC 2.0 codec (RFC 000 §8.1).
 *
 * Mesh frames every cross-device message as JSON-RPC over WebSocket. Requests
 * carry an `id` and await a response; notifications carry none and are
 * fire-and-forget (progress events, manifest/changed, etc.).
 */

export type JsonRpcId = string | number

export interface JsonRpcRequest {
  type: 'request'
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}
export interface JsonRpcResponse {
  type: 'response'
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}
export interface JsonRpcNotification {
  type: 'notification'
  jsonrpc: '2.0'
  method: string
  params?: unknown
}
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

const V = '2.0'

export function encodeJsonRpcRequest(id: JsonRpcId, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: V, id, method, ...(params !== undefined ? { params } : {}) })
}
export function encodeJsonRpcResponse(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: V, id, result })
}
export function encodeJsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: V, id, error: { code, message, ...(data !== undefined ? { data } : {}) } })
}
export function encodeJsonRpcNotification(method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: V, method, ...(params !== undefined ? { params } : {}) })
}

export function parseJsonRpcMessage(text: string): JsonRpcMessage | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  if (obj.jsonrpc !== V) return null
  if (typeof obj.method === 'string' && (obj.id === undefined || obj.id === null)) {
    return { type: 'notification', jsonrpc: V, method: obj.method, params: obj.params }
  }
  if (typeof obj.method === 'string' && (typeof obj.id === 'string' || typeof obj.id === 'number')) {
    return { type: 'request', jsonrpc: V, id: obj.id as JsonRpcId, method: obj.method, params: obj.params }
  }
  if (typeof obj.id === 'string' || typeof obj.id === 'number') {
    const err = obj.error as JsonRpcError | undefined
    return { type: 'response', jsonrpc: V, id: obj.id as JsonRpcId, result: obj.result, error: err }
  }
  return null
}
