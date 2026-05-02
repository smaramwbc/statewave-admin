import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { adminAuthPlugin } from './server/vite-plugin'

export default defineConfig(({ mode }) => {
  // The admin auth + proxy handlers read server-only env vars
  // (ADMIN_PASSWORD, ADMIN_SESSION_SECRET, ADMIN_AUTH_DISABLED,
  // STATEWAVE_API_URL, STATEWAVE_API_KEY, …) via process.env. Vite's
  // built-in .env loading only exposes VITE_* to the client bundle and
  // does NOT populate process.env for non-prefixed names. Explicitly
  // load every non-prefixed key from .env / .env.local / .env.<mode>
  // so `npm run dev` honors the same files the standalone Node server
  // honors when launched via `node --env-file=.env.local`.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(fileEnv)) {
    if (k.startsWith('VITE_')) continue
    if (process.env[k] === undefined) process.env[k] = v
  }

  return {
    plugins: [react(), tailwindcss(), adminAuthPlugin()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  }
})
