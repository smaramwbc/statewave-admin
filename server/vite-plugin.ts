/**
 * Vite dev plugin that mounts the admin auth + proxy handlers as middleware.
 *
 * Lets `npm run dev` run the EXACT same handlers as the standalone server,
 * with no Vercel/Fly/etc. specific dev-only adapter. Gives parity between
 * dev and prod regardless of how the prod build is hosted.
 */
import type { Plugin } from 'vite'
import { dispatch } from './handlers.js'

export function adminAuthPlugin(): Plugin {
  return {
    name: 'statewave-admin-auth',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await dispatch(req, res)
          if (!handled) next()
        } catch {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'internal_error' }))
        }
      })
    },
  }
}
