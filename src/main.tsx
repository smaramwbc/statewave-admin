import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import './index.css'
import App from './App'
import { applyPendingUpdate, registerServiceWorker } from './lib/sw-register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

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
