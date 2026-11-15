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
  assert.equal(r.status, expected, `${method} ${path}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}
assert.equal(
  (await request("/interiors")).length,
  0,
  "Use an empty isolated test stack",
);
let room = await request(
    "/interiors",
    "POST",
    { name: "Experiment test" },
    false,
    201,
  ),
  copyId: string | undefined;
try {
  room = await request(`/interiors/${room.id}`, "PUT", {
    ...room,
    surfaces: {
      "wall:a": {
        notes: "Keep door",
        elements: [
          {
            id: "door",
            kind: "opening",
            x: 1,
            y: 0,
            width: 1,
            height: 2.1,
            label: "Entry",
          },
        ],
      },
    },
  });
  const object = {
    id: "cabinet",
    label: "Cabinet",
    primitive: "box",
    position: [3, 3, 0.5],
    size: [2, 0.6, 1],
    rotation: [0, 0, 0],
    color: "#bbaa88",
    roughness: 0.7,
    metalness: 0,
  };
  await request(
    `/interiors/${room.id}/jobs`,
    "POST",
    { surfaceId: "floor", revision: room.revision },
    false,
    201,
  );
  let task = await request(
    "/agent/claim",
    "POST",
    { workerId: "experiment-smoke" },
    true,
  );
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    {
      leaseToken: task.leaseToken,
      status: "completed",
      result: { summary: "Baseline cabinet", objects: [object] },
    },
    true,
  );
  const metric = {
    id: "capacity",
    name: "Storage",
    unit: "m³",
    definition: "Usable storage volume",
    direction: "maximize",
    target: null,
    weight: 3,
  };
  const create = {
    name: "Better layout",
    goals: "Improve storage and usable space",
    constraints: "Keep the entrance clear",
    metrics: [metric],
    revision: room.revision,
  };
  await request(
    `/interiors/${room.id}/experiments`,
    "POST",
    { ...create, revision: 1 },
    false,
    409,
  );
  await request(
    `/interiors/${room.id}/experiments`,
    "POST",
    { ...create, metrics: [metric, metric] },
    false,
    400,
  );
  const { id } = await request(
    `/interiors/${room.id}/experiments`,
    "POST",
    create,
    false,
    201,
  );
  let e = await request(`/experiments/${id}`);
  const cached = await fetch(`${base}/api/experiments/${id}`);
  const etag = cached.headers.get("ETag");
  assert(etag);
  assert.equal(
    (
      await fetch(`${base}/api/experiments/${id}`, {
        headers: { "If-None-Match": etag },
      })
    ).status,
    304,
  );
  assert.equal(e.baseline.designs[0].result.objects[0].id, "cabinet");
  assert.equal(
    e.baseline.interior.surfaces["wall:a"].elements[0].kind,
    "opening",
  );
  await request(
    `/experiments/${id}/generate`,
    "POST",
    { count: 5, brief: "" },
    false,
    400,
  );
  await request(
    `/experiments/${id}/generate`,
    "POST",
    { count: 2, brief: "Try vertical storage" },
    false,
    201,
  );
  await request(
    `/experiments/${id}/generate`,
    "POST",
    { count: 1, brief: "" },
    false,
    409,
  );
  task = await request(
    "/agent/claim",
    "POST",
    { workerId: "experiment-smoke" },
    true,
  );
  assert.equal(task.kind, "experiment");
  assert.equal(task.input.count, 2);
  assert(task.outputSchema.properties.variants);
  assert.equal(task.input.baseline.interior.plan.height, 2.7);
  // Changes to the source do not invalidate immutable experiment work.
  room = await request(`/interiors/${room.id}`, "PUT", {
    ...room,
    plan: { ...room.plan, height: 3 },
  });
  assert.equal((await request(`/experiments/${id}`)).jobs[0].status, "running");
  assert.equal(
    (await request(`/interiors/${room.id}/jobs`)).some(
      (j: any) => j.kind === "experiment",
    ),
    false,
  );
  const evaluation = (value: number | null) => ({
    metricId: "capacity",
    value,
    explanation: "0.5 m usable depth × shelf height × length",
    confidence: "medium",
  });
  const variant = (name: string, value: number) => ({
    name,
    summary: "An alternative storage layout",
    approach: "Use vertical cabinetry",
    assumptions: ["Cabinet inner depth estimated"],
    tradeoffs: ["Less open wall area"],
    evaluations: [evaluation(value)],
    designs: [
      {
        surfaceId: "floor",
        result: {
          summary: name,
          objects: [{ ...object, id: name, size: [2, 0.6, value] }],
        },
      },
    ],
  });
  const result = {
    baselineEvaluations: [evaluation(0.5)],
    variants: [variant("Tall cabinets", 1.2), variant("Low cabinets", 0.8)],
  };
  async function finish(result: any, expected = 200) {
    return request(
      `/agent/jobs/${task.id}`,
      "PATCH",
      { leaseToken: task.leaseToken, status: "completed", result },
      true,
      expected,
    );
  }
  await finish({ ...result, variants: [result.variants[0]] }, 400);
  await finish(
    {
      ...result,
      variants: result.variants.map((v) => ({
        ...v,
        evaluations: [{ ...evaluation(1), metricId: "unknown" }],
      })),
    },
    400,
  );
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    { leaseToken: crypto.randomUUID(), status: "running", progress: 40 },
    true,
    409,
  );
  await finish(result);
  await finish(result, 409);
  e = await request(`/experiments/${id}`);
  assert.equal(e.variants.length, 2);
  assert.equal(e.baseline.interior.plan.height, 2.7);
  assert.equal(e.sourceRevision, room.revision);
  assert.equal(e.jobs[0].result, null);
  assert.equal(e.jobs[0].objectCount, 2);
  assert.equal(e.jobs[0].leaseToken, undefined);
  const ids = e.variants.map((v: any) => v.id).reverse();
  await request(
    `/experiments/${id}/ranking`,
    "PUT",
    { ids: [ids[0], ids[0]], revision: e.revision },
    false,
    400,
  );
  await request(
    `/experiments/${id}/ranking`,
    "PUT",
    { ids, revision: e.revision - 1 },
    false,
    409,
  );
  await request(`/experiments/${id}/ranking`, "PUT", {
    ids,
    revision: e.revision,
  });
  e = await request(`/experiments/${id}`);
  assert.deepEqual(
    e.variants.map((v: any) => v.id),
    ids,
  );
  assert.equal(e.variants[0].rank, 1);
  await request(`/experiments/${id}/variants/${ids[0]}`, "PATCH", {
    notes: "Best circulation",
    shortlisted: true,
    revision: e.revision,
  });
  e = await request(`/experiments/${id}`);
  assert.equal(e.variants[0].notes, "Best circulation");
  assert(e.variants[0].shortlisted);
  await request(
    `/experiments/${id}/generate`,
    "POST",
    { count: 1, brief: "Another approach" },
    false,
    201,
  );
  task = await request(
    "/agent/claim",
    "POST",
    { workerId: "experiment-smoke" },
    true,
  );
  assert.equal(task.input.baselineEvaluations[0].value, 0.5);
  assert.equal(task.input.previousVariants.length, 2);
  await finish({ ...result, variants: [variant("Third", 1.1)] }, 400);
  await finish({ baselineEvaluations: [], variants: [variant("Third", 1.1)] });
  e = await request(`/experiments/${id}`);
  assert.equal(e.variants.length, 3);
  assert.equal(e.variants[2].rank, 3);
  assert.equal(e.baselineEvaluations[0].value, 0.5);
  await request(
    `/experiments/${id}/generate`,
    "POST",
    { count: 1, brief: "Cancel test" },
    false,
    201,
  );
  task = await request(
    "/agent/claim",
    "POST",
    { workerId: "experiment-smoke" },
    true,
  );
  await request(`/jobs/${task.id}/cancel`, "POST");
  await finish(
    { baselineEvaluations: [], variants: [variant("Cancelled", 1)] },
    409,
  );
  assert.equal((await request(`/experiments/${id}`)).variants.length, 3);
  const copy = await request(
    `/experiments/${id}/variants/${ids[0]}/copy`,
    "POST",
    {},
    false,
    201,
  );
  copyId = copy.interior.id;
  assert.equal(copy.interior.plan.height, 2.7);
  assert.deepEqual(copy.interior.surfaces, e.baseline.interior.surfaces);
  assert.equal(
    (await request(`/interiors/${copyId}/jobs`))[0].result.objects.length,
    1,
  );
  assert.equal((await request(`/interiors/${room.id}`)).plan.height, 3);
  await request(`/experiments/${id}`, "DELETE", undefined, false, 204);
  await request(`/experiments/${id}`, "GET", undefined, false, 404);
  assert.equal((await request(`/interiors/${copyId}`)).id, copyId);
  console.log(
    "Passed: baseline snapshots, custom metrics, generation validation, source isolation, cancellation, repeated batches, ranking conflicts, reviews, shortlist, and independent interior copies.",
  );
} finally {
  await request(`/interiors/${room.id}`, "DELETE", undefined, false, 204);
  if (copyId)
    await request(`/interiors/${copyId}`, "DELETE", undefined, false, 204);
}
