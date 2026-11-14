import { db } from "./index";

export async function migrate() {
  await db.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(19427138)`;
    await sql`CREATE TABLE IF NOT EXISTS interiors (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      plan jsonb NOT NULL,
      surfaces jsonb NOT NULL DEFAULT '{}',
      revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS agent_jobs (
      id uuid PRIMARY KEY,
      interior_id uuid NOT NULL REFERENCES interiors(id) ON DELETE CASCADE,
      surface_id text NOT NULL,
      surface_name text NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled','superseded')),
      revision integer NOT NULL,
      input jsonb NOT NULL,
      result jsonb,
      progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      message text NOT NULL DEFAULT 'Waiting for an agent',
      worker_id text,
      lease_token uuid,
      lease_expires_at timestamptz,
      attempt integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS agent_jobs_interior_idx ON agent_jobs(interior_id, created_at DESC)`;
    await sql`ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS draft_result jsonb`;
    await sql`ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`CREATE INDEX IF NOT EXISTS agent_jobs_queue_idx ON agent_jobs(created_at) WHERE status = 'queued'`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_active_surface_idx ON agent_jobs(interior_id, surface_id) WHERE status IN ('queued', 'running')`;
  });
}
