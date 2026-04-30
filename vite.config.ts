import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load env vars from .env.local
  const env = loadEnv(mode, process.cwd(), '')
  const STATEWAVE_API_URL = env.STATEWAVE_API_URL || 'https://statewave-api.fly.dev'
  const STATEWAVE_API_KEY = env.STATEWAVE_API_KEY || ''

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    server: {
      proxy: {
        '/api/proxy': {
          target: STATEWAVE_API_URL,
          changeOrigin: true,
          rewrite: (reqPath) => {
            // reqPath is like /api/proxy?path=%2Fadmin%2Fdashboard
            const match = reqPath.match(/[?&]path=([^&]+)/)
            if (match) {
              return decodeURIComponent(match[1])
            }
            return '/admin/dashboard'
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (STATEWAVE_API_KEY) {
                proxyReq.setHeader('X-API-Key', STATEWAVE_API_KEY)
              }
            })
          },
        },
      },
    },
  }
})
