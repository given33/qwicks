import { describe, it, expect } from 'vitest'
import { SkillManifest } from './skill-runtime.js'

describe('SkillManifest configSchema', () => {
  it('parses a manifest without configSchema (backwards compatible)', () => {
    const parsed = SkillManifest.parse({
      name: 'demo',
      version: '1.0.0',
      entry: 'SKILL.md',
      triggers: { commands: [], promptPatterns: [], fileTypes: [] },
      allowedTools: []
    })
    expect(parsed.configSchema).toBeUndefined()
  })

  it('parses a manifest with a configSchema', () => {
    const parsed = SkillManifest.parse({
      name: 'demo',
      configSchema: {
        fields: [
          { key: 'apiKey', type: 'secret', label: 'API Key', required: true, settingsPath: 'a.b.apiKey' },
          { key: 'model', type: 'string', label: 'Model', required: false, default: 'gpt' },
          { key: 'count', type: 'number', label: 'Count', required: false, default: 3 },
          { key: 'enabled', type: 'boolean', label: 'Enabled', required: false, default: false },
          {
            key: 'proto',
            type: 'enum',
            label: 'Protocol',
            required: false,
            options: [{ value: 'a', label: 'A' }]
          }
        ]
      }
    })
    expect(parsed.configSchema?.fields).toHaveLength(5)
    expect(parsed.configSchema?.fields[0]?.type).toBe('secret')
    expect(parsed.configSchema?.fields[0]?.settingsPath).toBe('a.b.apiKey')
    expect(parsed.configSchema?.fields[3]?.default).toBe(false)
  })

  it('rejects an invalid field type', () => {
    expect(() => SkillManifest.parse({
      name: 'demo',
      configSchema: { fields: [{ key: 'x', type: 'bogus', label: 'X' }] }
    })).toThrow()
  })

  it('rejects an unknown top-level field (strict)', () => {
    expect(() => SkillManifest.parse({
      name: 'demo',
      bogusTopLevel: true
    })).toThrow()
  })

  it('rejects an unknown field inside a config field (strict)', () => {
    expect(() => SkillManifest.parse({
      name: 'demo',
      configSchema: { fields: [{ key: 'x', type: 'string', label: 'X', bogus: true }] }
    })).toThrow()
  })
})
