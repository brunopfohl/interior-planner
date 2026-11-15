import { db } from "@interior-planner/db";
import {
  blankSurface,
  surfacesFor,
  type Job,
  type JobInput,
} from "@interior-planner/shared";
import {
  createExperimentSchema,
  generationSchema,
  rankingSchema,
  variantReviewSchema,
  validateExperimentResult,
  type ExperimentInput,
} from "@interior-planner/shared/experiments";
import { ApiError, body, uuid } from "./http";
type Row = Record<string, any>;
type Mapper = (row: Row) => Job;
const stamp = (v: unknown) => new Date(v as string).toISOString();
const roomDTO = (r: Row) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  plan: r.plan,
  surfaces: r.surfaces,
  revision: r.revision,
  createdAt: stamp(r.created_at),
  updatedAt: stamp(r.updated_at),
});
const variantDTO = (r: Row) => ({
  ...r.result,
  id: r.id,
  jobId: r.job_id,
  rank: r.rank,
  notes: r.notes,
  shortlisted: r.shortlisted,
  createdAt: stamp(r.created_at),
});
async function lock(sql: any, id: string) {
  const [e] = await sql`SELECT * FROM experiments WHERE id=${id} FOR UPDATE`;
  if (!e) throw new ApiError(404, "Experiment not found");
  return e;
}
async function idle(sql: any, id: string) {
  const [j] =
    await sql`SELECT id FROM agent_jobs WHERE experiment_id=${id} AND status IN ('queued','running')`;
  if (j)
    throw new ApiError(
      409,
      "An experiment generation is already queued or running",
    );
}
export async function experimentRoutes(
  req: Request,
  mapJob: Mapper,
): Promise<Response | null> {
  const path = new URL(req.url).pathname,
    method = req.method;
  const parent = path.match(/^\/api\/interiors\/([^/]+)\/experiments$/);
  if (parent) {
    const interiorId = uuid(parent[1]!);
    if (method === "GET")
      return Response.json(
        await db`SELECT e.id,e.name,e.goals,e.created_at AS "createdAt",e.updated_at AS "updatedAt",(SELECT count(*)::int FROM experiment_variants v WHERE v.experiment_id=e.id) AS "variantCount",EXISTS(SELECT 1 FROM agent_jobs j WHERE j.experiment_id=e.id AND j.status IN ('queued','running')) AS active FROM experiments e WHERE interior_id=${interiorId} ORDER BY updated_at DESC`,
      );
    if (method === "POST") {
      const data = createExperimentSchema.parse(await body(req));
      const result = await db.begin(async (sql) => {
        const [room] =
          await sql`SELECT * FROM interiors WHERE id=${interiorId} FOR UPDATE`;
        if (!room) throw new ApiError(404, "Interior not found");
        if (room.revision !== data.revision)
          throw new ApiError(
            409,
            "The interior changed. Reload it before taking the experiment snapshot.",
          );
        const jobs =
          await sql`SELECT surface_id,result FROM agent_jobs WHERE interior_id=${interiorId} AND kind='surface' AND status='completed' ORDER BY created_at DESC`;
        const seen = new Set<string>();
        const designs = jobs
          .filter((j: Row) => {
            if (seen.has(j.surface_id)) return false;
            seen.add(j.surface_id);
            return true;
          })
          .map((j: Row) => ({ surfaceId: j.surface_id, result: j.result }));
        const id = crypto.randomUUID();
        await sql`INSERT INTO experiments(id,interior_id,name,goals,constraints,metrics,baseline) VALUES(${id},${interiorId},${data.name},${data.goals},${data.constraints},${sql.json(data.metrics)},${sql.json({ interior: roomDTO(room), designs })})`;
        return { id };
      });
      return Response.json(result, { status: 201 });
    }
  }
  const route = path.match(
    /^\/api\/experiments\/([^/]+)(?:\/(generate|ranking|variants)(?:\/([^/]+)(?:\/(copy))?)?)?$/,
  );
  if (!route) return null;
  const id = uuid(route[1]!),
    action = route[2],
    variantId = route[3] ? uuid(route[3]) : undefined;
  if (!action && method === "GET") {
    const [e] =
      await db`SELECT e.*,i.revision AS source_revision,(SELECT max(updated_at)::text FROM agent_jobs WHERE experiment_id=e.id) AS job_stamp FROM experiments e JOIN interiors i ON i.id=e.interior_id WHERE e.id=${id}`;
    if (!e) throw new ApiError(404, "Experiment not found");
    const etag = `"${e.revision}:${e.source_revision}:${encodeURIComponent(e.job_stamp ?? "none")}"`;
    if (req.headers.get("If-None-Match") === etag)
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-cache" },
      });
    const variants =
        await db`SELECT * FROM experiment_variants WHERE experiment_id=${id} ORDER BY rank,created_at,id`,
      jobs =
        await db`SELECT * FROM agent_jobs WHERE experiment_id=${id} ORDER BY created_at DESC LIMIT 30`;
    return Response.json(
      {
        id: e.id,
        interiorId: e.interior_id,
        name: e.name,
        goals: e.goals,
        constraints: e.constraints,
        metrics: e.metrics,
        baseline: e.baseline,
        baselineEvaluations: e.baseline_evaluations,
        revision: e.revision,
        sourceRevision: e.source_revision,
        createdAt: stamp(e.created_at),
        updatedAt: stamp(e.updated_at),
        variants: variants.map(variantDTO),
        jobs: jobs.map(mapJob),
      },
      { headers: { ETag: etag, "Cache-Control": "private, no-cache" } },
    );
  }
  if (!action && method === "DELETE") {
    await db`DELETE FROM experiments WHERE id=${id}`;
    return new Response(null, { status: 204 });
  }
  if (action === "generate" && method === "POST") {
    const data = generationSchema.parse(await body(req));
    const job = await db.begin(async (sql) => {
      const e = await lock(sql, id);
      await idle(sql, id);
      const variants =
        await sql`SELECT result FROM experiment_variants WHERE experiment_id=${id} ORDER BY created_at DESC LIMIT 12`;
      const [count] =
        await sql`SELECT count(*)::int n FROM experiment_variants WHERE experiment_id=${id}`;
      if (count.n + data.count > 24)
        throw new ApiError(
          400,
          "Use up to 24 alternatives per experiment. Create a new experiment to explore further.",
        );
      const input: ExperimentInput = {
        kind: "experiment",
        experimentId: id,
        name: e.name,
        goals: e.goals,
        constraints: e.constraints,
        metrics: e.metrics,
        baseline: e.baseline,
        baselineEvaluations: e.baseline_evaluations,
        count: data.count,
        brief: data.brief,
        previousVariants: variants.map((v: Row) => ({
          name: v.result.name,
          summary: v.result.summary,
          approach: v.result.approach,
          evaluations: v.result.evaluations,
        })),
      };
      const [job] =
        await sql`INSERT INTO agent_jobs(id,kind,experiment_id,interior_id,surface_id,surface_name,revision,input,message,events) VALUES(${crypto.randomUUID()},'experiment',${id},${e.interior_id},${"experiment:" + id},'Experiment alternatives',${e.revision},${sql.json(input)},'Waiting for Codex to explore alternative designs',${sql.json([{ at: new Date().toISOString(), kind: "queued", message: `Requested ${data.count} alternatives from the saved baseline` }])}) RETURNING *`;
      await sql`UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=${id}`;
      return job;
    });
    return Response.json(mapJob(job), { status: 201 });
  }
  if (action === "ranking" && method === "PUT") {
    const data = rankingSchema.parse(await body(req));
    await db.begin(async (sql) => {
      const e = await lock(sql, id);
      if (data.revision !== e.revision)
        throw new ApiError(
          409,
          "This experiment changed. Reload before ranking it.",
        );
      const variants =
        await sql`SELECT id FROM experiment_variants WHERE experiment_id=${id}`;
      if (
        JSON.stringify([...data.ids].sort()) !==
        JSON.stringify(variants.map((v: Row) => v.id).sort())
      )
        throw new ApiError(400, "Rank every alternative exactly once");
      for (const [rank, variant] of data.ids.entries())
        await sql`UPDATE experiment_variants SET rank=${rank + 1} WHERE id=${variant} AND experiment_id=${id}`;
      await sql`UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=${id}`;
    });
    return Response.json({ saved: true });
  }
  if (action === "variants" && variantId) {
    if (method === "PATCH" && !route[4]) {
      const data = variantReviewSchema.parse(await body(req));
      await db.begin(async (sql) => {
        const e = await lock(sql, id);
        if (data.revision !== e.revision)
          throw new ApiError(
            409,
            "This experiment changed. Reload before saving your review.",
          );
        const rows =
          await sql`UPDATE experiment_variants SET notes=${data.notes},shortlisted=${data.shortlisted} WHERE id=${variantId} AND experiment_id=${id} RETURNING id`;
        if (!rows.length) throw new ApiError(404, "Alternative not found");
        await sql`UPDATE experiments SET revision=revision+1,updated_at=now() WHERE id=${id}`;
      });
      return Response.json({ saved: true });
    }
    if (method === "POST" && route[4] === "copy") {
      const interior = await db.begin(async (sql) => {
        const e = await lock(sql, id);
        const [v] =
          await sql`SELECT * FROM experiment_variants WHERE id=${variantId} AND experiment_id=${id}`;
        if (!v) throw new ApiError(404, "Alternative not found");
        const source = e.baseline.interior,
          newId = crypto.randomUUID(),
          name = v.result.name.slice(0, 120),
          description = `${v.result.summary}\nFrom experiment: ${e.name}`.slice(
            0,
            1000,
          );
        const [room] =
          await sql`INSERT INTO interiors(id,name,description,plan,surfaces) VALUES(${newId},${name},${description},${sql.json(source.plan)},${sql.json(source.surfaces)}) RETURNING *`;
        for (const design of v.result.designs) {
          const surface = surfacesFor(source.plan).find(
            (s) => s.id === design.surfaceId,
          )!;
          const input: JobInput = {
            interiorName: name,
            floorPlan: source.plan,
            surface,
            surfacePlan: source.surfaces[surface.id] ?? blankSurface(),
            instructions: `Saved alternative from experiment ${id}: ${v.result.approach}`,
          };
          await sql`INSERT INTO agent_jobs(id,interior_id,surface_id,surface_name,status,revision,input,result,progress,message,worker_id,events) VALUES(${crypto.randomUUID()},${newId},${surface.id},${surface.name},'completed',1,${sql.json(input)},${sql.json(design.result)},100,${design.result.summary},'codex-experiment',${sql.json([{ at: new Date().toISOString(), kind: "completed", message: "Created from a reviewed experiment alternative" }])})`;
        }
        return roomDTO(room);
      });
      return Response.json({ interior }, { status: 201 });
    }
  }
  throw new ApiError(404, "Experiment endpoint not found");
}
export async function updateExperimentJob(
  id: string,
  data: any,
  mapJob: Mapper,
) {
  const updated = await db.begin(async (sql) => {
    const [record] =
      await sql`SELECT experiment_id,input FROM agent_jobs WHERE id=${id}`;
    if (!record) throw new ApiError(404, "Experiment task not found");
    const experiment = await lock(sql, record.experiment_id);
    let result = null;
    if (data.status === "completed")
      try {
        result = validateExperimentResult(data.result, record.input);
      } catch (e: any) {
        throw new ApiError(400, e.message.slice(0, 2000));
      }
    if (
      data.draftResult !== undefined &&
      (data.draftResult === null ||
        typeof data.draftResult !== "object" ||
        JSON.stringify(data.draftResult).length > 1500000)
    )
      throw new ApiError(400, "Invalid experiment draft");
    const text =
      data.message ??
      (data.status === "completed"
        ? "Alternatives ready for comparison; original interior unchanged"
        : "Codex is exploring alternatives");
    const [job] =
      await sql`UPDATE agent_jobs SET status=${data.status},progress=CASE WHEN ${data.status}='completed' THEN 100 ELSE COALESCE(${data.progress ?? null},progress) END,events=CASE WHEN message IS DISTINCT FROM ${text} OR status IS DISTINCT FROM ${data.status} THEN events || ${sql.json([{ at: new Date().toISOString(), kind: data.status, message: text }])} ELSE events END,message=${text},result=${result ? sql.json(result) : null},draft_result=COALESCE(${data.draftResult ? sql.json(data.draftResult) : null},draft_result),lease_expires_at=${data.status === "running" ? new Date(Date.now() + 120000) : null},updated_at=now() WHERE id=${id} AND status='running' AND lease_token::text=${data.leaseToken} AND lease_expires_at>now() RETURNING *`;
    if (!job)
      throw new ApiError(409, "The experiment task expired or was cancelled");
    if (result) {
      const [count] =
        await sql`SELECT count(*)::int n FROM experiment_variants WHERE experiment_id=${experiment.id}`;
      for (const [i, v] of result.variants.entries())
        await sql`INSERT INTO experiment_variants(id,experiment_id,job_id,result,rank) VALUES(${crypto.randomUUID()},${experiment.id},${id},${sql.json(v)},${count.n + i + 1})`;
      await sql`UPDATE experiments SET baseline_evaluations=${sql.json(experiment.baseline_evaluations.length ? experiment.baseline_evaluations : result.baselineEvaluations)},revision=revision+1,updated_at=now() WHERE id=${experiment.id}`;
    }
    return job;
  });
  return Response.json(mapJob(updated));
}
