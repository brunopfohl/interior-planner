import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FolderOpen,
  Layers3,
  LayoutGrid,
  Loader2,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Sun,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  area,
  bounds,
  type Interior,
  type Job,
} from "@interior-planner/shared";
import { api } from "../lib/api";
import { outcome, taskMessage } from "../lib/design";
import { TaskDetails } from "./task-details";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Editor } from "./editor";

export type Notify = (message: string) => void;
const statusNames: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Designing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  superseded: "Outdated",
};
export function JobBadge({ status }: { status: Job["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5 text-[10px] font-normal">
      {status === "running" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : status === "completed" ? (
        <Check className="size-3" />
      ) : (
        <span className="status-dot" />
      )}{" "}
      {statusNames[status]}
    </Badge>
  );
}
export function ThemeMenu() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("interior-theme") ?? "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("interior-theme", theme);
    } catch {}
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[
          ["light", Sun],
          ["dark", Moon],
          ["system", Monitor],
        ].map(([value, Icon]: any) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" />
            {value[0].toUpperCase() + value.slice(1)}
            {theme === value && <Check className="ml-auto size-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function PlanThumbnail({ room }: { room: Interior }) {
  const box = bounds(room.plan.points),
    pad = Math.max(box.width, box.height) * 0.16;
  return (
    <svg
      viewBox={`${box.minX - pad} ${box.minY - pad} ${box.width + pad * 2} ${box.height + pad * 2}`}
      className="h-[150px] w-[80%]"
      aria-label={`Floor plan, ${area(room.plan.points).toFixed(1)} square metres`}
    >
      <polygon
        points={room.plan.points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="var(--background)"
        stroke="var(--foreground)"
        strokeWidth=".07"
        strokeLinejoin="miter"
      />
      {room.plan.points.map((p) => (
        <rect
          key={p.id}
          x={p.x - 0.055}
          y={p.y - 0.055}
          width=".11"
          height=".11"
          fill="var(--foreground)"
        />
      ))}
    </svg>
  );
}
export function App() {
  const [rooms, setRooms] = useState<Interior[]>([]),
    [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [path, setPath] = useState(location.pathname),
    [section, setSection] = useState("interiors");
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<"recent" | "name">("recent");
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState("");
  const [deleteRoom, setDeleteRoom] = useState<Interior | null>(null),
    [agentConfigured, setAgentConfigured] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [inspectedTask, setInspectedTask] = useState<Job | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const load = useCallback(async () => {
    try {
      const data = await api<Interior[]>("/interiors");
      setRooms(data);
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
  const loadJobs = useCallback(async () => {
    try {
      setJobs(await api<Job[]>("/jobs"));
      setAgentConfigured(
        (await api<{ agentConfigured: boolean }>("/settings")).agentConfigured,
      );
    } catch {}
  }, []);
  useEffect(() => {
    void loadJobs();
    const timer = setInterval(loadJobs, 3000);
    return () => clearInterval(timer);
  }, [loadJobs]);
  useEffect(() => {
    const pop = () => {
      if (editorDirty && !confirm("Leave without saving your changes?")) {
        history.pushState(null, "", path);
        return;
      }
      setPath(location.pathname);
      setEditorDirty(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [editorDirty, path]);
  const go = (to: string) => {
    if (editorDirty && !confirm("Leave without saving your changes?"))
      return false;
    history.pushState(null, "", to);
    setPath(to);
    setEditorDirty(false);
    if (to === "/") void load();
    return true;
  };
  const roomId = path.match(/^\/interiors\/([^/]+)$/)?.[1];
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const visible = rooms
    .filter((room) =>
      `${room.name} ${room.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const room = await api<Interior>("/interiors", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
      setCreating(false);
      setName("");
      setDescription("");
      await load();
      go(`/interiors/${room.id}`);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 className="size-[19px]" />
          </span>
          <span className="brand-name">
            Interior<span className="font-normal subtle"> / </span>Plan
          </span>
        </div>
        <div className="nav-label">Workspace</div>
        <button
          className={`nav-item ${section === "interiors" ? "active" : ""}`}
          aria-label="Interiors"
          onClick={() => {
            if (go("/")) setSection("interiors");
          }}
        >
          <LayoutGrid className="size-4" />
          <span className="nav-text">Interiors</span>
          <span className="nav-count ml-auto text-[11px] subtle">
            {rooms.length}
          </span>
        </button>
        <button
          className={`nav-item ${section === "activity" && !roomId ? "active" : ""}`}
          aria-label="Agent queue"
          onClick={() => {
            if (go("/")) setSection("activity");
          }}
        >
          <Workflow className="size-4" />
          <span className="nav-text">Agent queue</span>
          {activeJobs.length > 0 && (
            <span className="nav-count ml-auto text-[11px]">
              {activeJobs.length}
            </span>
          )}
        </button>
        <div className="sidebar-bottom">
          <div className="flex items-center gap-2 text-xs">
            <span className="status-dot" />
            Local workspace
          </div>
          <p className="mt-2 text-[11px] leading-5 subtle">
            Your spaces. From a first line
            <br />
            to the final detail.
          </p>
          <div className="mt-5 flex items-center gap-2 text-[10px] subtle">
            <Box className="size-3" />
            Bun + PostgreSQL
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        {roomId ? (
          <Editor
            key={roomId}
            id={roomId}
            notify={notify}
            onBack={() => {
              if (go("/")) setSection("interiors");
            }}
            onSaved={load}
            onJobsChanged={loadJobs}
            agentConfigured={agentConfigured}
            onDirtyChange={setEditorDirty}
          />
        ) : (
          <>
            <header className="topbar">
              <div className="flex items-center gap-2 text-xs subtle">
                <FolderOpen className="size-3.5" />
                Workspace
                <ChevronRight className="size-3" />
                <span className="text-foreground">
                  {section === "activity" ? "Agent queue" : "Interiors"}
                </span>
              </div>
              <ThemeMenu />
            </header>
            <div className="page-body">
              {section === "interiors" ? (
                <>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="eyebrow mb-3">A space for every idea</p>
                      <h1 className="page-heading">Your interiors</h1>
                      <p className="mt-3 text-[13px] subtle">
                        Plan the space. Shape the details. See it come together.
                      </p>
                    </div>
                    <Button onClick={() => setCreating(true)}>
                      <Plus />
                      New interior
                    </Button>
                  </div>
                  <div className="mt-9 mb-6 flex items-center justify-between gap-4 border-b pb-5">
                    <div className="relative w-full max-w-[280px]">
                      <Search className="absolute left-3 top-2.5 size-3.5 subtle" />
                      <Input
                        className="pl-9 h-9 text-xs"
                        placeholder="Search interiors…"
                        aria-label="Search interiors"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs subtle"
                      onClick={() =>
                        setSort(sort === "recent" ? "name" : "recent")
                      }
                    >
                      <ArrowDownUp className="size-3.5" />
                      <span className="hide-mobile">
                        {sort === "recent" ? "Recently edited" : "Name A–Z"}
                      </span>
                    </Button>
                  </div>
                  {error ? (
                    <div className="empty-room">
                      <p>{error}</p>
                      <Button variant="outline" className="mt-4" onClick={load}>
                        Try again
                      </Button>
                    </div>
                  ) : loading ? (
                    <div className="empty-room">
                      <Loader2 className="animate-spin size-5 subtle" />
                      <p className="mt-4 subtle text-xs">
                        Loading your interiors…
                      </p>
                    </div>
                  ) : rooms.length === 0 ? (
                    <div className="empty-room">
                      <svg
                        viewBox="0 0 130 116"
                        className="w-[120px] mb-5"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M65 8 115 35v55l-50 18-50-28V27L65 8Z"
                          stroke="var(--border)"
                          strokeWidth="1.5"
                        />
                        <path
                          d="m15 80 50-20 50 30M65 8v52m0 0v48M15 27l50 29 50-21"
                          stroke="var(--muted-foreground)"
                          strokeWidth="1.1"
                        />
                        <path
                          d="m39 71 25-10 27 14-24 10-28-14Z"
                          fill="var(--muted)"
                          stroke="var(--foreground)"
                          strokeWidth="1.2"
                        />
                        <path
                          d="M39 71V46l25-11 27 15v25M64 35v26"
                          stroke="var(--foreground)"
                          strokeWidth="1.2"
                        />
                      </svg>
                      <h2 className="text-base font-medium tracking-tight">
                        Every interior starts with a plan.
                      </h2>
                      <p className="mt-2 max-w-[290px] text-center text-xs leading-6 subtle">
                        Create your first space, draw its floor plan,
                        <br />
                        and make room for your ideas.
                      </p>
                      <Button
                        className="mt-6"
                        onClick={() => setCreating(true)}
                      >
                        <Plus />
                        Create your first interior
                      </Button>
                      <p className="mt-5 text-[10px] subtle">
                        Floor plans · Surface details · 3D views
                      </p>
                    </div>
                  ) : visible.length === 0 ? (
                    <div className="empty-room">
                      <Search className="size-6 subtle mb-3" />
                      <p>No interiors match “{query}”.</p>
                      <Button variant="link" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 min-[850px]:grid-cols-2 min-[1400px]:grid-cols-3 gap-5">
                      {visible.map((room) => (
                        <article key={room.id} className="room-card">
                          <button
                            className="w-full text-left"
                            onClick={() => go(`/interiors/${room.id}`)}
                          >
                            <div className="plan-thumbnail">
                              <PlanThumbnail room={room} />
                              <Badge
                                variant="outline"
                                className="absolute right-3 top-3 bg-background text-[9px] font-normal"
                              >
                                {area(room.plan.points).toFixed(1)} m²
                              </Badge>
                            </div>
                            <div className="px-5 pt-5 flex justify-between items-center">
                              <h2 className="font-medium tracking-tight truncate">
                                {room.name}
                              </h2>
                              <ArrowUpRight className="size-4 subtle" />
                            </div>
                            <p className="px-5 mt-1.5 text-xs subtle truncate">
                              {room.description ||
                                `${room.plan.points.length} walls · ${room.plan.height} m ceiling`}
                            </p>
                          </button>
                          <div className="flex items-center justify-between px-5 pb-3 pt-4">
                            <span className="text-[10px] subtle">
                              Edited{" "}
                              {new Date(room.updatedAt).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Options for ${room.name}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => go(`/interiors/${room.id}`)}
                                >
                                  <FolderOpen />
                                  Open interior
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteRoom(room)}
                                >
                                  <Trash2 />
                                  Delete interior
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div className="mt-9 flex items-center justify-between text-[10px] subtle">
                    <span>
                      {rooms.length}{" "}
                      {rooms.length === 1 ? "interior" : "interiors"} in your
                      workspace
                    </span>
                    <span className="hide-mobile">
                      Designed around your space.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="eyebrow mb-3">Behind the scenes</p>
                  <h1 className="page-heading">Agent queue</h1>
                  <p className="mt-3 text-[13px] subtle">
                    Follow each surface from design instructions to 3D geometry.
                  </p>
                  <div className="mt-7 rounded-lg border p-4 flex items-center gap-3">
                    <Workflow className="size-4" />
                    <div>
                      <p className="text-xs font-medium">
                        {agentConfigured
                          ? "Worker interface enabled"
                          : "Waiting for a worker connection"}
                      </p>
                      <p className="text-xs subtle mt-1">
                        {agentConfigured
                          ? "A Codex worker can claim queued tasks. Progress appears here as it works."
                          : "You can queue designs now. Connect an external Codex worker to begin processing them."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-7 space-y-3">
                    {jobs.length === 0 ? (
                      <div className="empty-room min-h-[300px]">
                        <Clock3 className="size-7 subtle mb-4" />
                        <p className="font-medium">No tasks yet</p>
                        <p className="subtle text-xs mt-2">
                          Open an interior and generate a design for a surface.
                        </p>
                      </div>
                    ) : (
                      jobs.map((task) => (
                        <div key={task.id} className="border rounded-lg p-5">
                          <div className="flex justify-between items-center">
                            <button
                              className="text-sm font-medium flex gap-2 items-center"
                              onClick={() => {
                                setSection("interiors");
                                go(`/interiors/${task.interiorId}`);
                              }}
                            >
                              {rooms.find((r) => r.id === task.interiorId)
                                ?.name ?? "Interior"}
                              <ChevronRight className="size-3 subtle" />
                              {task.surfaceName}
                            </button>
                            <JobBadge status={task.status} />
                          </div>
                          <p
                            className={`text-xs mt-3 ${task.status === "failed" ? "text-destructive" : "font-medium"}`}
                          >
                            {outcome(task)}
                          </p>
                          <p className="text-xs subtle mt-2">
                            {taskMessage(task.message)}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3 text-xs"
                            onClick={() => setInspectedTask(task)}
                          >
                            Inspect run
                          </Button>
                          <div className="mt-3 flex justify-between text-[10px] subtle">
                            <span>
                              {task.workerId
                                ? `Worker: ${task.workerId}`
                                : "Unassigned"}{" "}
                              · Attempt {task.attempt}
                            </span>
                            <span>
                              {new Date(task.updatedAt).toLocaleString()}
                            </span>
                          </div>
                          {task.status === "running" && (
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>
      <TaskDetails
        task={inspectedTask}
        onClose={() => setInspectedTask(null)}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-[440px]">
          <form onSubmit={create}>
            <DialogHeader>
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg border">
                <Layers3 className="size-5" />
              </div>
              <DialogTitle>Create an interior</DialogTitle>
              <DialogDescription>
                Give your space a name. You can define its shape next.
              </DialogDescription>
            </DialogHeader>
            <div className="field">
              <Label htmlFor="interior-name">Name</Label>
              <Input
                id="interior-name"
                autoFocus
                placeholder="e.g. Ground floor, Kitchen, Apartment"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </div>
            <div className="field mb-6">
              <Label htmlFor="interior-description">
                Description{" "}
                <span className="subtle font-normal">(optional)</span>
              </Label>
              <Textarea
                id="interior-description"
                placeholder="A little context for your space…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                className="resize-none min-h-[90px]"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}Create
                interior
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteRoom}
        onOpenChange={(open) => {
          if (!open) setDeleteRoom(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteRoom?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes its plans, agent tasks, and generated
              geometry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRoom(null)}>
              Keep interior
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteRoom) return;
                setBusy(true);
                try {
                  await api(`/interiors/${deleteRoom.id}`, {
                    method: "DELETE",
                  });
                  setDeleteRoom(null);
                  await load();
                  await loadJobs();
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete interior
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {toast && (
        <div className="toast flex items-center gap-4" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X className="size-3.5 shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}
