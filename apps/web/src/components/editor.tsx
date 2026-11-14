import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  Clock3,
  DoorOpen,
  Layers,
  Layers3,
  Loader2,
  MousePointer2,
  PencilRuler,
  Save,
  Sparkles,
  Square,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  area,
  blankSurface,
  bounds,
  surfacesFor,
  validPolygon,
  type FloorPlan,
  type Interior,
  type Job,
  type PlanElement,
  type SurfacePlan,
} from "@interior-planner/shared";
import { api } from "../lib/api";
import { taskMessage } from "../lib/design";
import { DesignOutcome, TaskDetails } from "./task-details";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { FloorCanvas } from "./floor-canvas";
import { SurfaceCanvas } from "./surface-canvas";
const RoomScene = lazy(() =>
  import("./room-scene").then((module) => ({ default: module.RoomScene })),
);
import { JobBadge, ThemeMenu, type Notify } from "./app";

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 50,
  step = 0.05,
  unit = "m",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setText(String(Number(value.toFixed(3)))), [value]);
  return (
    <div className="field">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (text !== "" && Number.isFinite(n) && n >= min && n <= max)
              onChange(n);
            else setText(String(Number(value.toFixed(3))));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="pr-8 text-xs h-9"
        />
        <span className="absolute right-3 top-2.5 subtle text-[10px]">
          {unit}
        </span>
      </div>
    </div>
  );
}
function content(room: Interior) {
  return JSON.stringify({
    name: room.name,
    description: room.description,
    plan: room.plan,
    surfaces: room.surfaces,
  });
}

