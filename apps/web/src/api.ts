import { db } from "@interior-planner/db";
import { isDeepStrictEqual } from "node:util";
import { timingSafeEqual } from "node:crypto";
import {
  blankSurface,
  createInteriorSchema,
  defaultPlan,
  saveInteriorSchema,
  sceneResultSchema,
  sceneResultJsonSchema,
  surfacesFor,
  type Interior,
  type Job,
  type JobInput,
} from "@interior-planner/shared";

type Row = Record<string, any>;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function interior(row: Row): Interior {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    plan: row.plan,
    surfaces: row.surfaces,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function job(row: Row): Job {
  return {
    id: row.id,
    interiorId: row.interior_id,
    surfaceId: row.surface_id,
    surfaceName: row.surface_name,
    status: row.status,
    progress: row.progress,
    message: row.message,
    workerId: row.worker_id,
    attempt: row.attempt,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    result: row.status === "completed" ? row.result : null,
  };
}
function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApiError(400, "Invalid ID");
  return value;
}
async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Expected a JSON request body");
  }
}
async function expireLeases() {
  await db`UPDATE agent_jobs SET status = CASE WHEN attempt >= 3 THEN 'failed' ELSE 'queued' END,
    message = CASE WHEN attempt >= 3 THEN 'Worker lease expired after three attempts' ELSE 'Worker disconnected; waiting for another agent' END,
    worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, progress = 0, updated_at = now()
    WHERE status = 'running' AND lease_expires_at < now()`;
}
function requireAgent(req: Request) {
  const token = Bun.env.AGENT_TOKEN;
  if (!token)
    throw new ApiError(
      503,
      "Set AGENT_TOKEN on the server to enable worker access",
    );
  const authorization = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  const a = Buffer.from(authorization),
    b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ApiError(401, "Invalid agent token");
}

