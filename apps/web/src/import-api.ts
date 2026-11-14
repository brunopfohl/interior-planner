import { db } from "@interior-planner/db";
import {
  blankSurface,
  surfacesFor,
  type Job,
  type JobInput,
} from "@interior-planner/shared";
import {
  importChatSchema,
  importReplySchema,
  type ImportJobInput,
} from "@interior-planner/shared/imports";
import { ApiError, body, uuid } from "./http";

type Row = Record<string, any>;
type JobMapper = (row: Row) => Job;
const stamp = (value: unknown) => new Date(value as string).toISOString();
function image(row: Row) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/api/imports/${row.import_id}/images/${row.id}`,
  };
}
function message(row: Row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    revision: row.revision,
    imageIds: row.image_ids,
    reply: row.reply,
    createdAt: stamp(row.created_at),
  };
}
async function lockedSession(sql: any, id: string) {
  const [session] =
    await sql`SELECT * FROM scene_imports WHERE id=${id} FOR UPDATE`;
  if (!session) throw new ApiError(404, "Import conversation not found");
  if (session.interior_id)
    throw new ApiError(
      409,
      "This import has already created an interior. Open it in the editor.",
    );
  return session;
}
async function ensureIdle(sql: any, id: string) {
  const [job] =
    await sql`SELECT id FROM agent_jobs WHERE import_id=${id} AND status IN ('queued','running')`;
  if (job)
    throw new ApiError(
      409,
      "Codex is still replying. Wait or cancel the current turn first.",
    );
}
function sniff(data: Uint8Array) {
  if (
    data.length > 12 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 13 &&
    data[5] === 10 &&
    data[6] === 26 &&
    data[7] === 10
  )
    return "image/png";
  if (data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    data.length > 12 &&
    new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(data.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new ApiError(400, "Upload a PNG, JPEG, or WebP image.");
}
async function imageResponse(id: string, sessionId?: string) {
  const [row] = sessionId
    ? await db`SELECT * FROM import_images WHERE id=${id} AND import_id=${sessionId}`
    : await db`SELECT * FROM import_images WHERE id=${id}`;
  if (!row) throw new ApiError(404, "Reference image not found");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
    },
  });
}

export async function importRoutes(
  req: Request,
  mapJob: JobMapper,
): Promise<Response | null> {
  const path = new URL(req.url).pathname,
    method = req.method;
  const agentImage = path.match(/^\/api\/agent\/images\/([^/]+)$/);
  if (agentImage && method === "GET")
    return imageResponse(uuid(agentImage[1]!));
  if (path === "/api/imports") {
    if (method === "GET")
      return Response.json(
        (
          await db`SELECT s.*, (SELECT count(*)::int FROM import_images i WHERE i.import_id=s.id) image_count FROM scene_imports s ORDER BY updated_at DESC LIMIT 50`
        ).map((s: Row) => ({
          id: s.id,
          name: s.name,
          interiorId: s.interior_id,
          imageCount: s.image_count,
          createdAt: stamp(s.created_at),
          updatedAt: stamp(s.updated_at),
        })),
      );
    if (method === "POST") {
      const id = crypto.randomUUID();
      await db`INSERT INTO scene_imports(id) VALUES(${id})`;
      return Response.json({ id }, { status: 201 });
    }
  }
  const route = path.match(
    /^\/api\/imports\/([^/]+)(?:\/(images|messages|apply)(?:\/([^/]+))?)?$/,
  );
  if (!route) return null;
  const id = uuid(route[1]!),
    action = route[2],
    imageId = route[3] ? uuid(route[3]) : undefined;
  if (!action && method === "GET") {
    const [session] = await db`SELECT * FROM scene_imports WHERE id=${id}`;
    if (!session) throw new ApiError(404, "Import conversation not found");
    const images =
      await db`SELECT id,import_id,name,mime,size FROM import_images WHERE import_id=${id} ORDER BY created_at,id`;
    const messages =
      await db`SELECT * FROM import_messages WHERE import_id=${id} ORDER BY created_at,id`;
    const jobs =
      await db`SELECT * FROM agent_jobs WHERE import_id=${id} ORDER BY created_at DESC LIMIT 30`;
    return Response.json({
      id,
      name: session.name,
      revision: session.revision,
      interiorId: session.interior_id,
      createdAt: stamp(session.created_at),
      updatedAt: stamp(session.updated_at),
      images: images.map(image),
      messages: messages.map(message),
      jobs: jobs.map(mapJob),
    });
  }
  if (!action && method === "DELETE") {
    await db`DELETE FROM scene_imports WHERE id=${id}`;
    return new Response(null, { status: 204 });
  }
  if (action === "images") {
    if (imageId && method === "GET") return imageResponse(imageId, id);
    if (!imageId && method === "POST") {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new ApiError(400, "Choose an image file to upload.");
      }
      const file = form.get("file");
      if (!(file instanceof File))
        throw new ApiError(400, "An image file is required");
      if (!file.size || file.size > 8 * 1024 * 1024)
        throw new ApiError(400, "Each image must be between 1 byte and 8 MB.");
      const data = new Uint8Array(await file.arrayBuffer()),
        mime = sniff(data),
        imageId = crypto.randomUUID(),
        name =
          file.name.replace(/[/\\\x00-\x1f]/g, "_").slice(0, 180) ||
          "Reference image";
      await db.begin(async (sql) => {
        await lockedSession(sql, id);
        await ensureIdle(sql, id);
        const [count] =
          await sql`SELECT count(*)::int n FROM import_images WHERE import_id=${id}`;
        if (count.n >= 6)
          throw new ApiError(400, "Use up to 6 reference images per import.");
        await sql`INSERT INTO import_images(id,import_id,name,mime,size,data) VALUES(${imageId},${id},${name},${mime},${file.size},${data})`;
        await sql`UPDATE scene_imports SET revision=revision+1,updated_at=now() WHERE id=${id}`;
      });
      return Response.json(
        image({ id: imageId, import_id: id, name, mime, size: file.size }),
        { status: 201 },
      );
    }
    if (imageId && method === "DELETE") {
      await db.begin(async (sql) => {
        await lockedSession(sql, id);
        await ensureIdle(sql, id);
        await sql`DELETE FROM import_images WHERE id=${imageId} AND import_id=${id}`;
        await sql`UPDATE scene_imports SET revision=revision+1,updated_at=now() WHERE id=${id}`;
      });
      return new Response(null, { status: 204 });
    }
  }
  if (action === "messages" && method === "POST") {
    const data = importChatSchema.parse(await body(req));
    const result = await db.begin(async (sql) => {
      const session = await lockedSession(sql, id);
      await ensureIdle(sql, id);
      const revision = session.revision + 1,
        images =
          await sql`SELECT id,import_id,name,mime,size FROM import_images WHERE import_id=${id} ORDER BY created_at,id`;
      if (!images.length)
        throw new ApiError(400, "Upload at least one reference image first.");
      const [created] =
        await sql`INSERT INTO import_messages(id,import_id,role,content,revision,image_ids) VALUES(${crypto.randomUUID()},${id},'user',${data.content},${revision},${sql.json(images.map((i: Row) => i.id))}) RETURNING *`;
      const history =
        await sql`SELECT * FROM import_messages WHERE import_id=${id} ORDER BY created_at,id`;
      const previous =
        [...history].reverse().find((m: Row) => m.reply?.proposal)?.reply
          .proposal ?? null;
      const input: ImportJobInput = {
        kind: "import",
        sessionId: id,
        images: images.map(image),
        messages: history.slice(-20).map((m: Row) => ({
          role: m.role,
          content: m.content,
          reply: m.reply ? { ...m.reply, proposal: null } : null,
        })),
        previousProposal: previous,
      };
      const [job] =
        await sql`INSERT INTO agent_jobs(id,kind,import_id,surface_id,surface_name,revision,input,events,message)
        VALUES(${crypto.randomUUID()},'import',${id},'import','Image import',${revision},${sql.json(input)},${sql.json([{ at: new Date().toISOString(), kind: "queued", message: "References and conversation queued for Codex" }])},'Waiting for Codex to review your images') RETURNING *`;
      const name =
        session.name === "Image import"
          ? data.content.slice(0, 80)
          : session.name;
      await sql`UPDATE scene_imports SET revision=${revision},name=${name},updated_at=now() WHERE id=${id}`;
      return { message: message(created), job: mapJob(job) };
    });
    return Response.json(result, { status: 201 });
  }
  if (action === "apply" && method === "POST") {
    const data = await body(req),
      messageId = uuid(data.messageId ?? "");
    const result = await db.begin(async (sql) => {
      const session = await lockedSession(sql, id);
      await ensureIdle(sql, id);
      const [reply] =
        await sql`SELECT * FROM import_messages WHERE id=${messageId} AND import_id=${id} AND role='assistant'`;
      if (!reply?.reply?.proposal)
        throw new ApiError(400, "This reply has no scene proposal to apply.");
      if (reply.revision !== session.revision)
        throw new ApiError(
          409,
          "The conversation or references changed. Ask Codex for an updated proposal.",
        );
      const proposal = importReplySchema.parse(reply.reply).proposal!,
        interiorId = crypto.randomUUID();
      const plans = Object.fromEntries(
        proposal.surfacePlans.map((p) => [
          p.surfaceId,
          { notes: p.notes, elements: p.elements },
        ]),
      );
      const [room] =
        await sql`INSERT INTO interiors(id,name,description,plan,surfaces) VALUES(${interiorId},${proposal.name},${proposal.description},${sql.json(proposal.plan)},${sql.json(plans)}) RETURNING *`;
      for (const design of proposal.designs) {
        const surface = surfacesFor(proposal.plan).find(
          (s) => s.id === design.surfaceId,
        )!;
        const input: JobInput = {
          interiorName: proposal.name,
          floorPlan: proposal.plan,
          surface,
          surfacePlan: plans[surface.id] ?? blankSurface(),
          instructions: `Imported from image conversation ${id}. ${proposal.summary}`,
        };
        await sql`INSERT INTO agent_jobs(id,interior_id,surface_id,surface_name,status,revision,input,result,progress,message,worker_id,events)
          VALUES(${crypto.randomUUID()},${interiorId},${surface.id},${surface.name},'completed',1,${sql.json(input)},${sql.json(design.result)},100,${design.result.summary},'codex-image-import',${sql.json([{ at: new Date().toISOString(), kind: "completed", message: "Applied from the reviewed image-import proposal" }])})`;
      }
      await sql`UPDATE scene_imports SET interior_id=${interiorId},name=${proposal.name},updated_at=now() WHERE id=${id}`;
      return {
        interior: {
          id: room.id,
          name: room.name,
          description: room.description,
          plan: room.plan,
          surfaces: room.surfaces,
          revision: room.revision,
          createdAt: stamp(room.created_at),
          updatedAt: stamp(room.updated_at),
        },
      };
    });
    return Response.json(result, { status: 201 });
  }
  throw new ApiError(404, "Import endpoint not found");
}

export async function updateImportJob(
  id: string,
  data: any,
  mapJob: JobMapper,
) {
  const reply =
    data.status === "completed" ? importReplySchema.parse(data.result) : null;
  if (
    data.draftResult !== undefined &&
    JSON.stringify(data.draftResult).length > 750_000
  )
    throw new ApiError(400, "Draft report is too large");
  const messageText =
    data.message ??
    (data.status === "completed"
      ? "Codex replied; review the import conversation"
      : "Codex is reviewing your references");
  const updated = await db.begin(async (sql) => {
    const [record] = await sql`SELECT import_id FROM agent_jobs WHERE id=${id}`;
    if (!record) throw new ApiError(404, "Import task not found");
    const session = await lockedSession(sql, record.import_id);
    const [job] =
      await sql`UPDATE agent_jobs SET status=${data.status},progress=CASE WHEN ${data.status}='completed' THEN 100 ELSE COALESCE(${data.progress ?? null},progress) END,
      events=CASE WHEN message IS DISTINCT FROM ${messageText} OR status IS DISTINCT FROM ${data.status} THEN events || ${sql.json([{ at: new Date().toISOString(), kind: data.status, message: messageText }])} ELSE events END,
      message=${messageText},result=${reply ? sql.json(reply) : null},draft_result=COALESCE(${data.draftResult ? sql.json(data.draftResult) : null},draft_result),
      lease_expires_at=${data.status === "running" ? new Date(Date.now() + 120_000) : null},updated_at=now()
      WHERE id=${id} AND status='running' AND lease_token::text=${data.leaseToken} AND lease_expires_at>now() AND revision=${session.revision} RETURNING *`;
    if (!job)
      throw new ApiError(
        409,
        "The import task expired, was cancelled, or its context changed",
      );
    if (reply)
      await sql`INSERT INTO import_messages(id,import_id,role,content,revision,reply) VALUES(${crypto.randomUUID()},${record.import_id},'assistant',${reply.message},${job.revision},${sql.json(reply)})`;
    await sql`UPDATE scene_imports SET updated_at=now() WHERE id=${record.import_id}`;
    return job;
  });
  return Response.json(mapJob(updated));
}