export function Editor({
  id,
  onBack,
  notify,
  onSaved,
  onJobsChanged,
  agentConfigured,
  onDirtyChange,
}: {
  id: string;
  onBack: () => void;
  notify: Notify;
  onSaved: () => unknown;
  onJobsChanged: () => unknown;
  agentConfigured: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [room, setRoom] = useState<Interior | null>(null),
    [draft, setDraft] = useState<Interior | null>(null),
    [error, setError] = useState("");
  const [view, setView] = useState<"floor" | "3d" | "surface">("floor"),
    [selectedSurface, setSelectedSurface] = useState("floor");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [selectionToolRequest, setSelectionToolRequest] = useState(0);
  const selectedElement = selectedElements[0] ?? null;
  function setSelectedElement(id: string | null) {
    setSelectedElements(id ? [id] : []);
  }
  const [surfaceHistory, setSurfaceHistory] = useState<
    Record<string, { past: SurfacePlan[]; future: SurfacePlan[] }>
  >({});
  const [snap, setSnap] = useState(true),
    [saving, setSaving] = useState(false),
    [queuing, setQueuing] = useState(false),
    [jobs, setJobs] = useState<Job[]>([]),
    [jobsError, setJobsError] = useState("");
  const [history, setHistory] = useState<
    { plan: FloorPlan; surfaces: Record<string, SurfacePlan> }[]
  >([]);
  const dirty = !!room && !!draft && content(room) !== content(draft);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    let alive = true;
    api<Interior>(`/interiors/${id}`)
      .then((data) => {
        if (alive) {
          setRoom(data);
          setDraft(data);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  const loadJobs = useCallback(async () => {
    try {
      setJobs(await api<Job[]>(`/interiors/${id}/jobs`));
      setJobsError("");
    } catch (e: any) {
      setJobsError(e.message);
    }
  }, [id]);
  useEffect(() => {
    void loadJobs();
    const timer = setInterval(loadJobs, 2000);
    return () => clearInterval(timer);
  }, [loadJobs]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const allSurfaces = useMemo(
    () => (draft ? surfacesFor(draft.plan) : []),
    [draft?.plan],
  );
  const surface =
    allSurfaces.find((s) => s.id === selectedSurface) ?? allSurfaces[0];
  const surfacePlan = draft?.surfaces[surface?.id ?? ""] ?? blankSurface();
  const element = surfacePlan.elements.find((e) => e.id === selectedElement);
  const point = draft?.plan.points.find((p) => p.id === selectedPoint);
  const surfaceJobs = jobs.filter((j) => j.surfaceId === surface?.id),
    active = surfaceJobs.find(
      (j) => j.status === "queued" || j.status === "running",
    );
  const done = jobs.filter((j) => j.status === "completed");
  const [inspectedTask, setInspectedTask] = useState<Job | null>(null);
  const [showDesigns, setShowDesigns] = useState(true);
  const [focusObject, setFocusObject] = useState<{
    surfaceId: string;
    objectId: string;
    nonce: number;
  } | null>(null);
  const latestTask =
    view === "floor"
      ? jobs.find((j) => j.surfaceId === "floor")
      : surfaceJobs[0];
  const appliedDesign = surfaceJobs.find((j) => j.status === "completed");
  function showObject(surfaceId: string, objectId: string) {
    selectSurface(surfaceId);
    setView("3d");
    setShowDesigns(true);
    setFocusObject({ surfaceId, objectId, nonce: Date.now() });
  }
  function changePlan(plan: FloorPlan, record = true) {
    if (!draft) return;
    if (!validPolygon(plan.points)) {
      notify("That change would create an invalid floor plan.");
      return;
    }
    if (record)
      setHistory((prev) => [
        ...prev.slice(-29),
        { plan: draft.plan, surfaces: draft.surfaces },
      ]);
    const ids = new Set(surfacesFor(plan).map((s) => s.id));
    setDraft({
      ...draft,
      plan,
      surfaces: Object.fromEntries(
        Object.entries(draft.surfaces).filter(([key]) => ids.has(key)),
      ),
    });
  }
  function changeSurface(value: SurfacePlan, record = true) {
    if (draft && surface) {
      if (JSON.stringify(surfacePlan) === JSON.stringify(value)) return;
      if (record)
        setSurfaceHistory((previous) => ({
          ...previous,
          [surface.id]: {
            past: [
              ...(previous[surface.id]?.past ?? []).slice(-49),
              surfacePlan,
            ],
            future: [],
          },
        }));
      setDraft({
        ...draft,
        surfaces: { ...draft.surfaces, [surface.id]: value },
      });
    }
  }
  function undoSurface() {
    if (!surface) return;
    const history = surfaceHistory[surface.id],
      previous = history?.past.at(-1);
    if (!previous) return;
    setSurfaceHistory({
      ...surfaceHistory,
      [surface.id]: {
        past: history!.past.slice(0, -1),
        future: [surfacePlan, ...history!.future],
      },
    });
    changeSurface(previous, false);
    setSelectedElements([]);
  }
  function redoSurface() {
    if (!surface) return;
    const history = surfaceHistory[surface.id],
      next = history?.future[0];
    if (!next) return;
    setSurfaceHistory({
      ...surfaceHistory,
      [surface.id]: {
        past: [...history!.past, surfacePlan],
        future: history!.future.slice(1),
      },
    });
    changeSurface(next, false);
    setSelectedElements([]);
  }
  function changeElement(data: Partial<PlanElement>) {
    if (element)
      changeSurface({
        ...surfacePlan,
        elements: surfacePlan.elements.map((e) =>
          e.id === element.id ? { ...e, ...data } : e,
        ),
      });
  }
  function selectSurface(id: string) {
    setSelectedSurface(id);
    setSelectedElement(null);
  }
  async function save(): Promise<Interior | undefined> {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api<Interior>(`/interiors/${id}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setRoom(saved);
      setDraft(saved);
      await loadJobs();
      void onSaved();
      return saved;
    } catch (e: any) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function generate() {
    if (surface) await queueDesign(surface.id);
  }
  async function queueDesign(surfaceId: string) {
    const target = allSurfaces.find((item) => item.id === surfaceId);
    if (!draft || !target || queuing) return;
    setQueuing(true);
    try {
      const saved = dirty ? await save() : draft;
      if (!saved) return;
      await api(`/interiors/${id}/jobs`, {
        method: "POST",
        body: JSON.stringify({
          surfaceId: target.id,
          revision: saved.revision,
        }),
      });
      await loadJobs();
      void onJobsChanged();
      notify(
        `${target.name} design queued${agentConfigured ? "" : " — waiting for a connected worker"}`,
      );
    } catch (e: any) {
      notify(e.message);
    } finally {
      setQueuing(false);
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [draft, dirty, saving]);
  if (error)
    return (
      <div className="page-body">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Back to interiors
        </Button>
        <p className="mt-8">{error}</p>
      </div>
    );
  if (!draft || !surface)
    return (
      <div className="flex h-screen items-center justify-center gap-3 subtle">
        <Loader2 className="size-5 animate-spin" />
        Opening interior…
      </div>
    );
  const box = bounds(draft.plan.points);
  return (
    <>
      <header className="topbar">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to interiors"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="subtle hide-mobile">Interiors</span>
          <ChevronRight className="size-3 subtle hide-mobile" />
          <span className="truncate font-medium">{draft.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] subtle flex items-center gap-1.5 hide-mobile">
            {dirty ? (
              <>
                <span className="status-dot" />
                Unsaved changes
              </>
            ) : (
              <>
                <Check className="size-3" />
                All changes saved
              </>
            )}
          </span>
          <ThemeMenu />
          <Button size="sm" disabled={!dirty || saving} onClick={() => save()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}Save
          </Button>
        </div>
      </header>
      <div className="editor-toolbar">
        <div className="flex gap-1" role="tablist" aria-label="Editor views">
          {(
            [
              ["floor", PencilRuler, "Floor plan"],
              ["3d", Box, "3D space"],
              ["surface", Layers, "Surfaces"],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              role="tab"
              aria-selected={view === mode}
              className={`view-tab ${view === mode ? "active" : ""}`}
              onClick={() => setView(mode)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] subtle hide-mobile">
          {area(draft.plan.points).toFixed(1)} m²<span className="mx-2">/</span>
          {draft.plan.points.length} walls
        </span>
      </div>
      <div className="editor-layout">
        <section
          className="editor-stage"
          aria-label={
            view === "floor"
              ? "Floor plan editor"
              : view === "3d"
                ? "3D room preview"
                : "Surface plan editor"
          }
        >
          {view === "floor" ? (
            <FloorCanvas
              design={
                showDesigns
                  ? (done.find((j) => j.surfaceId === "floor")?.result ??
                    undefined)
                  : undefined
              }
              plan={draft.plan}
              onChange={changePlan}
              selected={selectedPoint}
              onSelect={setSelectedPoint}
              snap={snap}
              notify={notify}
              canUndo={history.length > 0}
              onUndo={() => {
                const last = history.at(-1);
                if (last) {
                  setDraft({
                    ...draft,
                    plan: last.plan,
                    surfaces: last.surfaces,
                  });
                  setHistory(history.slice(0, -1));
                  setSelectedPoint(null);
                }
              }}
            />
          ) : view === "3d" ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 subtle text-xs">
                  <Loader2 className="size-4 animate-spin" />
                  Loading 3D view…
                </div>
              }
            >
              <RoomScene
                showDesigns={showDesigns}
                onToggleDesigns={() => setShowDesigns((value) => !value)}
                focusObject={focusObject}
                plan={draft.plan}
                surfacePlans={draft.surfaces}
                jobs={
                  dirty
                    ? jobs.filter(
                        (j) =>
                          !room ||
                          (JSON.stringify(room.plan) ===
                            JSON.stringify(draft.plan) &&
                            JSON.stringify(
                              room.surfaces[j.surfaceId] ?? blankSurface(),
                            ) ===
                              JSON.stringify(
                                draft.surfaces[j.surfaceId] ?? blankSurface(),
                              )),
                      )
                    : jobs
                }
                selected={surface.id}
                onSelect={selectSurface}
              />
            </Suspense>
          ) : (
            <SurfaceCanvas
              selectionToolRequest={selectionToolRequest}
              key={surface.id}
              surface={surface}
              plan={draft.plan}
              value={surfacePlan}
              onChange={changeSurface}
              selected={selectedElements}
              onSelect={setSelectedElements}
              onUndo={undoSurface}
              onRedo={redoSurface}
              canUndo={!!surfaceHistory[surface.id]?.past.length}
              canRedo={!!surfaceHistory[surface.id]?.future.length}
            />
          )}
        </section>
        <aside className="inspector">
          {latestTask && view !== "surface" && (
            <DesignOutcome
              task={latestTask}
              onInspect={() => setInspectedTask(latestTask)}
              onView={() => {
                selectSurface(latestTask.surfaceId);
                setView("3d");
                setShowDesigns(true);
                setFocusObject(null);
              }}
              onRetry={() => queueDesign(latestTask.surfaceId)}
            />
          )}
          {view === "floor" ? (
            <>
              <p className="eyebrow mb-3">01 / Define your space</p>
              <h2 className="inspector-heading">Floor plan</h2>
              <p className="text-xs leading-5 subtle">
                Start with the footprint. Every corner becomes part of your 3D
                space.
              </p>
              <div className="field">
                <Label htmlFor="room-title">Interior name</Label>
                <Input
                  id="room-title"
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Width"
                  value={box.width}
                  min={0.5}
                  max={50}
                  onChange={(width) =>
                    changePlan({
                      ...draft.plan,
                      points: draft.plan.points.map((p) => ({
                        ...p,
                        x:
                          Math.round(
                            (((p.x - box.minX) * width) / box.width) * 1000,
                          ) / 1000,
                      })),
                    })
                  }
                />
                <NumberField
                  label="Depth"
                  value={box.height}
                  min={0.5}
                  max={50}
                  onChange={(height) =>
                    changePlan({
                      ...draft.plan,
                      points: draft.plan.points.map((p) => ({
                        ...p,
                        y:
                          Math.round(
                            (((p.y - box.minY) * height) / box.height) * 1000,
                          ) / 1000,
                      })),
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Ceiling height"
                  min={1.8}
                  max={8}
                  value={draft.plan.height}
                  onChange={(height) => changePlan({ ...draft.plan, height })}
                />
                <NumberField
                  label="Wall thickness"
                  value={draft.plan.wallThickness}
                  min={0.05}
                  max={0.6}
                  step={0.01}
                  onChange={(wallThickness) =>
                    changePlan({ ...draft.plan, wallThickness })
                  }
                />
              </div>
              <div className="mt-5 rounded-md bg-muted p-3 flex items-center justify-between">
                <span className="text-[11px] subtle">Total floor area</span>
                <span className="text-sm font-medium tabular-nums">
                  {area(draft.plan.points).toFixed(2)}{" "}
                  <span className="text-[10px] subtle">m²</span>
                </span>
              </div>
              <label className="flex items-center justify-between mt-5 text-xs">
                <span>Snap to 25 cm grid</span>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => setSnap(e.target.checked)}
                  className="accent-current"
                />
              </label>
              <div className="inspector-divider" />
              {point ? (
                <>
                  <div className="flex justify-between items-center">
                    <h3 className="inspector-heading mb-0">
                      Corner{" "}
                      {draft.plan.points.findIndex((p) => p.id === point.id) +
                        1}
                    </h3>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Deselect corner"
                      onClick={() => setSelectedPoint(null)}
                    >
                      <X />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="Corner X"
                      value={point.x}
                      onChange={(x) =>
                        changePlan({
                          ...draft.plan,
                          points: draft.plan.points.map((p) =>
                            p.id === point.id ? { ...p, x } : p,
                          ),
                        })
                      }
                    />
                    <NumberField
                      label="Corner Y"
                      value={point.y}
                      onChange={(y) =>
                        changePlan({
                          ...draft.plan,
                          points: draft.plan.points.map((p) =>
                            p.id === point.id ? { ...p, y } : p,
                          ),
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-4 text-xs"
                    disabled={draft.plan.points.length <= 3}
                    onClick={() => {
                      changePlan({
                        ...draft.plan,
                        points: draft.plan.points.filter(
                          (p) => p.id !== point.id,
                        ),
                      });
                      setSelectedPoint(null);
                    }}
                  >
                    <Trash2 />
                    Remove corner
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="inspector-heading">Shape it your way</h3>
                  <p className="text-[11px] leading-5 subtle">
                    Drag a corner to move it. Use the + on an edge to add a
                    corner, or draw a new outline with the pencil tool.
                  </p>
                </>
              )}
              <div className="inspector-divider" />
              <Button className="w-full text-xs" onClick={() => setView("3d")}>
                <Box />
                Explore in 3D
                <ChevronRight className="ml-auto" />
              </Button>
              <p className="text-[10px] text-center leading-5 mt-3 subtle">
                Floors, walls, and ceiling follow your plan.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow mb-3">
                {view === "3d"
                  ? "02 / Explore the structure"
                  : "03 / Design the details"}
              </p>
              <h2 className="inspector-heading">
                {view === "3d" ? "Your space in 3D" : "Surface plans"}
              </h2>
              <p className="text-xs leading-5 subtle">
                {view === "3d"
                  ? "Select a surface to give it its own design."
                  : "Each surface is a canvas. Sketch an idea and let your agent shape it."}
              </p>
              <div className="mt-5">
                {view === "surface" ? (
                  <div className="field mt-0">
                    <Label htmlFor="active-surface">Editing surface</Label>
                    <select
                      id="active-surface"
                      value={surface.id}
                      onChange={(event) => selectSurface(event.target.value)}
                    >
                      {allSurfaces.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.width.toFixed(2)} ×{" "}
                          {item.height.toFixed(2)} m
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  allSurfaces.map((item) => {
                    const task = jobs.find(
                      (j) =>
                        j.surfaceId === item.id &&
                        (j.status === "queued" || j.status === "running"),
                    );
                    return (
                      <button
                        key={item.id}
                        className={`surface-item ${surface.id === item.id ? "selected" : ""}`}
                        onClick={() => selectSurface(item.id)}
                      >
                        {item.kind === "wall" ? <Square /> : <Layers />}
                        <span className="flex-1 text-xs">
                          {item.name}
                          <span className="block text-[9px] subtle mt-1">
                            {item.width.toFixed(2)} × {item.height.toFixed(2)} m
                          </span>
                        </span>
                        {task ? (
                          <Loader2
                            className={
                              task.status === "running" ? "animate-spin" : ""
                            }
                          />
                        ) : done.some((j) => j.surfaceId === item.id) ? (
                          <Check />
                        ) : (
                          <ChevronRight />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              {view === "3d" ? (
                <>
                  <div className="inspector-divider" />
                  <Button
                    className="w-full text-xs"
                    onClick={() => setView("surface")}
                  >
                    <PencilRuler />
                    Edit {surface.name.toLowerCase()} plan
                  </Button>
                  <div className="mt-5 flex justify-between text-[11px] subtle">
                    <span>Agent-designed surfaces</span>
                    <span>
                      {done.length} / {allSurfaces.length}
                    </span>
                  </div>
                  <p className="mt-4 text-[11px] leading-5 subtle">
                    Your room shell is built from the floor plan. Surface
                    designs appear here when an agent finishes a task.
                  </p>
                  {appliedDesign?.result && (
                    <div className="job-card">
                      <p className="text-[11px] font-medium">
                        What the agent added
                      </p>
                      <p className="text-[11px] leading-5 subtle mt-2">
                        {appliedDesign.result.summary}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-7"
                          onClick={() => setShowDesigns(!showDesigns)}
                        >
                          {showDesigns ? "Show before" : "Show after"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[10px] h-7"
                          onClick={() => setInspectedTask(appliedDesign)}
                        >
                          Full report
                        </Button>
                      </div>
                      <div className="object-list mt-3">
                        {appliedDesign.result.objects.map((object) => (
                          <button
                            key={object.id}
                            className={`object-row ${focusObject?.surfaceId === surface.id && focusObject.objectId === object.id ? "bg-muted" : ""}`}
                            onClick={() => showObject(surface.id, object.id)}
                          >
                            <span
                              className="size-3.5 rounded-sm border shrink-0"
                              style={{ background: object.color }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10px]">
                                {object.label}
                              </span>
                              <span className="block text-[9px] subtle">
                                {object.size
                                  .map((n) => Number(n.toFixed(3)))
                                  .join(" × ")}{" "}
                                m
                                <span className="block">
                                  At{" "}
                                  {object.position
                                    .map((n) => Number(n.toFixed(2)))
                                    .join(", ")}{" "}
                                  m
                                </span>
                              </span>
                            </span>
                            <ChevronRight className="size-3" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="inspector-divider" />
                  <div className="flex justify-between items-center">
                    <h3 className="inspector-heading mb-0">
                      {surface.name} design
                    </h3>
                    <Badge variant="outline" className="font-normal text-[9px]">
                      {surfacePlan.elements.length} features
                    </Badge>
                  </div>
                  <div className="surface-items-list">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-medium">
                        Items on this surface
                      </h3>
                      <span className="text-[10px] subtle">
                        {surfacePlan.elements.length}
                      </span>
                    </div>
                    {surfacePlan.elements.length === 0 ? (
                      <p className="text-[11px] subtle leading-5">
                        Choose Draw to sketch freely, or drag a rectangle, line,
                        ellipse, or opening. Text adds a note.
                      </p>
                    ) : (
                      <ol className="surface-layers">
                        {[...surfacePlan.elements].reverse().map((item) => (
                          <li
                            key={item.id}
                            className={
                              selectedElements.includes(item.id)
                                ? "selected"
                                : ""
                            }
                          >
                            <button
                              className="surface-layer-name"
                              onClick={(event) => {
                                setSelectionToolRequest((value) => value + 1);
                                if (event.shiftKey)
                                  setSelectedElements((previous) =>
                                    previous.includes(item.id)
                                      ? previous.filter((id) => id !== item.id)
                                      : [...previous, item.id],
                                  );
                                else setSelectedElements([item.id]);
                              }}
                            >
                              <span className="surface-layer-icon">
                                {item.kind === "opening" ? (
                                  <DoorOpen />
                                ) : item.kind === "stroke" ? (
                                  <PencilRuler />
                                ) : item.kind === "text" ? (
                                  <span className="font-serif font-bold">
                                    T
                                  </span>
                                ) : (
                                  <Square />
                                )}
                              </span>
                              <span className="truncate">
                                {item.label || item.kind}
                              </span>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Delete ${item.label || item.kind}`}
                              onClick={() => {
                                changeSurface({
                                  ...surfacePlan,
                                  elements: surfacePlan.elements.filter(
                                    (element) => element.id !== item.id,
                                  ),
                                });
                                setSelectedElements((previous) =>
                                  previous.filter((id) => id !== item.id),
                                );
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  {selectedElements.length > 1 ? (
                    <div className="rounded-md border p-3 mt-4">
                      <p className="text-xs font-medium">
                        {selectedElements.length} items selected
                      </p>
                      <p className="text-[11px] subtle mt-2">
                        Drag to move them together. Shift-click changes the
                        selection.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full text-xs"
                        onClick={() => {
                          changeSurface({
                            ...surfacePlan,
                            elements: surfacePlan.elements.filter(
                              (item) => !selectedElements.includes(item.id),
                            ),
                          });
                          setSelectedElements([]);
                        }}
                      >
                        <Trash2 />
                        Delete selected items
                      </Button>
                    </div>
                  ) : element ? (
                    <>
                      <div className="mt-5 flex justify-between items-center">
                        <span className="text-xs font-medium">
                          Selected{" "}
                          {element.kind === "feature"
                            ? "rectangle"
                            : element.kind === "stroke"
                              ? "sketch"
                              : element.kind}
                        </span>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete selected feature"
                          onClick={() => {
                            changeSurface({
                              ...surfacePlan,
                              elements: surfacePlan.elements.filter(
                                (e) => e.id !== element.id,
                              ),
                            });
                            setSelectedElement(null);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="field">
                        <Label htmlFor="feature-label">Item description</Label>
                        <Input
                          id="feature-label"
                          className="text-xs"
                          placeholder="Describe this item"
                          value={element.label}
                          maxLength={200}
                          onChange={(e) =>
                            changeElement({ label: e.target.value })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField
                          label="Item width"
                          value={element.width}
                          min={0.05}
                          max={Math.max(0.05, surface.width - element.x)}
                          onChange={(width) => changeElement({ width })}
                        />
                        <NumberField
                          label="Item height"
                          value={element.height}
                          min={0.05}
                          max={Math.max(0.05, surface.height - element.y)}
                          onChange={(height) => changeElement({ height })}
                        />
                        <NumberField
                          label="Position X"
                          value={element.x}
                          max={Math.max(0, surface.width - element.width)}
                          onChange={(x) => changeElement({ x })}
                        />
                        <NumberField
                          label="Position Y"
                          value={element.y}
                          max={Math.max(0, surface.height - element.height)}
                          onChange={(y) => changeElement({ y })}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="mt-4 text-[10px] leading-5 subtle">
                      Select an item on the canvas or in the list. Drag its
                      handles to resize it. Delete removes it; Ctrl/⌘ Z brings
                      it back.
                    </p>
                  )}
                  <div className="inspector-divider" />
                  <div className="field">
                    <Label htmlFor="design-notes">Design instructions</Label>
                    <Textarea
                      id="design-notes"
                      placeholder={
                        surface.kind === "wall"
                          ? "e.g. Full-height oak shelving, a low cabinet, and warm recessed lighting…"
                          : surface.kind === "floor"
                            ? "e.g. Light oak herringbone flooring, a wool rug and a low sculptural table…"
                            : "e.g. A recessed perimeter with indirect light and a simple central pendant…"
                      }
                      value={surfacePlan.notes}
                      onChange={(e) =>
                        changeSurface({ ...surfacePlan, notes: e.target.value })
                      }
                      maxLength={8000}
                      className="min-h-[120px] text-xs leading-5 resize-y"
                    />
                  </div>
                  {surface.kind === "wall" &&
                    surfacePlan.elements.some((e) => e.kind === "opening") && (
                      <p className="mt-3 text-[10px] subtle leading-5">
                        Wall openings cut through the 3D shell. Your agent can
                        design their frames and surrounding details.
                      </p>
                    )}
                  <div className="inspector-divider" />
                  <Button
                    className="w-full text-xs"
                    disabled={queuing || saving || !!active}
                    onClick={generate}
                  >
                    {queuing ? (
                      <Loader2 className="animate-spin" />
                    ) : active ? (
                      <Clock3 />
                    ) : (
                      <Sparkles />
                    )}
                    {queuing
                      ? "Queuing design…"
                      : active
                        ? active.status === "running"
                          ? "Agent is designing…"
                          : "Design queued"
                        : "Generate surface design"}
                  </Button>
                  <p className="mt-3 text-[10px] leading-5 subtle">
                    {dirty
                      ? "Your changes will be saved before queuing."
                      : "The agent interprets your plan and chooses the form, depth, and materials."}
                  </p>
                  {!agentConfigured && (
                    <div className="mt-4 rounded-md border border-dashed p-3">
                      <div className="flex gap-2 items-center text-[11px] font-medium">
                        <Workflow className="size-3.5" />
                        External worker
                      </div>
                      <p className="mt-1.5 text-[10px] leading-5 subtle">
                        Tasks stay queued until a Codex worker connects.
                        Progress and results appear below.
                      </p>
                    </div>
                  )}
                  {jobsError && (
                    <p className="text-xs mt-4 text-destructive">
                      Queue updates unavailable: {jobsError}
                    </p>
                  )}
                  {surfaceJobs.length > 0 && (
                    <div className="mt-5">
                      <h3 className="text-[10px] font-medium subtle uppercase tracking-wider">
                        Task activity
                      </h3>
                      {surfaceJobs.slice(0, 4).map((task) => (
                        <div key={task.id} className="job-card">
                          <div className="flex justify-between items-center">
                            <JobBadge status={task.status} />
                            {(task.status === "queued" ||
                              task.status === "running") && (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Cancel task"
                                onClick={async () => {
                                  try {
                                    await api(`/jobs/${task.id}/cancel`, {
                                      method: "POST",
                                    });
                                    await loadJobs();
                                    void onJobsChanged();
                                  } catch (e: any) {
                                    notify(e.message);
                                  }
                                }}
                              >
                                <X />
                              </Button>
                            )}
                          </div>
                          <p className="text-[10px] leading-5 subtle mt-2">
                            {taskMessage(task.message)}
                          </p>
                          {task.status === "running" && (
                            <>
                              <div className="progress-track">
                                <div
                                  className="progress-fill"
                                  style={{ width: `${task.progress}%` }}
                                />
                              </div>
                              <p className="text-[9px] subtle mt-2">
                                {task.progress}% · {task.workerId}
                              </p>
                            </>
                          )}
                          {task.status === "completed" && (
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 h-auto mt-3 text-[10px]"
                              onClick={() => setView("3d")}
                            >
                              View in 3D
                              <ChevronRight />
                            </Button>
                          )}
                          {task.status === "failed" && (
                            <Button
                              variant="link"
                              size="sm"
                              className="p-0 h-auto mt-3 text-[10px]"
                              disabled={!!active}
                              onClick={generate}
                            >
                              Try again
                            </Button>
                          )}
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto mt-3 ml-3 text-[10px]"
                            onClick={() => setInspectedTask(task)}
                          >
                            Inspect run
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </aside>
      </div>
      <TaskDetails
        task={inspectedTask}
        onClose={() => setInspectedTask(null)}
        onShowObject={showObject}
      />
    </>
  );
}
