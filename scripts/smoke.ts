import { strict as assert } from "node:assert";

// Run only against an isolated test stack: the test starts with an empty database.
const base = Bun.env.AGENT_API_URL ?? "http://localhost:3001";
const token = Bun.env.AGENT_TOKEN;
assert(
  token,
  "AGENT_TOKEN is required for the isolated queue integration test",
);
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  worker = false,
  expected = 200,
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(worker ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
assert.equal(
  (await request("/interiors")).length,
  0,
  "Use a fresh isolated test database; refusing to touch an existing workspace",
);
await request("/agent/claim", "POST", { workerId: "unauthorized" }, false, 401);
await request("/interiors", "POST", { name: " " }, false, 400);
const room = await request(
  "/interiors",
  "POST",
  { name: "Queue integration test" },
  false,
  201,
);
try {
  await request(
    `/interiors/${room.id}`,
    "PUT",
    {
      ...room,
      plan: { ...room.plan, points: [...room.plan.points].reverse() },
    },
    false,
    400,
  );
  let saved = await request(`/interiors/${room.id}`, "PUT", {
    ...room,
    surfaces: {
      "wall:a": {
        notes: "Design a low oak cabinet",
        elements: [
          {
            id: "feature",
            kind: "feature",
            x: 1,
            y: 0,
            width: 2,
            height: 0.8,
            label: "Oak cabinet",
          },
          {
            id: "sketch",
            kind: "stroke",
            x: 1,
            y: 1,
            width: 2,
            height: 1,
            label: "Shelving sketch",
            color: "#171717",
            strokeWidth: 0.02,
            points: [
              { x: 0, y: 0 },
              { x: 0.5, y: 1 },
              { x: 1, y: 0 },
            ],
          },
        ],
      },
    },
  });
  await request(`/interiors/${room.id}`, "PUT", room, false, 409);
  const first = await request(
    `/interiors/${room.id}/jobs`,
    "POST",
    { surfaceId: "wall:a", revision: saved.revision },
    false,
    201,
  );
  await request(
    `/interiors/${room.id}/jobs`,
    "POST",
    { surfaceId: "wall:a", revision: saved.revision },
    false,
    409,
  );
  const second = await request(
    `/interiors/${room.id}/jobs`,
    "POST",
    { surfaceId: "wall:b", revision: saved.revision },
    false,
    201,
  );
  const claims = await Promise.all(
    [0, 1, 2].map(async (i) => {
      const response = await fetch(`${base}/api/agent/claim`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workerId: `integration-${i}` }),
      });
      assert([200, 204].includes(response.status));
      return response.status === 204 ? null : await response.json();
    }),
  );
  const claimed = claims.filter(Boolean);
  assert.equal(claimed.length, 2);
  assert.notEqual(claimed[0].id, claimed[1].id);
  const task = claimed.find((t) => t.id === first.id),
    other = claimed.find((t) => t.id === second.id);
  assert(task && other);
  assert.equal(task.input.surfacePlan.notes, "Design a low oak cabinet");
  assert.equal(task.input.surfacePlan.elements[1].kind, "stroke");
  assert.equal(task.input.surfacePlan.elements[1].points.length, 3);
  assert(task.outputSchema.properties.objects);
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    {
      leaseToken: task.leaseToken,
      status: "running",
      progress: 44,
      message: "Building cabinetry",
    },
    true,
  );
  const visible = (await request(`/interiors/${room.id}/jobs`)).find(
    (j: any) => j.id === task.id,
  );
  assert.equal(visible.progress, 44);
  assert.equal(visible.message, "Building cabinetry");
  assert.equal(visible.leaseToken, undefined);
  const rejectedDraft = {
    summary: "An invalid thin tile proposal",
    objects: [{ id: "tile", size: [0.6, 0.6, 0.0001] }],
  };
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    {
      leaseToken: task.leaseToken,
      status: "running",
      message: "Checking generated geometry",
      draftResult: rejectedDraft,
    },
    true,
  );
  const report = await request(`/jobs/${task.id}`);
  assert.equal(report.input.surfacePlan.notes, "Design a low oak cabinet");
  assert.deepEqual(report.draftResult, rejectedDraft);
  assert.equal(report.result, null);
  assert.equal(report.leaseToken, undefined);
  assert(
    report.events.some(
      (event: any) => event.message === "Checking generated geometry",
    ),
  );
  assert.equal(
    report.progress,
    44,
    "Heartbeats without progress must not reset it",
  );
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    { leaseToken: crypto.randomUUID(), status: "running" },
    true,
    409,
  );
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    {
      leaseToken: task.leaseToken,
      status: "completed",
      result: { summary: "Bad result", objects: [{ primitive: "code" }] },
    },
    true,
    400,
  );
  const result = {
    summary: "An agent-designed oak cabinet",
    objects: [
      {
        id: "cabinet",
        label: "Oak cabinet",
        primitive: "box",
        position: [2, 0.4, 0.25],
        size: [2, 0.8, 0.5],
        rotation: [0, 0, 0],
        color: "#a88a65",
        roughness: 0.7,
        metalness: 0,
      },
    ],
  };
  const completed = await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    { leaseToken: task.leaseToken, status: "completed", result },
    true,
  );
  assert.equal(completed.progress, 100);
  assert.deepEqual(completed.result, result);
  const completedReport = await request(`/jobs/${task.id}`);
  assert.equal(completedReport.objectCount, 1);
  assert(
    completedReport.events.some((event: any) => event.kind === "completed"),
  );
  await request(
    `/agent/jobs/${task.id}`,
    "PATCH",
    { leaseToken: task.leaseToken, status: "completed", result },
    true,
    409,
  );
  saved = await request(`/interiors/${room.id}`, "PUT", {
    ...saved,
    surfaces: {
      ...saved.surfaces,
      "wall:a": {
        ...saved.surfaces["wall:a"],
        notes: "Change the cabinet to walnut",
      },
    },
  });
  let jobs = await request(`/interiors/${room.id}/jobs`);
  assert.equal(jobs.find((j: any) => j.id === task.id).status, "superseded");
  assert.equal(jobs.find((j: any) => j.id === other.id).status, "running");
  await request(`/jobs/${other.id}/cancel`, "POST");
  await request(
    `/agent/jobs/${other.id}`,
    "PATCH",
    { leaseToken: other.leaseToken, status: "completed", result },
    true,
    409,
  );
  const fresh = await request(
    `/interiors/${room.id}/jobs`,
    "POST",
    { surfaceId: "wall:a", revision: saved.revision },
    false,
    201,
  );
  const claimedFresh = await request(
    "/agent/claim",
    "POST",
    { workerId: "integration-final" },
    true,
  );
  assert.equal(claimedFresh.id, fresh.id);
  await request(`/interiors/${room.id}`, "PUT", {
    ...saved,
    plan: { ...saved.plan, height: 3 },
  });
  await request(
    `/agent/jobs/${fresh.id}`,
    "PATCH",
    { leaseToken: claimedFresh.leaseToken, status: "completed", result },
    true,
    409,
  );
  jobs = await request(`/interiors/${room.id}/jobs`);
  assert.equal(jobs.find((j: any) => j.id === fresh.id).status, "superseded");
  console.log(
    "Passed: CRUD, plan validation, revision conflicts, concurrent claims, progress, output validation, completion, cancellation, and stale-result protection.",
  );
} finally {
  await request(`/interiors/${room.id}`, "DELETE", undefined, false, 204);
}
