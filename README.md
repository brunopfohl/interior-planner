# Interior Planner

A Bun monorepo for planning interiors, from a floor-plan outline to a 3D room and
agent-designed surface details.

## Use the app

- Create, search, open, rename, and delete interiors saved in PostgreSQL.
- Draw a floor outline or reshape it by dragging corners and adding vertices.
  Set precise dimensions, ceiling height, and wall thickness. Plans may be concave.
- Explore the resulting floor, walls, and ceiling in 3D with orbit, zoom, cutaway,
  surface selection, and a ceiling toggle.
- Edit a separate plan for each floor, ceiling, or wall. Draw features and openings,
  enter exact dimensions, and add design instructions. Wall openings cut through
  the room shell.
- Queue surface designs and see queued, running, completed, failed, cancelled, and
  outdated states, plus worker progress and messages.
- Switch between light, dark, and system themes. Theme tokens live in
  `apps/web/src/styles.css`.

The room shell follows the measured footprint. A separate agent interprets each
surface plan and decides its actual design and 3D geometry. Completed results
appear in the scene automatically. Changes to a plan invalidate affected designs
and in-flight tasks; outdated results cannot overwrite newer edits.

## Stack

Bun workspaces, React, shadcn/ui (official New York components), Tailwind CSS,
Three.js, Zod, and PostgreSQL 18. Bun supplies the HTTP server, bundler, SQL client,
and test runner. No separate API framework, ORM, queue broker, or build orchestrator.
The 3D renderer loads only when opening the 3D view.

```text
apps/web/        Bun server, React UI, shadcn components, 2D/3D editors
packages/db/     PostgreSQL connection and initial schema migration
packages/shared/ Shared contracts, validation, and geometry helpers
scripts/         Worker CLI and isolated integration checks
docs/            Codex worker protocol
```

## Run

Requires Docker Engine and Docker Compose v2 or newer. Host Bun is optional.

```sh
cp .env.example .env
# Choose POSTGRES_PASSWORD in .env before the first start.
docker compose up --build --wait
```

Open <http://localhost:3000>. The app is bound to localhost and PostgreSQL is
available within Docker only. `PORT` in `.env` changes the host web port. Data is
retained in the named PostgreSQL volume. Database credentials are initialized on
the first start of an empty volume; the initial application schema is applied
transactionally when the server starts.

```sh
docker compose logs -f
# Stop containers and keep the database:
docker compose down
```

## Develop

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build --wait
```

Sources are mounted read-only with Bun hot reloading. Rebuild after dependency or
manifest changes. Use the same `-f` options with `exec` while developing.

```sh
docker compose -f compose.yaml -f compose.dev.yaml exec web bun run check
docker compose -f compose.yaml -f compose.dev.yaml exec web bun run test
docker compose -f compose.yaml -f compose.dev.yaml exec web bun run build
```

To return to the non-root production image:

```sh
docker compose up --build --force-recreate --wait
```

Host tooling with Bun 1.4.4: `bun install --frozen-lockfile`, `bun run check`,
`bun run test`, and `bun run build`. The supported development workflow runs the
application and database in Docker.

## Connect a Codex worker

Set `AGENT_TOKEN` in `.env` to a secret generated with `openssl rand -hex 32`, then
recreate the web service. Give an external Codex session the instructions in
[docs/CODEX-WORKER.md](docs/CODEX-WORKER.md). It can claim tasks through the CLI or
HTTP, send heartbeats and progress, and return validated scene JSON.

```sh
bun run agent claim --worker codex-local --out /tmp/interior-task.json
bun run agent heartbeat --task /tmp/interior-task.json --progress 35 --message "Designing cabinetry"
bun run agent complete --task /tmp/interior-task.json --result /tmp/interior-result.json
```

To process the queue continuously in a separate terminal, with Bun and an
authenticated Codex CLI installed, run `bun run worker`. This supervisor polls
for tasks, invokes Codex, sends heartbeats, and submits validated designs. Stop
it with Ctrl+C. It uses your existing Codex login and default model.

The queue uses PostgreSQL atomic claims and expiring worker leases. The web app
does not automatically start the worker. Without a connected worker, tasks remain
queued. Agent output currently supports composed boxes, cylinders, and spheres
with material properties; arbitrary mesh or GLTF imports are not implemented.

## Verification

Image builds run TypeScript checks, geometry and output-validation tests, and the
production build. CI also boots PostgreSQL and exercises interior persistence,
revision conflicts, concurrent queue claims, heartbeats, completion, cancellation,
and stale-result protection.

Run the full API check against an **empty, isolated test database**, using a local
worker secret in `.env`:

```sh
PORT=3001 docker compose -p interior-planner-test up --build --wait
AGENT_API_URL=http://localhost:3001 bun scripts/smoke.ts
PORT=3001 docker compose -p interior-planner-test down --volumes
```

The integration script refuses to run if the workspace already contains interiors.

## References

- [shadcn/ui](https://ui.shadcn.com/docs/installation/manual)
- [Bun fullstack server and bundler](https://bun.com/docs/bundler/fullstack)
- [Bun SQL client](https://bun.com/docs/runtime/sql)
- [Three.js](https://threejs.org/docs/)
- [Official PostgreSQL Docker image](https://hub.docker.com/_/postgres)
