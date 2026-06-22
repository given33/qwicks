import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import { MeshPairInitiateRequest, MeshPairVerifyRequest } from '../../contracts/mesh.js'
import type { MeshRuntimeHandle } from '../../mesh/integration/mesh-runtime-handle.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * HTTP handlers for the mesh subsystem (RFC 000 §10).
 *
 * Every handler guards on `runtime.mesh` being present (503 when mesh is
 * disabled or failed to boot) and on the standard bearer-token auth applied at
 * the route registration site in `index.ts`.
 */

/** GET /v1/mesh/status — mesh enabled state, device id, transport port. */
export async function meshStatusResponse(mesh: MeshRuntimeHandle): Promise<JsonResponse> {
  return jsonResponse(mesh.status())
}

/** GET /v1/mesh/peers — paired peers with online/offline liveness. */
export async function meshPeersResponse(mesh: MeshRuntimeHandle): Promise<JsonResponse> {
  const peers = await mesh.peers()
  return jsonResponse({ peers })
}

/** GET /v1/mesh/models — models offered by remote peers (for UI injection). */
export async function meshModelsResponse(mesh: MeshRuntimeHandle): Promise<JsonResponse> {
  return jsonResponse({ models: mesh.models() })
}

/** GET /v1/mesh/pair/pending — pending pairing challenges seen by this device. */
export async function meshPendingPairingsResponse(mesh: MeshRuntimeHandle): Promise<JsonResponse> {
  return jsonResponse({ pending: mesh.pendingPairings() })
}

/** POST /v1/mesh/pair/initiate — start pairing to a responder by host:port. */
export async function meshPairInitiate(mesh: MeshRuntimeHandle, request: Request): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MeshPairInitiateRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid pair-initiate body', parsed.error.issues)
  }
  const result = await mesh.pairInitiate({ host: parsed.data.host, port: parsed.data.port })
  if (!result.accepted) {
    return ERRORS.conflict(`pairing rejected: ${result.reason ?? 'unknown'}`)
  }
  return jsonResponse({
    accepted: true,
    ...(result.responderDeviceId ? { responderDeviceId: result.responderDeviceId } : {}),
    ...(result.responderDeviceName ? { responderDeviceName: result.responderDeviceName } : {})
  })
}

/** POST /v1/mesh/pair/verify — submit the 6-digit code to complete pairing. */
export async function meshPairVerify(mesh: MeshRuntimeHandle, request: Request): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MeshPairVerifyRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid pair-verify body', parsed.error.issues)
  }
  const result = await mesh.pairVerify({ code: parsed.data.code })
  if (!result.verified) {
    return ERRORS.conflict(`pairing verify failed: ${result.reason ?? 'unknown'}`)
  }
  return jsonResponse({
    verified: true,
    ...(result.peerDeviceId ? { peerDeviceId: result.peerDeviceId } : {})
  })
}

/** 503 guard helper — returns either the mesh handle or an error marker.
 *  Callers check `result.kind === 'error'` to distinguish. */
export function requireMesh(runtime: ServerRuntime):
  | { kind: 'ok'; mesh: MeshRuntimeHandle }
  | { kind: 'error'; response: JsonResponse } {
  if (!runtime.mesh) return { kind: 'error', response: ERRORS.unavailable('mesh subsystem is not enabled') }
  return { kind: 'ok', mesh: runtime.mesh }
}
