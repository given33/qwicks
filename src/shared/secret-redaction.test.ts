import { describe, expect, it } from 'vitest'
import { redactSecrets, redactSecretText } from './secret-redaction'

describe('secret redaction', () => {
  it('redacts secret-like object keys recursively', () => {
    expect(redactSecrets({
      apiKey: 'sk-test',
      nested: { Authorization: 'Bearer token-value' },
      safe: 'visible'
    })).toEqual({
      apiKey: '<redacted>',
      nested: { Authorization: '<redacted>' },
      safe: 'visible'
    })
  })

  it('redacts inline bearer and token text', () => {
    expect(redactSecretText('Authorization: Bearer abc123 token=secret-value')).toBe(
      'Authorization: Bearer <redacted> token=<redacted>'
    )
  })

  it('redacts secret fields embedded in JSON-like text', () => {
    expect(redactSecretText('{"apiKey":"sk-test","OPENAI_API_KEY":"env-secret"}')).toBe(
      '{"apiKey":"<redacted>","OPENAI_API_KEY":"<redacted>"}'
    )
  })
})
