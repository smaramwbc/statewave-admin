import { ThemeProvider } from './lib/theme'
import { DashboardPage } from './pages/DashboardPage'

export default function App() {
  return (
    <ThemeProvider>
      <DashboardPage />
    </ThemeProvider>
  )
}
