import '@testing-library/jest-dom/vitest'

/**
 * The admin UI now sits behind /api/auth/session. Tests that mock fetch must
 * answer that URL too — use this helper to wrap an existing per-URL mock
 * with a session response. See `tests/auth-gate.test.tsx` for tests that
 * explicitly exercise the auth flow.
 */
export const FAKE_SESSION_OK = {
  authenticated: true,
  authDisabled: false,
  configError: null,
  source: 'session' as const,
}

export function makeSessionMock(
  overrides: Partial<typeof FAKE_SESSION_OK> = {},
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ...FAKE_SESSION_OK, ...overrides }),
  } as unknown as Response
}

export function isSessionUrl(input: RequestInfo | URL): boolean {
  const u =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url
  return typeof u === 'string' && u.includes('/api/auth/session')
}
