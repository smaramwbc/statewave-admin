import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { adminAuthPlugin } from './server/vite-plugin'

// Single source of truth for the version label shown in the UI: the package
// version. Injected at build time so it can never drift from the real release
// (the footer used to hardcode "v0.9" and went stale at the v1.0 cut).
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

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
    define: {
      __ADMIN_VERSION__: JSON.stringify(pkgVersion),
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  }
})
