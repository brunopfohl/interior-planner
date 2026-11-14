import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { area, bounds, type SurfacePlan } from "@interior-planner/shared";
import type {
  AppliedImport,
  ImportSession,
} from "@interior-planner/shared/imports";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { JobBadge, ThemeMenu, type Notify } from "./app";
const RoomScene = lazy(() =>
  import("./room-scene").then((m) => ({ default: m.RoomScene })),
);
type Props = { go: (path: string) => unknown; notify: Notify };
type SessionSummary = {
  id: string;
  name: string;
  imageCount: number;
  interiorId: string | null;
  updatedAt: string;
};
export function ImportHub({ go, notify }: Props) {
  const [items, setItems] = useState<SessionSummary[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setItems(await api("/imports"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <header className="topbar">
        <span className="text-xs subtle">Workspace / Image imports</span>
        <ThemeMenu />
      </header>
      <div className="page-body">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">Start with what you have</p>
            <h1 className="page-heading">Image imports</h1>
            <p className="mt-3 text-[13px] subtle">
              Upload plans or photos. Work through the details with Codex.
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await api<{ id: string }>("/imports", {
                  method: "POST",
                });
                go(`/imports/${s.id}`);
              } catch (e: any) {
                notify(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Plus />
            New import
          </Button>
        </div>
        <div className="mt-8 space-y-3">
          {loading ? (
            <Loader2 className="animate-spin size-5" />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !items.length ? (
            <div className="empty-room">
              <ImagePlus className="size-8 mb-4 subtle" />
              <p>No imports yet</p>
              <p className="mt-2 text-xs subtle text-center">
                A measured drawing or a few room photos are enough to start a
                conversation.
              </p>
            </div>
          ) : (
            items.map((s) => (
              <article
                key={s.id}
                className="rounded-lg border p-5 flex items-center gap-4"
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => go(`/imports/${s.id}`)}
                >
                  <h2 className="text-sm font-medium truncate">{s.name}</h2>
                  <p className="text-xs subtle mt-2">
                    {s.imageCount} images ·{" "}
                    {s.interiorId ? "Interior created" : "Conversation"} ·{" "}
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete import ${s.name}`}
                  onClick={async () => {
                    if (
                      !confirm(
                        "Delete this conversation and its reference images? Any created interior will be kept.",
                      )
                    )
                      return;
                    try {
                      await api(`/imports/${s.id}`, { method: "DELETE" });
                      await load();
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open ${s.name}`}
                  onClick={() => go(`/imports/${s.id}`)}
                >
                  <ArrowUpRight className="size-4" />
                </Button>
              </article>
            ))
          )}
        </div>
      </div>
    </>
  );
}
export function ImportChat({
  id,
  go,
  notify,
  onDirtyChange,
  onApplied,
}: Props & {
  id: string;
  onDirtyChange: (dirty: boolean) => void;
  onApplied: () => unknown;
}) {
  const [session, setSession] = useState<ImportSession | null>(null),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<"plan" | "3d">("3d"),
    [showDesigns, setShowDesigns] = useState(true);
  const input = useRef<HTMLInputElement>(null),
    messages = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      setSession(await api(`/imports/${id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    onDirtyChange(!!text.trim());
  }, [text, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    messages.current?.scrollTo({
      top: messages.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.messages.length]);
  const active = session?.jobs.find(
      (j) => j.status === "queued" || j.status === "running",
    ),
    latest = session?.jobs[0];
  const proposalMessage = session?.messages.findLast(
      (m) => !!m.reply?.proposal,
    ),
    proposal = proposalMessage?.reply?.proposal;
  const stale =
    !!proposalMessage && proposalMessage.revision !== session?.revision;
  const locked = busy || !!active || !!session?.interiorId;
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 8 * 1024 * 1024)
          throw new Error(`${file.name} exceeds 8 MB`);
        const form = new FormData();
        form.set("file", file);
        await api(`/imports/${id}/images`, { method: "POST", body: form });
      }
      await load();
    } catch (e: any) {
      notify(e.message);
      await load();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !text.trim()) return;
    setBusy(true);
    try {
      await api(`/imports/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      setText("");
      await load();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <div className="page-body">
        <Button variant="ghost" onClick={() => go("/imports")}>
          <ArrowLeft />
          Image imports
        </Button>
        <p className="mt-8 text-sm" role={error ? "alert" : undefined}>
          {error || "Loading conversation…"}
        </p>
      </div>
    );
  const box = proposal ? bounds(proposal.plan.points) : null;
  const plans: Record<string, SurfacePlan> = Object.fromEntries(
    proposal?.surfacePlans.map((p) => [
      p.surfaceId,
      { notes: p.notes, elements: p.elements },
    ]) ?? [],
  );
  return (
    <>
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to image imports"
            onClick={() => go("/imports")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium truncate">{session.name}</span>
        </div>
        <ThemeMenu />
      </header>
      <div className="import-layout">
        <section className="import-conversation">
          <div className="border-b p-5">
            <h1 className="text-lg font-medium tracking-tight">
              Build the scene together
            </h1>
            <p className="text-xs subtle mt-2 leading-5">
              Share images, describe the space, and refine Codex’s proposal.
              Your interior is created when you approve the preview.
            </p>
          </div>
          <div ref={messages} className="import-messages" aria-live="polite">
            {!session.messages.length && (
              <div className="rounded-lg bg-muted/40 p-5 text-sm leading-6">
                <ImagePlus className="size-6 mb-3" />
                <p>Start with a floor plan, a sketch, or room photos.</p>
                <p className="subtle mt-2">
                  Tell Codex what to recreate and include a known measurement,
                  such as the length of a wall. It can ask questions before
                  drawing a proposal.
                </p>
              </div>
            )}
            {session.messages.map((m) => (
              <article
                key={m.id}
                className={`rounded-lg border p-4 ${m.role === "user" ? "bg-muted/40 ml-5" : "mr-2"}`}
              >
                <div className="text-[10px] uppercase tracking-wider subtle mb-2">
                  {m.role === "user" ? "You" : "Codex"}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 break-words">
                  {m.content}
                </p>
                {!!m.reply?.questions.length && (
                  <ul className="mt-3 pl-4 list-disc text-xs leading-6">
                    {m.reply.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                )}
                {m.reply?.proposal && (
                  <p className="mt-3 border-t pt-3 text-xs font-medium flex items-center gap-2">
                    <Check className="size-3" />
                    Scene proposal saved · {m.reply.proposal.name}
                  </p>
                )}
              </article>
            ))}
            {active && (
              <div className="border rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <JobBadge status={active.status} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api(`/jobs/${active.id}/cancel`, {
                          method: "POST",
                        });
                        await load();
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    Cancel turn
                  </Button>
                </div>
                <p className="text-xs mt-3 subtle">{active.message}</p>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.max(3, active.progress)}%` }}
                  />
                </div>
              </div>
            )}
            {!active &&
              latest &&
              (latest.status === "failed" || latest.status === "cancelled") && (
                <div className="border rounded-lg p-4">
                  <JobBadge status={latest.status} />
                  <p className="mt-2 text-xs text-destructive">
                    {latest.message}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() =>
                      setText(
                        session.messages.findLast((m) => m.role === "user")
                          ?.content ?? "",
                      )
                    }
                  >
                    Edit and retry message
                  </Button>
                </div>
              )}
          </div>
          <form onSubmit={send} className="border-t p-4 space-y-3">
            {session.interiorId ? (
              <Button
                className="w-full"
                type="button"
                onClick={() => go(`/interiors/${session.interiorId}`)}
              >
                Open created interior
                <ArrowUpRight />
              </Button>
            ) : (
              <>
                <Textarea
                  aria-label="Message Codex"
                  placeholder="Describe your space or answer Codex’s questions…"
                  value={text}
                  maxLength={8000}
                  onChange={(e) => setText(e.target.value)}
                  disabled={locked}
                  className="min-h-[95px] resize-y"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] subtle">
                    {active
                      ? "Codex is working on this turn…"
                      : "Uses your connected Codex worker"}
                  </span>
                  <Button
                    disabled={locked || !text.trim() || !session.images.length}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Send />}Send
                  </Button>
                </div>
              </>
            )}
          </form>
        </section>
        <section className="import-review">
          <div className="p-5 border-b">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">
                Reference images{" "}
                <span className="subtle">{session.images.length}/6</span>
              </h2>
              <Button
                variant="outline"
                size="sm"
                disabled={locked || session.images.length >= 6}
                onClick={() => input.current?.click()}
              >
                <ImagePlus />
                Upload images
              </Button>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                aria-label="Upload reference images"
                onChange={(e) => void upload(e.target.files)}
              />
            </div>
            <p className="mt-2 text-[10px] subtle">
              PNG, JPEG, WebP · up to 8 MB each. Stored with this conversation.
            </p>
            <div
              className="mt-4 flex gap-3 overflow-x-auto pb-1"
              onDragOver={(e) => {
                if (!locked) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!locked) void upload(e.dataTransfer.files);
              }}
            >
              {session.images.map((image) => (
                <div key={image.id} className="relative shrink-0 w-28">
                  <a href={image.url} target="_blank" rel="noreferrer">
                    <img
                      className="w-28 h-20 rounded border object-contain bg-white"
                      src={image.url}
                      alt={image.name}
                    />
                  </a>
                  <p
                    className="text-[10px] subtle truncate mt-1"
                    title={image.name}
                  >
                    {image.name}
                  </p>
                  {!locked && (
                    <button
                      className="absolute top-1 right-1 bg-background border rounded-full p-1"
                      aria-label={`Remove ${image.name}`}
                      onClick={async () => {
                        try {
                          await api(`/imports/${id}/images/${image.id}`, {
                            method: "DELETE",
                          });
                          await load();
                        } catch (e: any) {
                          notify(e.message);
                        }
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
              {!session.images.length && (
                <button
                  className="border border-dashed rounded-lg min-h-24 w-full text-xs subtle"
                  disabled={locked}
                  onClick={() => input.current?.click()}
                >
                  Drop images here or click to upload
                </button>
              )}
            </div>
          </div>
          {proposal && box ? (
            <>
              <div className="p-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">{proposal.name}</h2>
                  <p className="text-[11px] subtle mt-1">
                    {area(proposal.plan.points).toFixed(1)} m² ·{" "}
                    {proposal.plan.height} m ceiling ·{" "}
                    {proposal.designs.reduce(
                      (n, d) => n + d.result.objects.length,
                      0,
                    )}{" "}
                    objects
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={view === "plan" ? "secondary" : "ghost"}
                    onClick={() => setView("plan")}
                  >
                    Plan
                  </Button>
                  <Button
                    size="sm"
                    variant={view === "3d" ? "secondary" : "ghost"}
                    onClick={() => setView("3d")}
                  >
                    3D
                  </Button>
                </div>
              </div>
              <div className="import-preview">
                {view === "3d" ? (
                  <Suspense
                    fallback={
                      <p className="p-6 text-xs subtle">Loading 3D preview…</p>
                    }
                  >
                    <RoomScene
                      plan={proposal.plan}
                      surfacePlans={plans}
                      jobs={[]}
                      previewDesigns={proposal.designs}
                      selected="floor"
                      onSelect={() => {}}
                      showDesigns={showDesigns}
                      onToggleDesigns={() => setShowDesigns(!showDesigns)}
                      focusObject={null}
                    />
                  </Suspense>
                ) : (
                  <svg
                    role="img"
                    aria-label="Proposed floor plan"
                    viewBox={`${box.minX - 0.7} ${box.minY - 0.7} ${box.width + 1.4} ${box.height + 1.4}`}
                    className="w-full h-full p-6"
                  >
                    <polygon
                      points={proposal.plan.points
                        .map((p) => `${p.x},${p.y}`)
                        .join(" ")}
                      fill="var(--muted)"
                      stroke="var(--foreground)"
                      strokeWidth=".06"
                    />
                    {proposal.plan.points.map((p, i) => {
                      const next =
                        proposal.plan.points[
                          (i + 1) % proposal.plan.points.length
                        ]!;
                      return (
                        <text
                          key={p.id}
                          x={(p.x + next.x) / 2}
                          y={(p.y + next.y) / 2 - 0.12}
                          fontSize=".18"
                          fill="var(--foreground)"
                          textAnchor="middle"
                        >
                          {Math.hypot(p.x - next.x, p.y - next.y).toFixed(2)} m
                        </text>
                      );
                    })}
                  </svg>
                )}
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs leading-6 whitespace-pre-wrap">
                  {proposal.summary}
                </p>
                {!!proposal.assumptions.length && (
                  <div className="rounded-lg border p-4">
                    <h3 className="text-xs font-medium">
                      Assumptions to review
                    </h3>
                    <ul className="mt-2 text-xs subtle leading-6 list-disc pl-4">
                      {proposal.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {stale && !session.interiorId && (
                  <p className="text-xs text-destructive">
                    The conversation or images have changed since this preview.
                    Ask Codex for an updated proposal before creating the
                    interior.
                  </p>
                )}
                {!!text.trim() && proposal && !session.interiorId && (
                  <p className="text-xs subtle">
                    Send your draft message or clear it before creating the
                    interior.
                  </p>
                )}
                {!session.interiorId && (
                  <Button
                    className="w-full"
                    disabled={locked || stale || !!text.trim()}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await api<AppliedImport>(
                          `/imports/${id}/apply`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              messageId: proposalMessage!.id,
                            }),
                          },
                        );
                        setText("");
                        onDirtyChange(false);
                        await onApplied();
                        notify("Interior created from your reviewed proposal");
                        await load();
                      } catch (e: any) {
                        notify(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Check />
                    Create interior from this proposal
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-64 flex flex-col items-center justify-center p-8 text-center">
              <div className="size-14 border rounded-xl flex items-center justify-center mb-5">
                <ImagePlus className="size-6 subtle" />
              </div>
              <h2 className="text-sm font-medium">
                Your scene preview will appear here
              </h2>
              <p className="text-xs subtle leading-6 max-w-72 mt-2">
                Codex can clarify dimensions first, then propose a floor plan
                and 3D details for you to review.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="p-4 text-xs text-destructive">
              {error}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
