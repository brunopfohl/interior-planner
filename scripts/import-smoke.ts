import { strict as assert } from "node:assert";
const base = Bun.env.AGENT_API_URL ?? "http://localhost:3001",
  token = Bun.env.AGENT_TOKEN;
assert(token);
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  worker = false,
  expected = 200,
) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(worker ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await r.text();
  assert.equal(r.status, expected, `${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
assert.equal(
  (await request("/interiors")).length,
  0,
  "Run against an empty isolated test stack",
);
const session = await request("/imports", "POST", {}, false, 201);
let interiorId: string | undefined;
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4WQAAAAASUVORK5CYII=",
    "base64",
  ),
);
async function upload(bytes: Uint8Array, name: string, expected = 201) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes).buffer], name));
  const r = await fetch(`${base}/api/imports/${session.id}/images`, {
    method: "POST",
    body: form,
  });
  const result = await r.json();
  assert.equal(r.status, expected, JSON.stringify(result));
  return result;
}
try {
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "Import this" },
    false,
    400,
  );
  await upload(new TextEncoder().encode("<svg></svg>"), "bad.svg", 400);
  const image = await upload(png, "plan.png");
  const bytes = await fetch(`${base}${image.url}`);
  assert.equal(bytes.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), png);
  await request(`/agent/images/${image.id}`, "GET", undefined, false, 401);
  const secureImage = await fetch(`${base}/api/agent/images/${image.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.deepEqual(new Uint8Array(await secureImage.arrayBuffer()), png);
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "Import this plan" },
    false,
    201,
  );
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "Concurrent turn" },
    false,
    409,
  );
  await upload(png, "blocked.png", 409);
  let task = await request(
    "/agent/claim",
    "POST",
    { workerId: "import-smoke" },
    true,
  );
  assert.equal(task.kind, "import");
  assert.equal(task.input.images[0].id, image.id);
  assert(task.outputSchema.properties.proposal);
  async function finish(result: any, expected = 200) {
    return request(
      `/agent/jobs/${task.id}`,
      "PATCH",
      { leaseToken: task.leaseToken, status: "completed", result },
      true,
      expected,
    );
  }
  await finish({
    message: "How long is the wall?",
    questions: ["What is the scale?"],
    proposal: null,
  });
  let data = await request(`/imports/${session.id}`);
  assert.equal(data.messages.length, 2);
  assert.equal(data.messages[1].reply.proposal, null);
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "It is 6 by 4 metres, 2.7 m high" },
    false,
    201,
  );
  task = await request(
    "/agent/claim",
    "POST",
    { workerId: "import-smoke" },
    true,
  );
  assert.equal(task.input.messages.length, 3);
  const proposal = {
    name: "Imported test",
    description: "Test",
    summary: "Measured shell and beige floor",
    assumptions: ["Wall thickness estimated at 15 cm"],
    plan: {
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 6, y: 0 },
        { id: "c", x: 6, y: 4 },
        { id: "d", x: 0, y: 4 },
      ],
      height: 2.7,
      wallThickness: 0.15,
    },
    surfacePlans: [
      {
        surfaceId: "wall:a",
        notes: "Door",
        elements: [
          {
            id: "door",
            kind: "opening",
            x: 0.5,
            y: 0,
            width: 0.9,
            height: 2.1,
            label: "Entry",
          },
        ],
      },
    ],
    designs: [
      {
        surfaceId: "floor",
        result: {
          summary: "Beige floor",
          objects: [
            {
              id: "floor-finish",
              label: "Beige floor",
              primitive: "box",
              position: [3, 2, 0.01],
              size: [6, 4, 0.02],
              rotation: [0, 0, 0],
              color: "#c6bca5",
              roughness: 0.8,
              metalness: 0,
            },
          ],
        },
      },
    ],
  };
  await finish(
    {
      message: "Invalid",
      questions: [],
      proposal: {
        ...proposal,
        surfacePlans: [
          { ...proposal.surfacePlans[0], surfaceId: "wall:missing" },
        ],
      },
    },
    400,
  );
  await finish({ message: "Here is the scene", questions: [], proposal });
  await finish({ message: "Duplicate", questions: [], proposal }, 409);
  data = await request(`/imports/${session.id}`);
  const message = data.messages.at(-1);
  assert.equal(data.jobs[0].objectCount, 1);
  assert.equal(data.jobs[0].leaseToken, undefined);
  await upload(png, "second.png");
  await request(
    `/imports/${session.id}/apply`,
    "POST",
    { messageId: message.id },
    false,
    409,
  );
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "Keep this proposal with the new reference" },
    false,
    201,
  );
  task = await request(
    "/agent/claim",
    "POST",
    { workerId: "import-smoke" },
    true,
  );
  assert.equal(task.input.previousProposal.name, proposal.name);
  await finish({ message: "Updated", questions: [], proposal });
  data = await request(`/imports/${session.id}`);
  const applied = await request(
    `/imports/${session.id}/apply`,
    "POST",
    { messageId: data.messages.at(-1).id },
    false,
    201,
  );
  interiorId = applied.interior.id;
  assert.equal(applied.interior.plan.points[1].x, 6);
  assert.equal(applied.interior.surfaces["wall:a"].elements[0].kind, "opening");
  const jobs = await request(`/interiors/${interiorId}/jobs`);
  assert.equal(jobs[0].result.objects.length, 1);
  await request(
    `/imports/${session.id}/apply`,
    "POST",
    { messageId: data.messages.at(-1).id },
    false,
    409,
  );
  await request(
    `/imports/${session.id}/messages`,
    "POST",
    { content: "Too late" },
    false,
    409,
  );
  console.log(
    "Passed: image validation and binary storage, authenticated downloads, chat snapshots, queue exclusion, clarification, proposal validation, stale protection, apply and duplicate protection.",
  );
} finally {
  await request(`/imports/${session.id}`, "DELETE", undefined, false, 204);
  if (interiorId)
    await request(`/interiors/${interiorId}`, "DELETE", undefined, false, 204);
}
