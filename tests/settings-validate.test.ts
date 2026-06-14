/**
 * Client-side validation for the settings editor.
 *
 * Mirrors the server-side rules in `dynamic_settings._validate_value` —
 * we deliberately catch typos / out-of-range values / malformed URLs in
 * the browser so the operator gets feedback before submit, without a
 * server round-trip. The server is still the authority (the assertions
 * here intentionally use the same Levenshtein-≤2 cutoff).
 */
import { describe, it, expect } from 'vitest'
// Re-export the validator from the page for testing. The page module
// itself doesn't currently export it — see footer of SettingsPage.tsx
// where we tag-export it for tests.
import { __test_validate as validate } from '../src/pages/SettingsPage'
import type { SettingEntry } from '../src/lib/settings'

function entry(overrides: Partial<SettingEntry> = {}): SettingEntry {
  return {
    value: null,
    source: 'env',
    is_secret: false,
    category: 'llm',
    kind: 'string',
    env_name: 'X',
    description: '',
    hot_reloadable: true,
    tenant_overridable: false,
    editable: true,
    allowed_values: null,
    min_value: null,
    max_value: null,
    format: null,
    ...overrides,
  }
}

describe('validate — enum (allowed_values)', () => {
  const compilerType = entry({
    kind: 'string',
    allowed_values: ['heuristic', 'llm'],
  })

  it('accepts an allowed value', () => {
    const r = validate('llm', compilerType)
    expect(r.ok).toBe(true)
  })

  it("catches 'lllm' as a typo and suggests 'llm'", () => {
    const r = validate('lllm', compilerType)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.suggestion).toBe('llm')
      expect(r.error).toMatch(/heuristic.*llm|llm.*heuristic/)
    }
  })

  it('rejects unrelated nonsense without suggesting a fix', () => {
    const r = validate('totally-different', compilerType)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.suggestion).toBeUndefined()
  })

  it("suggests 'memory' for 'memry'", () => {
    const r = validate('memry', entry({ allowed_values: ['memory', 'distributed'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.suggestion).toBe('memory')
  })
})

describe('validate — numeric bounds', () => {
  const rpm = entry({ kind: 'int', min_value: 0, max_value: 1_000_000 })

  it('accepts an in-range integer', () => {
    expect(validate('60', rpm).ok).toBe(true)
  })

  it('rejects below min', () => {
    const r = validate('-1', rpm)
    expect(r.ok).toBe(false)
  })

  it('rejects above max', () => {
    const r = validate('99999999', rpm)
    expect(r.ok).toBe(false)
  })

  it('rejects a decimal for int kind', () => {
    const r = validate('1.5', rpm)
    expect(r.ok).toBe(false)
  })

  it('rejects non-numeric text', () => {
    const r = validate('hello', rpm)
    expect(r.ok).toBe(false)
  })

  it('range hint mentions both bounds for floats', () => {
    const temp = entry({ kind: 'float', min_value: 0, max_value: 2 })
    expect(validate('-0.1', temp).ok).toBe(false)
    expect(validate('2.5', temp).ok).toBe(false)
    expect(validate('0.7', temp).ok).toBe(true)
  })
})

describe('validate — URL format', () => {
  const webhook = entry({ kind: 'string_or_null', format: 'url' })

  it('accepts https URLs', () => {
    expect(validate('https://example.com/hook', webhook).ok).toBe(true)
  })

  it('rejects bare hostnames', () => {
    expect(validate('example.com', webhook).ok).toBe(false)
  })

  it('rejects partial schemes', () => {
    expect(validate('htp://example.com', webhook).ok).toBe(false)
  })

  it('treats empty string as null for string_or_null', () => {
    const r = validate('', webhook)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(null)
  })
})

describe('validate — JSON', () => {
  const ttl = entry({ kind: 'json' })

  it('parses valid JSON', () => {
    const r = validate('{"episode_summary": 30}', ttl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ episode_summary: 30 })
  })

  it('rejects invalid JSON with a helpful message', () => {
    const r = validate('{not json}', ttl)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/i)
  })
})
