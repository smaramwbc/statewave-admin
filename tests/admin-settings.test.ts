/**
 * Tests for the admin-server's own settings — ADMIN_PASSWORD and
 * STATEWAVE_API_KEY — including the Windows-resolution-style revert
 * pattern.
 *
 * The pattern is the WHOLE point of this surface: an operator who
 * types the wrong password should get the previous one back after the
 * timer expires, without anyone having to SSH into the box. If a
 * future refactor breaks the auto-revert, these tests fail loudly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyPending,
  confirmPending,
  revertPending,
  currentState,
  loadPersistedSecretsAtStartup,
  _resetForTests,
} from '../server/admin-settings'
import { _resetStoreForTests } from '../server/admin-secrets-store'

const ORIG_PASSWORD = 'before-edit'
const ORIG_API_KEY = 'sk-orig'

beforeEach(() => {
  vi.useFakeTimers()
  _resetForTests()
  process.env.ADMIN_PASSWORD = ORIG_PASSWORD
  process.env.STATEWAVE_API_KEY = ORIG_API_KEY
})

afterEach(() => {
  vi.useRealTimers()
  _resetForTests()
  delete process.env.ADMIN_PASSWORD
  delete process.env.STATEWAVE_API_KEY
})

describe('applyPending', () => {
  it('applies the new value to process.env immediately', () => {
    applyPending('admin_password', 'new-password')
    expect(process.env.ADMIN_PASSWORD).toBe('new-password')
  })

  it('treats empty string as unset', () => {
    applyPending('statewave_api_key', '')
    expect(process.env.STATEWAVE_API_KEY).toBeUndefined()
  })

  it('records a pending change with a countdown', () => {
    applyPending('admin_password', 'new-password', 60_000)
    const state = currentState()
    expect(state.pending?.field).toBe('admin_password')
    expect(state.pending?.revert_in_seconds).toBeGreaterThan(50)
  })

  it('reports admin_password_set after a non-empty change', () => {
    applyPending('admin_password', 'new-password')
    expect(currentState().admin_password_set).toBe(true)
  })

  it('reports admin_password_set=false after clearing', () => {
    applyPending('admin_password', '')
    expect(currentState().admin_password_set).toBe(false)
  })
})

describe('auto-revert', () => {
  it('restores the previous value once the timer fires', () => {
    applyPending('admin_password', 'new-password', 60_000)
    expect(process.env.ADMIN_PASSWORD).toBe('new-password')
    vi.advanceTimersByTime(60_001)
    expect(process.env.ADMIN_PASSWORD).toBe(ORIG_PASSWORD)
  })

  it('restores undefined (delete) when the previous value was unset', () => {
    delete process.env.STATEWAVE_API_KEY
    applyPending('statewave_api_key', 'sk-tentative', 60_000)
    vi.advanceTimersByTime(60_001)
    expect(process.env.STATEWAVE_API_KEY).toBeUndefined()
  })

  it('clears the pending record after the timer fires', () => {
    applyPending('admin_password', 'new-password', 60_000)
    vi.advanceTimersByTime(60_001)
    expect(currentState().pending).toBeNull()
  })

  it('preserves the ORIGINAL previous value across rapid successive edits', () => {
    // This is the subtle case: if an operator types Wrong1, then Wrong2,
    // then walks away — the timer must revert all the way to the
    // original, not to Wrong1. Otherwise a two-edit sequence still
    // leaves a wrong value in place.
    applyPending('admin_password', 'wrong-1', 60_000)
    applyPending('admin_password', 'wrong-2', 60_000)
    vi.advanceTimersByTime(60_001)
    expect(process.env.ADMIN_PASSWORD).toBe(ORIG_PASSWORD)
  })
})

describe('confirmPending', () => {
  it('keeps the new value when confirmed', () => {
    applyPending('admin_password', 'new-password', 60_000)
    const ok = confirmPending('admin_password')
    expect(ok).toBe(true)
    vi.advanceTimersByTime(60_001)
    // No revert should fire — the new value sticks.
    expect(process.env.ADMIN_PASSWORD).toBe('new-password')
  })

  it('returns false when no pending change exists', () => {
    expect(confirmPending('admin_password')).toBe(false)
  })
})

describe('revertPending', () => {
  it('restores the previous value immediately', () => {
    applyPending('admin_password', 'new-password', 60_000)
    const ok = revertPending('admin_password')
    expect(ok).toBe(true)
    expect(process.env.ADMIN_PASSWORD).toBe(ORIG_PASSWORD)
  })

  it('cancels the auto-revert timer', () => {
    applyPending('admin_password', 'new-password', 60_000)
    revertPending('admin_password')
    // Reset env after revert so we can tell if a stray timer fires.
    process.env.ADMIN_PASSWORD = 'set-after-revert'
    vi.advanceTimersByTime(60_001)
    expect(process.env.ADMIN_PASSWORD).toBe('set-after-revert')
  })

  it('returns false when no pending change exists', () => {
    expect(revertPending('admin_password')).toBe(false)
  })
})

describe('currentState', () => {
  it('never returns the raw values', () => {
    const state = currentState()
    // The shape must be set/unset booleans + optional pending metadata.
    // If a future refactor adds a `value` field, this assertion fires
    // — a server-side accidental leak would be a real product bug.
    expect(state).not.toHaveProperty('admin_password_value')
    expect(state).not.toHaveProperty('statewave_api_key_value')
    expect(Object.keys(state).sort()).toEqual([
      'admin_password_set',
      'pending',
      'persistence',
      'statewave_api_key_set',
    ])
  })

  it('exposes persistence status (disabled when no master key)', () => {
    delete process.env.STATEWAVE_ADMIN_MASTER_KEY
    _resetStoreForTests()
    const state = currentState()
    expect(state.persistence.status).toBe('disabled')
    // The file_path is still surfaced so the UI can hint where it
    // would live once enabled. Never contains the key itself.
    expect(state.persistence.file_path).toMatch(/secrets\.enc$/)
    expect(state.persistence.file_path).not.toContain('MASTER_KEY')
  })
})

describe('persistence — round trip across simulated restart', () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'statewave-admin-persist-test-'))
    process.env.STATEWAVE_ADMIN_MASTER_KEY = 'test-master-passphrase'
    process.env.STATEWAVE_ADMIN_STATE_DIR = workdir
    _resetStoreForTests()
  })

  afterEach(() => {
    delete process.env.STATEWAVE_ADMIN_MASTER_KEY
    delete process.env.STATEWAVE_ADMIN_STATE_DIR
    _resetStoreForTests()
    rmSync(workdir, { recursive: true, force: true })
  })

  it('confirm writes the value to the encrypted file', () => {
    applyPending('admin_password', 'persist-me', 60_000)
    expect(confirmPending('admin_password')).toBe(true)
    // The file now exists and load-at-startup recovers the value.
    delete process.env.ADMIN_PASSWORD
    const result = loadPersistedSecretsAtStartup()
    expect(result.status).toBe('ready')
    expect(result.loaded).toContain('ADMIN_PASSWORD')
    expect(process.env.ADMIN_PASSWORD).toBe('persist-me')
  })

  it('revert does NOT persist (rollback never reaches disk)', () => {
    applyPending('admin_password', 'never-confirmed', 60_000)
    revertPending('admin_password')
    // Simulate restart with the original env unset → nothing to load.
    delete process.env.ADMIN_PASSWORD
    _resetStoreForTests()
    const result = loadPersistedSecretsAtStartup()
    expect(result.loaded).toEqual([])
  })

  it('startup load respects already-set env (deploy env wins)', () => {
    // Operator confirmed value X, but the deployment was redeployed
    // with ADMIN_PASSWORD=Y in env. Y must win — deploy env is the
    // source of truth for the very first request to the new pod.
    applyPending('admin_password', 'persisted-x', 60_000)
    confirmPending('admin_password')
    process.env.ADMIN_PASSWORD = 'env-y'
    _resetStoreForTests()
    const result = loadPersistedSecretsAtStartup()
    expect(process.env.ADMIN_PASSWORD).toBe('env-y')
    expect(result.loaded).not.toContain('ADMIN_PASSWORD')
  })

  it('loadPersistedSecretsAtStartup is graceful when persistence is disabled', () => {
    delete process.env.STATEWAVE_ADMIN_MASTER_KEY
    _resetStoreForTests()
    const result = loadPersistedSecretsAtStartup()
    expect(result.status).toBe('disabled')
    expect(result.loaded).toEqual([])
  })
})
