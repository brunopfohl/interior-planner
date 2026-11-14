import { useEffect, useState } from "react";
import { AlertCircle, Check, Download, Eye, Loader2 } from "lucide-react";
import type { Job, JobDetails } from "@interior-planner/shared";
import { api } from "../lib/api";
import { outcome, taskMessage } from "../lib/design";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function TaskDetails({
  task,
  onClose,
  onShowObject,
}: {
  task: Job | null;
  onClose: () => void;
  onShowObject?: (surfaceId: string, objectId: string) => void;
}) {
  const [detail, setDetail] = useState<JobDetails | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!task) return;
    let alive = true;
    setDetail(null);
    setError("");
    const load = () =>
      api<JobDetails>(`/jobs/${task.id}`)
        .then((data) => {
          if (alive) setDetail(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [task?.id]);
  const result = detail?.result;
  const rejected = detail?.draftResult as
    | { summary?: string; objects?: unknown[] }
    | undefined;
  function download() {
    if (!detail) return;
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `design-${detail.id}.json`;
    a.click();
    URL.revokeObjectURL(href);
  }
  return (
    <Dialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[680px] max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task?.surfaceName} · Agent report</DialogTitle>
          <DialogDescription>
            What was requested, what the agent produced, and what reached the
            scene.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !detail ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="animate-spin size-5" />
          </div>
        ) : (
          <>
            <div
              className={`rounded-lg border p-4 ${detail.status === "failed" ? "border-destructive/40" : ""}`}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                {detail.status === "failed" ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : detail.status === "completed" ? (
                  <Check className="size-4" />
                ) : (
                  <Loader2 className="size-4" />
                )}
                {outcome(detail)}
              </div>
              <p className="mt-2 text-xs leading-5 subtle whitespace-pre-wrap">
                {taskMessage(detail.message)}
              </p>
            </div>
            <section>
              <h3 className="text-xs font-medium mb-2">
                Your saved instructions
              </h3>
              <p className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap leading-5">
                {detail.input.surfacePlan.notes ||
                  "No written instructions. The agent used the surface plan."}
              </p>
              <p className="mt-2 text-[10px] subtle">
                {detail.input.surfacePlan.elements.length} sketched features ·
                Plan revision {detail.revision} ·{" "}
                {detail.input.surface.width.toFixed(2)} ×{" "}
                {detail.input.surface.height.toFixed(2)} m
              </p>
            </section>
            {(result || rejected) && (
              <section>
                <h3 className="text-xs font-medium mb-2">
                  {result
                    ? "Agent’s design summary"
                    : "Rejected proposal — not applied"}
                </h3>
                <p className="text-xs leading-6 whitespace-pre-wrap">
                  {result?.summary ??
                    rejected?.summary ??
                    "The proposal did not pass validation."}
                </p>
                {!result && (
                  <p className="text-[10px] subtle mt-2">
                    {Array.isArray(rejected?.objects)
                      ? rejected.objects.length
                      : 0}{" "}
                    proposed objects. The scene was left unchanged.
                  </p>
                )}
              </section>
            )}
            {result && (
              <section>
                <h3 className="text-xs font-medium mb-3">
                  Applied objects ({result.objects.length})
                </h3>
                <div className="space-y-2">
                  {result.objects.map((object) => (
                    <div
                      key={object.id}
                      className="border rounded-md p-3 flex items-start gap-3"
                    >
                      <span
                        className="size-5 rounded border shrink-0"
                        style={{ background: object.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{object.label}</p>
                        <p className="text-[10px] subtle mt-1">
                          {object.primitive} ·{" "}
                          {object.size
                            .map((n) => Number(n.toFixed(3)))
                            .join(" × ")}{" "}
                          m
                        </p>
                        <p className="text-[10px] subtle mt-1">
                          Position:{" "}
                          {object.position
                            .map((n) => Number(n.toFixed(3)))
                            .join(", ")}{" "}
                          m · {object.color}
                        </p>
                      </div>
                      {onShowObject && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Show ${object.label} in 3D`}
                          onClick={() => {
                            onShowObject(detail.surfaceId, object.id);
                            onClose();
                          }}
                        >
                          <Eye />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {detail.status === "failed" && !rejected && (
              <p className="text-xs subtle leading-5">
                This older run did not save its rejected proposal. Its failure
                reason is shown above; no geometry was applied.
              </p>
            )}
            <section>
              <h3 className="text-xs font-medium mb-3">Run timeline</h3>
              <ol className="border-l pl-4 space-y-4">
                {(detail.events.length
                  ? detail.events
                  : [
                      {
                        at: detail.createdAt,
                        kind: "queued",
                        message: "Task queued",
                      },
                      {
                        at: detail.updatedAt,
                        kind: detail.status,
                        message: taskMessage(detail.message),
                      },
                    ]
                ).map((event, index) => (
                  <li key={index}>
                    <p className="text-[10px] subtle">
                      {new Date(event.at).toLocaleTimeString()}
                    </p>
                    <p className="text-xs leading-5 mt-1">{event.message}</p>
                  </li>
                ))}
              </ol>
            </section>
            <div className="flex items-center justify-between border-t pt-4 text-[10px] subtle">
              <span>
                {detail.workerId ?? "Unassigned"} · Attempt {detail.attempt}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={download}
              >
                <Download />
                Download report
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DesignOutcome({
  task,
  onInspect,
  onView,
  onRetry,
}: {
  task: Job;
  onInspect: () => void;
  onView?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`design-outcome ${task.status === "failed" ? "border-destructive/40" : ""}`}
      role="status"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        {task.status === "failed" ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : task.status === "completed" ? (
          <Check className="size-4" />
        ) : (
          <Loader2
            className={`size-4 ${task.status === "running" ? "animate-spin" : ""}`}
          />
        )}
        <span>
          {task.surfaceName}: {outcome(task)}
        </span>
      </div>
      <p className="text-[11px] leading-5 subtle mt-2 line-clamp-3">
        {taskMessage(task.message)}
      </p>
      {task.status === "running" && (
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}
      {(task.status === "running" || task.status === "queued") && (
        <p className="text-[9px] subtle mt-2">
          {task.workerId ?? "Unassigned"} · Last update{" "}
          {new Date(task.updatedAt).toLocaleTimeString()}
        </p>
      )}
      <div className="mt-3 flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="text-[11px] h-7"
          onClick={onInspect}
        >
          Inspect run
        </Button>
        {task.status === "completed" && onView && (
          <Button size="sm" className="text-[11px] h-7" onClick={onView}>
            <Eye />
            Show changes
          </Button>
        )}
        {task.status === "failed" && onRetry && (
          <Button size="sm" className="text-[11px] h-7" onClick={onRetry}>
            Retry design
          </Button>
        )}
      </div>
    </div>
  );
}