export async function handleApi(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url),
      path = url.pathname,
      method = req.method;
    const origin = req.headers.get("origin");
    if (!["GET", "HEAD"].includes(method) && origin && origin !== url.origin)
      throw new ApiError(403, "Cross-origin requests are not allowed");
    if (path.startsWith("/api/agent/")) requireAgent(req);
    if (path === "/api/settings" && method === "GET")
      return Response.json({ agentConfigured: Boolean(Bun.env.AGENT_TOKEN) });
    if (path === "/api/jobs" && method === "GET") {
      await expireLeases();
      return Response.json(
        (
          await db`SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT 100`
        ).map((row: Row) => job({ ...row, result: null })),
      );
    }
    if (path === "/api/interiors") {
      if (method === "GET")
        return Response.json(
          (await db`SELECT * FROM interiors ORDER BY updated_at DESC`).map(
            interior,
          ),
        );
      if (method === "POST") {
        const data = createInteriorSchema.parse(await body(req)),
          id = crypto.randomUUID();
        const [row] =
          await db`INSERT INTO interiors (id,name,description,plan) VALUES (${id},${data.name},${data.description},${db.json(defaultPlan)}) RETURNING *`;
        return Response.json(interior(row), { status: 201 });
      }
    }
    const match = path.match(/^\/api\/interiors\/([^/]+)(?:\/(jobs))?$/);
    if (match) {
      const id = uuid(match[1]!);
      if (match[2] === "jobs") {
        if (method === "GET") {
          await expireLeases();
          return Response.json(
            (
              await db`SELECT * FROM agent_jobs WHERE interior_id = ${id} ORDER BY created_at DESC LIMIT 100`
            ).map(job),
          );
        }
        if (method === "POST") {
          const data = await body(req);
          if (
            typeof data.surfaceId !== "string" ||
            typeof data.revision !== "number"
          )
            throw new ApiError(400, "Surface and saved revision are required");
          const row = await db.begin(async (sql) => {
            const [room] =
              await sql`SELECT * FROM interiors WHERE id = ${id} FOR UPDATE`;
            if (!room) throw new ApiError(404, "Interior not found");
            if (room.revision !== data.revision)
              throw new ApiError(
                409,
                "The plan changed. Reload it before queuing a task.",
              );
            const surface = surfacesFor(room.plan).find(
              (s) => s.id === data.surfaceId,
            );
            if (!surface) throw new ApiError(400, "Surface not found");
            const [existing] =
              await sql`SELECT id FROM agent_jobs WHERE interior_id = ${id} AND surface_id = ${surface.id} AND status IN ('queued','running')`;
            if (existing)
              throw new ApiError(
                409,
                "This surface already has an active task",
              );
            const input: JobInput = {
              interiorName: room.name,
              floorPlan: room.plan,
              surface,
              surfacePlan: room.surfaces[surface.id] ?? blankSurface(),
              instructions:
                "Interpret the surface plan and design notes as an interior designer. Decide suitable form, materials, depth and detail. Produce original 3D geometry using the scene result schema. All measurements are metres. Local X is horizontal across the surface, local Y is up on its 2D plan, and local Z points inward into the room. Position is the centre of each primitive. Size is the full X/Y/Z extent. Rotation is XYZ Euler angles in radians. For cylinders the cylinder axis is local Y. Do not include the room shell; it is already rendered. Use the full floor footprint to avoid placing geometry outside concave floor or ceiling boundaries. Wall opening annotations already cut through the room shell. Design their frames, reveals, glazing and surrounding geometry. Floor and ceiling openings remain design intent; model their appearance explicitly. Return JSON only; never executable code.",
            };
            const [created] =
              await sql`INSERT INTO agent_jobs (id,interior_id,surface_id,surface_name,revision,input)
              VALUES (${crypto.randomUUID()},${id},${surface.id},${surface.name},${room.revision},${sql.json(input)}) RETURNING *`;
            return created;
          });
          return Response.json(job(row), { status: 201 });
        }
      } else {
        if (method === "GET") {
          const [row] = await db`SELECT * FROM interiors WHERE id = ${id}`;
          if (!row) throw new ApiError(404, "Interior not found");
          return Response.json(interior(row));
        }
        if (method === "PUT") {
          const data = saveInteriorSchema.parse(await body(req));
          const validSurfaces = surfacesFor(data.plan);
          for (const [key, surfacePlan] of Object.entries(data.surfaces)) {
            const surface = validSurfaces.find((s) => s.id === key);
            if (!surface)
              throw new ApiError(400, "The plan contains an unknown surface");
            for (const element of surfacePlan.elements) {
              if (
                element.x + element.width > surface.width + 0.001 ||
                element.y + element.height > surface.height + 0.001
              )
                throw new ApiError(
                  400,
                  `A feature extends outside ${surface.name}. Resize or remove it first.`,
                );
            }
          }
          const updated = await db.begin(async (sql) => {
            const [old] =
              await sql`SELECT * FROM interiors WHERE id = ${id} FOR UPDATE`;
            if (!old) throw new ApiError(404, "Interior not found");
            if (old.revision !== data.revision)
              throw new ApiError(
                409,
                "This interior changed in another tab. Reload before saving.",
              );
            const geometryChanged = !isDeepStrictEqual(old.plan, data.plan);
            const changed = new Set(
              [
                ...Object.keys(old.surfaces),
                ...Object.keys(data.surfaces),
              ].filter(
                (key) =>
                  !isDeepStrictEqual(
                    old.surfaces[key] ?? blankSurface(),
                    data.surfaces[key] ?? blankSurface(),
                  ),
              ),
            );
            const jobs =
              await sql`SELECT id, surface_id FROM agent_jobs WHERE interior_id = ${id} AND status IN ('queued','running','completed')`;
            for (const item of jobs) {
              if (geometryChanged || changed.has(item.surface_id))
                await sql`UPDATE agent_jobs SET status = 'superseded', message = 'The plan changed; generate again to update this surface', lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = ${item.id}`;
            }
            const [row] =
              await sql`UPDATE interiors SET name = ${data.name}, description = ${data.description}, plan = ${sql.json(data.plan)},
              surfaces = ${sql.json(data.surfaces)}, revision = revision + 1, updated_at = now() WHERE id = ${id} RETURNING *`;
            return row;
          });
          return Response.json(interior(updated));
        }
        if (method === "DELETE") {
          const rows =
            await db`DELETE FROM interiors WHERE id = ${id} RETURNING id`;
          if (!rows.length) throw new ApiError(404, "Interior not found");
          return new Response(null, { status: 204 });
        }
      }
    }
    const cancel = path.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancel && method === "POST") {
      const rows =
        await db`UPDATE agent_jobs SET status = 'cancelled', message = 'Cancelled by you', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = ${uuid(cancel[1]!)} AND status IN ('queued','running') RETURNING *`;
      if (!rows.length)
        throw new ApiError(409, "This task is no longer active");
      return Response.json(job(rows[0]));
    }
    if (path === "/api/agent/schema" && method === "GET")
      return Response.json(sceneResultJsonSchema);
    if (path === "/api/agent/claim" && method === "POST") {
      const data = await body(req);
      if (
        typeof data.workerId !== "string" ||
        !data.workerId.trim() ||
        data.workerId.length > 120
      )
        throw new ApiError(400, "A workerId of 1–120 characters is required");
      await expireLeases();
      const [row] =
        await db`UPDATE agent_jobs SET status = 'running', worker_id = ${data.workerId}, lease_token = ${crypto.randomUUID()},
        lease_expires_at = now() + interval '2 minutes', attempt = attempt + 1, progress = 5, message = 'Agent is reading the surface plan', updated_at = now()
        WHERE id = (SELECT id FROM agent_jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
      if (!row) return new Response(null, { status: 204 });
      return Response.json({
        ...job(row),
        input: row.input,
        leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at,
        outputSchema: sceneResultJsonSchema,
      });
    }
    const worker = path.match(/^\/api\/agent\/jobs\/([^/]+)$/);
    if (worker && method === "PATCH") {
      const id = uuid(worker[1]!),
        data = await body(req);
      if (
        typeof data.leaseToken !== "string" ||
        !["running", "completed", "failed"].includes(data.status)
      )
        throw new ApiError(400, "A valid lease token and status are required");
      if (
        data.progress !== undefined &&
        (!Number.isInteger(data.progress) ||
          data.progress < 0 ||
          data.progress > 99)
      )
        throw new ApiError(400, "Progress must be an integer from 0 to 99");
      if (
        data.message !== undefined &&
        (typeof data.message !== "string" || data.message.length > 2000)
      )
        throw new ApiError(400, "Message must be at most 2000 characters");
      const result =
        data.status === "completed"
          ? sceneResultSchema.parse(data.result)
          : null;
      const updated = await db.begin(async (sql) => {
        const [record] =
          await sql`SELECT interior_id FROM agent_jobs WHERE id = ${id}`;
        if (!record) throw new ApiError(404, "Task not found");
        await sql`SELECT id FROM interiors WHERE id = ${record.interior_id} FOR UPDATE`;
        const [row] =
          await sql`UPDATE agent_jobs SET status = ${data.status}, progress = ${data.status === "completed" ? 100 : (data.progress ?? 10)},
          message = ${data.message ?? (data.status === "completed" ? "Design is ready" : data.status === "failed" ? "Agent could not finish this design" : "Agent is designing")},
          result = ${result ? sql.json(result) : null}, lease_expires_at = ${data.status === "running" ? new Date(Date.now() + 120_000) : null}, updated_at = now()
          WHERE id = ${id} AND lease_token::text = ${data.leaseToken} AND status = 'running' AND lease_expires_at > now() RETURNING *`;
        if (!row)
          throw new ApiError(
            409,
            "Task lease expired, was cancelled, or the plan changed",
          );
        if (data.status === "completed")
          await sql`UPDATE agent_jobs SET status = 'superseded', message = 'Replaced by a newer design', updated_at = now()
          WHERE interior_id = ${row.interior_id} AND surface_id = ${row.surface_id} AND status = 'completed' AND id <> ${id}`;
        return row;
      });
      return Response.json(job(updated));
    }
    throw new ApiError(404, "Endpoint not found");
  } catch (error: any) {
    if (error?.name === "ZodError")
      return Response.json(
        { error: error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("API request failed", error);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
