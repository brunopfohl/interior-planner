# Interior Planner

Scaffolding for a web application for planning interiors. Includes a placeholder
page and infrastructure health check; interior-planning features are yet to be built.

## Stack

- Bun workspaces, TypeScript, and one lockfile.
- Bun's native HTTP server, HTML bundler, and PostgreSQL client.
- PostgreSQL 18 with a persistent Docker volume.
- Docker Compose for running, developing, and checking the project.
- No runtime dependencies beyond Bun and PostgreSQL.

```text
apps/web/       Web entry point and placeholder HTML
packages/db/   Shared PostgreSQL connection
```

The web app and future API routes share one process. The database workspace is
server-only. There is no application schema yet.

## Run

Requires Docker Engine with Docker Compose v2 or newer. Host Bun is optional.

```sh
cp .env.example .env
docker compose up --build --wait
```

Open <http://localhost:3000>. Set `PORT` in `.env` if that port is already in use.
Set your own `POSTGRES_PASSWORD` in `.env` before the first start. PostgreSQL
credentials are initialized on the first start of an empty volume.

`GET /health` returns HTTP 200 when a database query succeeds, or 503 when it fails.
The web port is bound to localhost; PostgreSQL is accessible within Docker only.

## Develop

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build --wait
```

Source edits are mounted into the container, with Bun hot reloading enabled.
Rebuild after changing workspace manifests or dependencies. Use the same `-f`
options for subsequent Compose commands while developing.

```sh
# Type-check all workspaces inside Docker
docker compose -f compose.yaml -f compose.dev.yaml exec web bun run check

# Build the web app inside Docker
docker compose -f compose.yaml -f compose.dev.yaml exec web bun run build

# Open PostgreSQL's CLI
docker compose exec db psql -U interior_planner -d interior_planner

# View logs
docker compose logs -f

# Stop containers; database data is retained
docker compose down
```

To switch back to the production image after developing:

```sh
docker compose up --build --force-recreate --wait
```

Production uses a separate non-root image containing only Bun and the app build.
The image build runs TypeScript checks. CI builds and boots the same Compose stack
and checks HTTP and database readiness.

For optional host tooling, install Bun 1.4.4, then run `bun install`,
`bun run check`, or `bun run build` from the repository root. The supported app
development workflow above runs entirely in Docker.

## References

- [Bun fullstack server and bundler](https://bun.com/docs/bundler/fullstack)
- [Bun SQL client](https://bun.com/docs/runtime/sql)
- [Official PostgreSQL Docker image](https://hub.docker.com/_/postgres)
