import { chmod } from "node:fs/promises";

const [command, ...args] = Bun.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const required = (name: string) => {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
const base =
  Bun.env.AGENT_API_URL ?? `http://localhost:${Bun.env.PORT ?? 3000}`;
async function request(path: string, method = "GET", data?: unknown) {
  if (!Bun.env.AGENT_TOKEN)
    throw new Error(
      "AGENT_TOKEN is required. Set it in the root .env and restart the web container.",
    );
  const response = await fetch(`${base}/api/agent${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${Bun.env.AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
try {
  if (command === "schema")
    console.log(JSON.stringify(await request("/schema"), null, 2));
  else if (command === "claim") {
    const out = required("out"),
      workerId = required("worker");
    const result = await request("/claim", "POST", { workerId });
    if (!result) {
      console.log("No queued tasks");
      process.exit(2);
    }
    await Bun.write(out, JSON.stringify(result, null, 2));
    await chmod(out, 0o600);
    console.log(
      `Claimed ${result.id} (${result.surfaceName}). Task written to ${out}. Send a heartbeat at least every 45 seconds.`,
    );
  } else if (["heartbeat", "complete", "fail"].includes(command ?? "")) {
    const task = await Bun.file(required("task")).json();
    const status =
      command === "heartbeat"
        ? "running"
        : command === "complete"
          ? "completed"
          : "failed";
    const data: Record<string, unknown> = {
      leaseToken: task.leaseToken,
      status,
      message: option("message"),
    };
    if (option("progress")) data.progress = Number(option("progress"));
    if (command === "complete")
      data.result = await Bun.file(required("result")).json();
    const result = await request(`/jobs/${task.id}`, "PATCH", data);
    console.log(`${result.id}: ${result.status} — ${result.message}`);
  } else {
    console.log(`Interior Planner worker interface

bun run agent claim --worker <name> --out /tmp/interior-task.json
bun run agent heartbeat --task /tmp/interior-task.json --progress 40 --message "Designing joinery"
bun run agent complete --task /tmp/interior-task.json --result /tmp/interior-result.json
bun run agent fail --task /tmp/interior-task.json --message "Reason"
bun run agent schema

Uses AGENT_TOKEN from .env and AGENT_API_URL (default http://localhost:PORT).
See docs/CODEX-WORKER.md for the design and coordinate contract.`);
    if (command) process.exitCode = 1;
  }
} catch (error: any) {
  console.error(error.message);
  process.exitCode = 1;
}
