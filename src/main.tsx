import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import './index.css'
import App from './App'
import { TauriFirstRun, TauriStartingSidecar } from './components/TauriFirstRun'
import { applyPendingUpdate, registerServiceWorker } from './lib/sw-register'
import { ThemeProvider } from './lib/theme'
import {
  ensureSidecar,
  getBackendStatus,
  isBootstrapPhase,
  isTauri,
} from './lib/tauri-bridge'

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!)

  // In Tauri prod, the React bundle boots once from the OS-specific
  // Tauri asset URL (bootstrap phase) and again from
  // `http://127.0.0.1:NNNN` after the shell navigates to the spawned
  // sidecar (normal phase). The wizard / sidecar plumbing only runs in
  // the bootstrap phase. Outside Tauri (web deploy, `npm run dev`) we
  // go straight to the app.
  if (isTauri() && isBootstrapPhase()) {
    let status
    try {
      status = await getBackendStatus()
    } catch (err) {
      // If the invoke handler fails, treat as "not configured" and let
      // the wizard render so the user has a path forward instead of a
      // blank window.
      console.error('get_backend_status failed', err)
      status = { configured: false, statewave_api_url: null, sidecar_url: null }
    }
    if (!status.configured) {
      // ThemeProvider is required by the wizard's `useTheme()` call —
      // the regular `<App />` mounts it, but the wizard is rendered
      // before App, so we wrap it explicitly here.
      root.render(
        <StrictMode>
          <ThemeProvider>
            <TauriFirstRun />
          </ThemeProvider>
        </StrictMode>,
      )
      return
    }
    // Creds present — starting the sidecar will navigate the window.
    root.render(
      <StrictMode>
        <ThemeProvider>
          <TauriStartingSidecar />
        </ThemeProvider>
      </StrictMode>,
    )
    try {
      await ensureSidecar()
    } catch (err) {
      console.error('failed to start sidecar', err)
    }
    return
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()

// Register the service worker after React mounts. The registration is a
// no-op in dev (Vite serves modules), and is a no-op in browsers that
// do not support service workers — the function handles both cases.
//
// When a new SW is waiting we surface a sticky toast inviting the user
// to reload. We don't auto-reload — admin work can be in flight (a long
// memory edit, an in-progress timeline view) and a forced reload would
// throw the work away.
registerServiceWorker({
  onUpdateAvailable: () => {
    toast.message('A new version of Statewave Admin is available.', {
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => applyPendingUpdate(),
      },
    })
  },
})
