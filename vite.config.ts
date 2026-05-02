import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { adminAuthPlugin } from './server/vite-plugin'

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), adminAuthPlugin()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  }
})
