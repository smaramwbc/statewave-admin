# Statewave admin

Operator console for Statewave servers — manage subjects, episodes, memories, and starter packs from a browser.

[![Image](https://img.shields.io/docker/image-size/statewavedev/statewave-admin/latest?label=image)](https://hub.docker.com/r/statewavedev/statewave-admin)
[![Pulls](https://img.shields.io/docker/pulls/statewavedev/statewave-admin)](https://hub.docker.com/r/statewavedev/statewave-admin)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/smaramwbc/statewave-admin/blob/main/LICENSE)

Multi-arch (`linux/amd64`, `linux/arm64`), built with provenance + SBOM and signed via Sigstore.

## Quickstart

```sh
docker run --rm -p 8080:8080 \
  -e STATEWAVE_API_URL=http://host.docker.internal:8100 \
  -e ADMIN_AUTH_DISABLED=true \
  statewavedev/statewave-admin:latest
```

> `ADMIN_AUTH_DISABLED=true` is for local trials only. For a deployed admin,
> drop it and set `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` instead — e.g.
> `-e ADMIN_PASSWORD=... -e ADMIN_SESSION_SECRET=$(openssl rand -hex 32)`.

Then open <http://localhost:8080>.

## Compose alongside the server

```yaml
services:
  api:
    image: statewavedev/statewave:latest
    # ...

  admin:
    image: statewavedev/statewave-admin:latest
    ports: ["8080:8080"]
    environment:
      STATEWAVE_API_URL: http://api:8100
      ADMIN_AUTH_DISABLED: "true"   # local trial only; use ADMIN_PASSWORD + ADMIN_SESSION_SECRET when deployed
    depends_on: [api]
```

## Tags

| Tag | Meaning |
|---|---|
| `latest` | Tip of `main` |
| `X.Y.Z` | Semver release |
| `X.Y`, `X` | Latest in the minor / major line |
| `sha-<7>` | Specific commit |

## Verify the build attestation

```sh
gh attestation verify \
  oci://docker.io/statewavedev/statewave-admin:latest \
  --owner smaramwbc
```

## Source & docs

- Repository: <https://github.com/smaramwbc/statewave-admin>
- Documentation: <https://statewave.ai>
- License: Apache-2.0
