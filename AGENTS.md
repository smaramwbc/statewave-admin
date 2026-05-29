# AGENTS.md — guide for contributors and coding agents

A short orientation for humans and AI coding agents (GitHub Copilot, Claude,
Cursor, …) working in **statewave-admin** — the React/Vite admin UI for a
Statewave deployment (subjects, memories, receipts, suggested labels, …).

## Setup, build, test

See the [README](README.md) for canonical setup. In short:

```bash
npm install
npm test        # vitest run
npm run build   # tsc -b && vite build
```

Make sure the build and tests pass before opening a PR.

## Conventions

- **Code style & testing:** see
  [statewave-docs/dev/conventions.md](https://github.com/smaramwbc/statewave-docs/blob/main/dev/conventions.md).
- **Talk to the server only through the `/v1` API** — the admin UI versions
  independently of the server; the contract is the API, not a shared version.
- **Keep UI copy accurate and modest;** avoid unqualified superlatives and
  maturity overclaims.

## Pull requests

Keep PRs focused, add tests for behavior changes, and make sure `npm test` and
`npm run build` pass.

## Optional: give your agent memory of this repo (with Statewave)

This project dogfoods Statewave. To let your assistant recall this repo's
context, serve it through the Statewave MCP server: run an instance, ingest
this repo via the GitHub or Markdown connector into subject
`repo:smaramwbc/statewave-admin`, and point your MCP client at
`@statewavedev/mcp-server`. See the
[MCP server](https://github.com/smaramwbc/statewave-docs/blob/main/connectors/mcp.md)
and
[connectors quickstart](https://github.com/smaramwbc/statewave-docs/blob/main/connectors/quickstart.md)
docs. Your agent can then call `statewave_get_context` with subject
`repo:smaramwbc/statewave-admin`.
