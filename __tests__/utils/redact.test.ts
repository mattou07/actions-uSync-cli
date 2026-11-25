import { describe, expect, it } from '@jest/globals'
import { redactSecrets } from '../../src/utils/redact.js'

describe('redactSecrets', () => {
  it.each(['access_token', 'refresh_token', 'id_token', 'client_secret'])(
    'redacts a JSON %s value',
    (key) => {
      const out = redactSecrets(`{"${key}": "abc.def-123", "other": "keep"}`)
      expect(out).toBe(`{"${key}": "[REDACTED]", "other": "keep"}`)
    }
  )

  it('redacts JSON values containing escaped quotes', () => {
    const out = redactSecrets('{"client_secret":"a\\"b\\\\c","x":1}')
    expect(out).toBe('{"client_secret":"[REDACTED]","x":1}')
    expect(out).not.toContain('a\\"b')
  })

  it('redacts form encoded values, stopping at &', () => {
    expect(
      redactSecrets(
        'grant_type=client_credentials&client_id=umbraco-back-office-x&client_secret=s3cr%3Det&b=2'
      )
    ).toBe(
      'grant_type=client_credentials&client_id=umbraco-back-office-x&client_secret=[REDACTED]&b=2'
    )
  })

  it('redacts Bearer tokens in any case', () => {
    expect(redactSecrets('Authorization: Bearer abc.DEF_123-x=')).toBe(
      'Authorization: Bearer [REDACTED]'
    )
    expect(redactSecrets('got bearer   tok123 here')).toBe(
      'got Bearer [REDACTED] here'
    )
  })

  it('leaves unrelated text unchanged', () => {
    const text = '{"error":"invalid_client","error_description":"bad"}'
    expect(redactSecrets(text)).toBe(text)
  })
})
