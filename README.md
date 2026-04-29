# statewave-admin

Standalone operator dashboard for Statewave instances.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5174

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:8100` | Statewave API base URL |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 5174 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm test` | Run tests with Vitest |
| `npm run lint` | ESLint check |

## Stack

- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4
- Vitest + Testing Library

## Deployment

Build the static site and deploy to any CDN or static host:

```bash
npm run build
# deploy dist/ folder
```

Set `VITE_API_BASE_URL` at build time to point to your Statewave instance.
