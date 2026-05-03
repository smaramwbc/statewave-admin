import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  level?: 'app' | 'page' | 'section' | 'modal'
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

// ─── Error Boundary Component ────────────────────────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console in all environments
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallbacks based on level
      const level = this.props.level || 'section'
      const error = this.state.error
      const isDev = import.meta.env.DEV

      switch (level) {
        case 'app':
          return (
            <AppErrorFallback
              error={error}
              isDev={isDev}
              onReload={this.handleReload}
            />
          )
        case 'page':
          return (
            <PageErrorFallback
              error={error}
              isDev={isDev}
              onReset={this.handleReset}
            />
          )
        case 'modal':
          return (
            <ModalErrorFallback
              error={error}
              isDev={isDev}
              onReset={this.handleReset}
            />
          )
        default:
          return (
            <SectionErrorFallback
              error={error}
              isDev={isDev}
              onReset={this.handleReset}
            />
          )
      }
    }

    return this.props.children
  }
}

// ─── App-Level Fallback ──────────────────────────────────────────────────────

function AppErrorFallback({
  error,
  isDev,
  onReload,
}: {
  error: Error | null
  isDev: boolean
  onReload: () => void
}) {
  return (
    <div className="min-h-screen bg-[var(--theme-surface-0)] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-theme-primary mb-2">Something went wrong</h1>
          <p className="text-sm text-theme-muted mb-4">
            The admin console encountered an unexpected error.
          </p>
          {isDev && error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border text-left">
              <p className="text-xs font-mono text-red-400 break-all">{error.message}</p>
            </div>
          )}
          {/* Raw <button> here on purpose: this fallback runs when the React
              tree above us has crashed. Importing the Button primitive — or
              any other component graph — risks the same module being the
              thing that broke. Keep this dependency-free. */}
          <button
            type="button"
            onClick={onReload}
            className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page-Level Fallback ─────────────────────────────────────────────────────

function PageErrorFallback({
  error,
  isDev,
  onReset,
}: {
  error: Error | null
  isDev: boolean
  onReset: () => void
}) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--theme-text-primary)] mb-1">
              This page encountered an error
            </h2>
            <p className="text-sm text-[var(--theme-text-muted)] mb-4">
              Something went wrong while rendering this page. You can try again or navigate to another section.
            </p>
            {isDev && error && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--theme-surface-1)] border border-red-500/10">
                <p className="text-xs font-mono text-red-400 break-all">{error.message}</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={onReset}
                className="px-3 py-1.5 text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
              >
                Try Again
              </button>
              <Link
                to="/"
                className="px-3 py-1.5 text-sm text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] transition-colors"
              >
                Go to Overview
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Section-Level Fallback ──────────────────────────────────────────────────

function SectionErrorFallback({
  error,
  isDev,
  onReset,
}: {
  error: Error | null
  isDev: boolean
  onReset: () => void
}) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--theme-text-secondary)]">
            Failed to load this section
            {isDev && error && (
              <span className="text-red-400 font-mono text-xs ml-2">({error.message})</span>
            )}
          </p>
        </div>
        <button
          onClick={onReset}
          className="px-2.5 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

// ─── Modal-Level Fallback ────────────────────────────────────────────────────

function ModalErrorFallback({
  error,
  isDev,
  onReset,
}: {
  error: Error | null
  isDev: boolean
  onReset: () => void
}) {
  return (
    <div className="p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm text-[var(--theme-text-secondary)] mb-2">
        Failed to load this content
      </p>
      {isDev && error && (
        <p className="text-xs font-mono text-red-400 mb-3 break-all">{error.message}</p>
      )}
      <button
        onClick={onReset}
        className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
      >
        Try Again
      </button>
    </div>
  )
}

// ─── Helper HOC for wrapping pages ───────────────────────────────────────────

export function withPageErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  displayName?: string
) {
  function WrappedComponent(props: P) {
    return (
      <ErrorBoundary level="page">
        <Component {...props} />
      </ErrorBoundary>
    )
  }
  WrappedComponent.displayName = displayName || `WithErrorBoundary(${Component.displayName || Component.name || 'Component'})`
  return WrappedComponent
}
