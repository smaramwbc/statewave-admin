import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

export default function App() {
  return (
    <ErrorBoundary level="app">
      <ThemeProvider>
        <AuthProvider>
          <AuthGate>
            <BrowserRouter>
              <Routes>
                <Route element={<Shell />}>
                  <Route path="/" element={<ErrorBoundary level="page"><DashboardPage /></ErrorBoundary>} />
                  <Route path="/subjects" element={<ErrorBoundary level="page"><SubjectsPage /></ErrorBoundary>} />
                  <Route path="/subjects/:subjectId" element={<ErrorBoundary level="page"><SubjectDetailPage /></ErrorBoundary>} />
                  <Route path="/subjects/:subjectId/sessions/:sessionId/timeline" element={<ErrorBoundary level="page"><SessionTimelinePage /></ErrorBoundary>} />
                  <Route path="/jobs" element={<ErrorBoundary level="page"><JobsPage /></ErrorBoundary>} />
                  <Route path="/webhooks" element={<ErrorBoundary level="page"><WebhooksPage /></ErrorBoundary>} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
