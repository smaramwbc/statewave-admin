import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider } from './lib/theme'
import { AuthProvider } from './lib/auth'
import { AuthGate } from './components/AuthGate'
import { Shell } from './components/layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardPage } from './pages/DashboardPage'
import { SubjectsPage } from './pages/SubjectsPage'
import { SubjectDetailPage } from './pages/SubjectDetailPage'
import { SessionTimelinePage } from './pages/SessionTimelinePage'
import { JobsPage } from './pages/JobsPage'
import { WebhooksPage } from './pages/WebhooksPage'
import { ReceiptsPage } from './pages/ReceiptsPage'
import { PolicyPage } from './pages/PolicyPage'
import { SuggestedLabelsPage } from './pages/SuggestedLabelsPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { WizardsProvider } from './lib/wizards'

export default function App() {
  return (
    <ErrorBoundary level="app">
      <ThemeProvider>
        <AuthProvider>
          <AuthGate>
            {/* Single Toaster anchored at the app root. Sonner picks up
                light/dark from system; we let the operator OS preference
                decide rather than force a theme. */}
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{
                className: 'font-sans',
                duration: 4000,
              }}
            />
            <BrowserRouter>
              {/* WizardsProvider sits inside BrowserRouter (it uses
                  useSearchParams for deep-link `?wizard=` handling)
                  but above Routes — so any page in the tree can call
                  useWizards().openWizard(id) and the modal opens
                  in-place, no navigation, no state loss on cancel. */}
              <WizardsProvider>
                <Routes>
                  <Route element={<Shell />}>
                    <Route path="/" element={<ErrorBoundary level="page"><DashboardPage /></ErrorBoundary>} />
                    <Route path="/subjects" element={<ErrorBoundary level="page"><SubjectsPage /></ErrorBoundary>} />
                    <Route path="/subjects/:subjectId" element={<ErrorBoundary level="page"><SubjectDetailPage /></ErrorBoundary>} />
                    <Route path="/subjects/:subjectId/sessions/:sessionId/timeline" element={<ErrorBoundary level="page"><SessionTimelinePage /></ErrorBoundary>} />
                    <Route path="/jobs" element={<ErrorBoundary level="page"><JobsPage /></ErrorBoundary>} />
                    <Route path="/webhooks" element={<ErrorBoundary level="page"><WebhooksPage /></ErrorBoundary>} />
                    <Route path="/receipts" element={<ErrorBoundary level="page"><ReceiptsPage /></ErrorBoundary>} />
                    <Route path="/policy" element={<ErrorBoundary level="page"><PolicyPage /></ErrorBoundary>} />
                    <Route path="/suggested-labels" element={<ErrorBoundary level="page"><SuggestedLabelsPage /></ErrorBoundary>} />
                    <Route path="/diagnostics" element={<ErrorBoundary level="page"><DiagnosticsPage /></ErrorBoundary>} />
                    <Route path="/settings" element={<ErrorBoundary level="page"><SettingsPage /></ErrorBoundary>} />
                  </Route>
                </Routes>
              </WizardsProvider>
            </BrowserRouter>
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
