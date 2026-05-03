import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { purgeCachesAndUnregister } from './sw-register'

interface SessionState {
  authenticated: boolean
  authDisabled: boolean
  configError: string | null
  source: 'session' | 'gateway' | 'disabled' | 'none' | 'unknown'
  loading: boolean
}

interface AuthContextValue extends SessionState {
  refresh: () => Promise<void>
  login: (password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const initialState: SessionState = {
  authenticated: false,
  authDisabled: false,
  configError: null,
  source: 'unknown',
  loading: true,
}

async function fetchSession(): Promise<SessionState> {
  try {
    const res = await fetch('/api/auth/session', {
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error('session_fetch_failed')
    const data = await res.json()
    return {
      authenticated: !!data.authenticated,
      authDisabled: !!data.authDisabled,
      configError:
        typeof data.configError === 'string' ? data.configError : null,
      source: data.source ?? 'unknown',
      loading: false,
    }
  } catch {
    return {
      authenticated: false,
      authDisabled: false,
      configError: 'Could not reach the admin auth service.',
      source: 'unknown',
      loading: false,
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    const next = await fetchSession()
    if (mounted.current) setState(next)
  }, [])

  useEffect(() => {
    mounted.current = true
    fetchSession().then((next) => {
      if (mounted.current) setState(next)
    })
    return () => {
      mounted.current = false
    }
  }, [])

  const login = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        if (res.ok) {
          await refresh()
          return { ok: true }
        }
        let error = 'invalid_credentials'
        try {
          const data = await res.json()
          if (typeof data?.error === 'string') error = data.error
        } catch {
          /* ignore */
        }
        return { ok: false, error }
      } catch {
        return { ok: false, error: 'network_error' }
      }
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      /* ignore — refresh below will reflect server state */
    }
    // Belt-and-braces: the SW already bypasses /api/* so no privileged
    // response is in cache, but on logout we still drop the SW caches
    // and unregister so the next account starts on a clean shell.
    await purgeCachesAndUnregister()
    await refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ ...state, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
