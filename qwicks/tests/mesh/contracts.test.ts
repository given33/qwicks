import { describe, it, expect } from 'vitest'
import {
  Envelope,
  Manifest,
  TaskRunParams,
  ChildRunResult,
  PeerRecord,
  ProgressEvent
} from '../../src/mesh/contracts.js'

const baseEnvelope = {
  version: '1',
  from: 'd-aaa',
  to: 'd-bbb',
  messageId: 'm1',
  traceId: 't1',
  timestamp: '2026-06-22T00:00:00.000Z',
  nonce: 'n1',
  kind: 'task/run',
  payload: { taskId: 't1' },
  auth: { alg: 'hmac', sig: 'mac', deviceSig: 'sig' }
}

describe('mesh contracts', () => {
  describe('Envelope (RFC 000 §8.2 / 006 §4.1)', () => {
    it('parses a valid envelope with dual auth (sig + deviceSig)', () => {
      const r = Envelope.safeParse(baseEnvelope)
      expect(r.success).toBe(true)
    })

    it('rejects an envelope missing auth.deviceSig', () => {
      const r = Envelope.safeParse({ ...baseEnvelope, auth: { alg: 'hmac', sig: 'mac' } })
      expect(r.success).toBe(false)
    })

    it('rejects an envelope missing required header fields', () => {
      const { taskId: _drop, ...payloadNoTask } = baseEnvelope.payload
      const r = Envelope.safeParse({ ...baseEnvelope, from: undefined, payload: payloadNoTask })
      expect(r.success).toBe(false)
    })
  })

  describe('Manifest (RFC 005 §3)', () => {
    it('parses a minimal manifest with deviceId, models, tools, computeProfile', () => {
      const r = Manifest.safeParse({
        deviceId: 'd-bbb',
        deviceName: 'gpu-host',
        protocolVersion: '1',
        manifestVersion: 1,
        generatedAt: '2026-06-22T00:00:00.000Z',
        models: [
          {
            id: 'qwen2.5-7b',
            provider: 'local',
            contextWindow: 32768,
            maxOutput: 8192,
            supportsTools: true,
            supportsVision: false,
            available: true,
            version: '7b'
          }
        ],
        tools: [
          {
            name: 'fs.read',
            description: 'read a file',
            version: '1.0.0',
            ownerDevice: 'd-bbb',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'string' },
            riskLevel: 'none',
            requiresUserConfirm: false,
            readonly: true,
            discoverable: true,
            sides: ['worker']
          }
        ],
        prompts: [],
        resources: [],
        computeProfile: {
          canRunLocalModels: true
        },
        offeredPermissions: {
          memoryQuery: { allowed: false, maxTopK: 0, scopes: [] },
          toolCall: { allowedTools: [], deniedTools: [], maxRiskLevel: 'none' },
          resourceAccess: { allowedUris: [] },
          taskExecution: { maxConcurrent: 1, maxLeaseSeconds: 300 }
        }
      })
      expect(r.success).toBe(true)
    })
  })

  describe('TaskRunParams (RFC 002 §4.1)', () => {
    const valid = {
      taskId: 't1',
      parentThreadId: 'th1',
      parentTurnId: 'tn1',
      prompt: 'do thing',
      lease: { leaseTimeout: 300, heartbeatInterval: 75 },
      idempotencyKey: 'k1',
      retryCount: 0,
      maxRetries: 2,
      cancelToken: 'c1',
      provenance: ['d-aaa'],
      disableUserInput: true
    }

    it('accepts a minimal valid task payload', () => {
      expect(TaskRunParams.safeParse(valid).success).toBe(true)
    })

    it('rejects a payload missing lease', () => {
      const { lease: _l, ...noLease } = valid
      expect(TaskRunParams.safeParse(noLease).success).toBe(false)
    })

    it('rejects a payload missing idempotencyKey', () => {
      const { idempotencyKey: _k, ...noKey } = valid
      expect(TaskRunParams.safeParse(noKey).success).toBe(false)
    })

    it('rejects a payload missing provenance (cycle-detection requirement, RFC 007 §7)', () => {
      const { provenance: _p, ...noProv } = valid
      expect(TaskRunParams.safeParse(noProv).success).toBe(false)
    })
  })

  describe('ChildRunResult (RFC 002 §4.2)', () => {
    it('accepts a completed result', () => {
      const r = ChildRunResult.safeParse({
        summary: 'done',
        status: 'completed',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      })
      expect(r.success).toBe(true)
    })
  })

  describe('PeerRecord (RFC 001 §6)', () => {
    it('accepts a paired peer record', () => {
      const r = PeerRecord.safeParse({
        peerDeviceId: 'd-bbb',
        peerDeviceName: 'gpu-host',
        peerPublicKey: 'pk',
        peerFingerprint: '0123456789abcdef',
        pairedAt: '2026-06-22T00:00:00.000Z',
        lastSeenAt: '2026-06-22T00:00:00.000Z',
        trustLevel: 'standard',
        permissions: {}
      })
      expect(r.success).toBe(true)
    })
  })

  describe('ProgressEvent (RFC 002 §9)', () => {
    it('accepts a heartbeat event', () => {
      const r = ProgressEvent.safeParse({ kind: 'heartbeat' })
      expect(r.success).toBe(true)
    })

    it('rejects an unknown event kind', () => {
      const r = ProgressEvent.safeParse({ kind: 'bogus' })
      expect(r.success).toBe(false)
    })
  })
})
