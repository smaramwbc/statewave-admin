/**
 * Secret redaction tests.
 */
import { describe, it, expect } from 'vitest'
import { redactString, redactValue } from '../server/self-healing-eval/redact'

describe('redactString', () => {
  it('redacts OpenAI keys', () => {
    const out = redactString('use sk-1234567890abcdef1234 in your call')
    expect(out).not.toContain('sk-1234567890abcdef1234')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts Anthropic keys', () => {
    const out = redactString('Authorization: x-api-key sk-ant-abcdefghij1234567890')
    expect(out).not.toContain('sk-ant-abcdefghij1234567890')
  })

  it('redacts Bearer tokens', () => {
    const out = redactString('Authorization: Bearer abcdefghij1234567890')
    expect(out).not.toContain('abcdefghij1234567890')
  })

  it('redacts Postgres credentials in URLs', () => {
    const out = redactString('postgres://user:secret@localhost:5432/db')
    expect(out).not.toContain('user:secret@')
  })

  it('redacts api_key=... and "api_key": "..." patterns', () => {
    expect(redactString('api_key=abcdefghij1234')).toContain('[REDACTED]')
    expect(redactString('"api_key": "abcdefghij1234"')).toContain('[REDACTED]')
  })
})

describe('redactValue', () => {
  it('redacts known secret keys in nested objects', () => {
    const v = {
      llm: { api_key: 'sk-abcd', model: 'gpt' },
      headers: { Authorization: 'Bearer xyz', 'Content-Type': 'application/json' },
      arr: [{ webhook_secret: 'topsecret' }],
      safe: 'keep me',
    }
    const out = redactValue(v) as typeof v
    expect(out.llm.api_key).toBe('[REDACTED]')
    expect(out.llm.model).toBe('gpt')
    // Authorization header value contains a Bearer token; the value is
    // wholesale redacted because the key name matches the secret hint.
    expect(out.headers.Authorization).toBe('[REDACTED]')
    expect(out.arr[0].webhook_secret).toBe('[REDACTED]')
    expect(out.safe).toBe('keep me')
  })

  it('passes through null/undefined/numbers/booleans unchanged', () => {
    expect(redactValue(null)).toBeNull()
    expect(redactValue(undefined)).toBeUndefined()
    expect(redactValue(42)).toBe(42)
    expect(redactValue(true)).toBe(true)
  })
})
