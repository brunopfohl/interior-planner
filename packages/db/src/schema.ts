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
    await sql`CREATE TABLE IF NOT EXISTS scene_imports (
      id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'Image import', revision integer NOT NULL DEFAULT 1,
      interior_id uuid REFERENCES interiors(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS import_images (
      id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES scene_imports(id) ON DELETE CASCADE,
      name text NOT NULL, mime text NOT NULL, size integer NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS import_messages (
      id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES scene_imports(id) ON DELETE CASCADE,
      role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL, revision integer NOT NULL,
      image_ids jsonb NOT NULL DEFAULT '[]', reply jsonb, created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE agent_jobs ALTER COLUMN interior_id DROP NOT NULL`;
    await sql`ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'surface' CHECK(kind IN ('surface','import'))`;
    await sql`ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES scene_imports(id) ON DELETE CASCADE`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_active_import_idx ON agent_jobs(import_id) WHERE status IN ('queued','running') AND kind = 'import'`;
    await sql`CREATE INDEX IF NOT EXISTS import_messages_session_idx ON import_messages(import_id,created_at)`;
    await sql`ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_kind_check`;
    await sql`ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_kind_check CHECK(kind IN ('surface','import','experiment'))`;
    await sql`CREATE TABLE IF NOT EXISTS experiments (
      id uuid PRIMARY KEY, interior_id uuid NOT NULL REFERENCES interiors(id) ON DELETE CASCADE,
      name text NOT NULL, goals text NOT NULL, constraints text NOT NULL, metrics jsonb NOT NULL,
      baseline jsonb NOT NULL, baseline_evaluations jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_active_experiment_idx ON agent_jobs(experiment_id) WHERE status IN ('queued','running') AND kind='experiment'`;
    await sql`CREATE INDEX IF NOT EXISTS experiments_interior_idx ON experiments(interior_id,created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS experiment_variants (
      id uuid PRIMARY KEY, experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      job_id uuid NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE, result jsonb NOT NULL,
      rank integer NOT NULL, notes text NOT NULL DEFAULT '', shortlisted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS agent_jobs_experiment_idx ON agent_jobs(experiment_id,updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS experiment_variants_rank_idx ON experiment_variants(experiment_id,rank)`;
  });
}
