import type { Job } from "@interior-planner/shared";

export function taskMessage(message: string) {
  try {
    const issues = JSON.parse(message);
    if (Array.isArray(issues) && issues[0]?.message)
      return issues
        .map(
          (issue) =>
            `${issue.path?.[0] === "objects" ? `Object ${Number(issue.path[1]) + 1}, ${issue.path.slice(2).join(" ")}: ` : ""}${issue.message}`,
        )
        .join("; ");
  } catch {}
  return message;
}
export function outcome(task: Job) {
  if (task.kind === "import" && task.status === "completed")
    return "Codex replied — review the import conversation";
  if (task.status === "failed") return "No changes applied";
  if (task.status === "completed")
    return task.objectCount
      ? `${task.objectCount} objects applied to ${task.surfaceName.toLowerCase()}`
      : "Finished without adding geometry";
  if (task.status === "superseded") return "This design is no longer applied";
  if (task.status === "cancelled") return "Cancelled — no new changes applied";
  return task.status === "queued"
    ? "Waiting for the design worker"
    : "Design in progress — scene unchanged until validation passes";
}
