import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  FlaskConical,
  Loader2,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { area, type Interior } from "@interior-planner/shared";
import {
  metricScores,
  type Designs,
  type Evaluation,
  type Experiment,
  type Metric,
} from "@interior-planner/shared/experiments";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { JobBadge, ThemeMenu, type Notify } from "./app";
const RoomScene = lazy(() =>
  import("./room-scene").then((m) => ({ default: m.RoomScene })),
);
type Props = {
  go: (path: string) => unknown;
  notify: Notify;
  onDirtyChange: (dirty: boolean) => void;
};
function useUnsavedChanges(dirty: boolean, report: (dirty: boolean) => void) {
  useEffect(() => report(dirty), [dirty, report]);
  useEffect(() => () => report(false), [report]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
const selectClass = "h-9 rounded-md border bg-background px-3 text-xs min-w-0";
const presets = {
  Storage: {
    name: "Storage capacity",
    unit: "m³",
    definition:
      "Estimate usable interior storage volume in cabinets and shelving; explain the usable-space assumptions.",
  },
  Seating: {
    name: "Seating capacity",
    unit: "seats",
    definition:
      "Count usable seats with enough access and circulation around them.",
  },
  "Work surface": {
    name: "Work surface area",
    unit: "m²",
    definition:
      "Estimate clear usable horizontal work surface area, excluding occupied or inaccessible surfaces.",
  },
};
function newMetric(preset?: keyof typeof presets): Metric {
  return {
    id: crypto.randomUUID(),
    name: "",
    unit: "",
    definition: "",
    direction: "maximize",
    target: null,
    weight: 3,
    ...(preset ? presets[preset] : {}),
  };
}
function MetricFields({
  metric: m,
  index,
  onChange,
  onRemove,
}: {
  metric: Metric;
  index: number;
  onChange: (m: Metric) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="rounded-lg border p-4 space-y-3">
      <legend className="px-2 text-xs subtle">Metric {index + 1}</legend>
      <div className="flex gap-2">
        <Input
          aria-label={`Metric ${index + 1} name`}
          placeholder="What do you want to measure?"
          value={m.name}
          required
          maxLength={100}
          onChange={(e) => onChange({ ...m, name: e.target.value })}
        />
        <Input
          className="max-w-24"
          aria-label={`Metric ${index + 1} unit`}
          placeholder="Unit"
          value={m.unit}
          required
          maxLength={30}
          onChange={(e) => onChange({ ...m, unit: e.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove metric ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Textarea
        aria-label={`Metric ${index + 1} definition`}
        placeholder="Define exactly what should count and how it should be estimated. You can also define a rating scale."
        value={m.definition}
        required
        maxLength={1000}
        className="min-h-16 text-xs"
        onChange={(e) => onChange({ ...m, definition: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs flex items-center gap-2">
          Goal
          <select
            className={selectClass}
            value={m.direction}
            onChange={(e) =>
              onChange({
                ...m,
                direction: e.target.value as Metric["direction"],
              })
            }
          >
            <option value="maximize">More is better</option>
            <option value="minimize">Less is better</option>
            <option value="target">Aim for a target</option>
          </select>
        </label>
        {m.direction === "target" && (
          <Input
            className="max-w-28"
            type="number"
            step="any"
            aria-label={`Metric ${index + 1} target`}
            placeholder="Target"
            required
            value={m.target ?? ""}
            onChange={(e) =>
              onChange({
                ...m,
                target: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        )}
        <label className="text-xs flex items-center gap-2">
          Priority
          <Input
            type="number"
            className="w-16"
            min={1}
            max={10}
            step={1}
            required
            value={m.weight}
            aria-label={`Metric ${index + 1} priority`}
            onChange={(e) => onChange({ ...m, weight: Number(e.target.value) })}
          />
          <span className="subtle">/ 10</span>
        </label>
      </div>
    </fieldset>
  );
}
export function ExperimentHub({
  interiorId,
  go,
  notify,
  onDirtyChange,
}: Props & { interiorId: string }) {
  const [room, setRoom] = useState<Interior | null>(null),
    [items, setItems] = useState<
      {
        id: string;
        name: string;
        goals: string;
        variantCount: number;
        active: boolean;
        updatedAt: string;
      }[]
    >([]),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [goals, setGoals] = useState(""),
    [constraints, setConstraints] = useState(""),
    [metrics, setMetrics] = useState<Metric[]>(() => [newMetric("Storage")]),
    [count, setCount] = useState(3);
  const initialMetrics = useRef(JSON.stringify(metrics));
  const load = useCallback(async () => {
    try {
      const [r, list] = await Promise.all([
        api<Interior>(`/interiors/${interiorId}`),
        api<typeof items>(`/interiors/${interiorId}/experiments`),
      ]);
      setRoom(r);
      setItems(list);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [interiorId]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);
  useUnsavedChanges(
    creating &&
      (!!name.trim() ||
        !!goals.trim() ||
        !!constraints.trim() ||
        JSON.stringify(metrics) !== initialMetrics.current),
    onDirtyChange,
  );
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!room) return;
    setBusy(true);
    try {
      const result = await api<{ id: string }>(
        `/interiors/${interiorId}/experiments`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            goals,
            constraints,
            metrics,
            revision: room.revision,
          }),
        },
      );
      setCreating(false);
      setName("");
      setGoals("");
      setConstraints("");
      onDirtyChange(false);
      try {
        await api(`/experiments/${result.id}/generate`, {
          method: "POST",
          body: JSON.stringify({ count, brief: "" }),
        });
      } catch (e: any) {
        notify(`Experiment saved. ${e.message}`);
      }
      go(`/experiments/${result.id}`);
    } catch (e: any) {
      notify(e.message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to interior"
            onClick={() => go(`/interiors/${interiorId}`)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-xs truncate">
            {room?.name ?? "Interior"} / Experiments
          </span>
        </div>
        <ThemeMenu />
      </header>
      <div className="page-body">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">Same space. More possibilities.</p>
            <h1 className="page-heading">Design experiments</h1>
            <p className="text-[13px] subtle mt-3 max-w-xl leading-6">
              Explore layouts around your priorities. Compare the results, rank
              your favorites, and keep the original interior as your reference.
            </p>
          </div>
          <Button
            disabled={!room || busy}
            onClick={() => setCreating(!creating)}
          >
            <Plus />
            New experiment
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-5 text-sm text-destructive">
            {error}
          </p>
        )}
        {creating && (
          <form
            className="mt-8 rounded-xl border p-5 space-y-5"
            onSubmit={create}
          >
            <div>
              <h2 className="text-base font-medium">
                What would make this space better?
              </h2>
              <p className="text-xs subtle mt-2 leading-5">
                We’ll snapshot the saved interior, including its current
                generated designs. The footprint, ceiling and openings stay
                fixed.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="experiment-name">Experiment name</Label>
                <Input
                  id="experiment-name"
                  placeholder="e.g. More storage, room to gather"
                  value={name}
                  required
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="experiment-count">
                  Alternatives to generate
                </Label>
                <select
                  id="experiment-count"
                  className={`${selectClass} w-full`}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "alternative" : "alternatives"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="experiment-goals">Goals</Label>
              <Textarea
                id="experiment-goals"
                placeholder="What should improve? Describe how you want to use this space."
                value={goals}
                required
                maxLength={6000}
                onChange={(e) => setGoals(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="experiment-constraints">
                Things to keep or respect
              </Label>
              <Textarea
                id="experiment-constraints"
                placeholder="e.g. Keep plumbing in place, retain the table, minimum aisle width, budget or accessibility needs…"
                value={constraints}
                maxLength={6000}
                onChange={(e) => setConstraints(e.target.value)}
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Your metrics</h3>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(presets) as (keyof typeof presets)[]).map(
                    (key) => (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={metrics.length >= 12}
                        onClick={() => setMetrics([...metrics, newMetric(key)])}
                      >
                        + {key}
                      </Button>
                    ),
                  )}
                </div>
              </div>
              <p className="text-xs subtle mt-2 leading-5">
                Use any numeric measure or a clearly defined rating scale. Units
                and definitions keep alternatives comparable. Higher priorities
                count more in the relative metric score.
              </p>
              <div className="mt-4 space-y-3">
                {metrics.map((m, i) => (
                  <MetricFields
                    key={m.id}
                    metric={m}
                    index={i}
                    onChange={(next) =>
                      setMetrics(metrics.map((v) => (v.id === m.id ? next : v)))
                    }
                    onRemove={() =>
                      setMetrics(metrics.filter((v) => v.id !== m.id))
                    }
                  />
                ))}
              </div>
              <Button
                className="mt-3"
                type="button"
                size="sm"
                variant="outline"
                disabled={metrics.length >= 12}
                onClick={() => setMetrics([...metrics, newMetric()])}
              >
                <Plus />
                Custom metric
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button disabled={busy || !metrics.length}>
                {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Create and generate
              </Button>
            </div>
          </form>
        )}
        <div className="mt-8 space-y-3">
          {!items.length && !creating ? (
            <div className="empty-room">
              <FlaskConical className="size-8 subtle mb-4" />
              <p>No experiments yet</p>
              <p className="text-xs subtle mt-2 max-w-sm text-center leading-6">
                Choose what matters, then let Codex explore different ways to
                use this same space.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className="rounded-lg border p-5 flex items-center gap-3"
              >
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => go(`/experiments/${item.id}`)}
                >
                  <h2 className="text-sm font-medium">{item.name}</h2>
                  <p className="mt-2 text-xs subtle truncate">{item.goals}</p>
                  <p className="mt-2 text-[10px] subtle">
                    {item.variantCount} alternatives ·{" "}
                    {item.active ? "Codex is generating" : "Saved experiment"} ·{" "}
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete experiment ${item.name}`}
                  onClick={async () => {
                    if (
                      !confirm(
                        "Delete this experiment, its alternatives and reviews? Interiors saved from it will be kept.",
                      )
                    )
                      return;
                    try {
                      await api(`/experiments/${item.id}`, {
                        method: "DELETE",
                      });
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
                  aria-label={`Open experiment ${item.name}`}
                  onClick={() => go(`/experiments/${item.id}`)}
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
function EvaluationCell({
  evaluation,
  unit,
  baseline,
}: {
  evaluation: Evaluation | undefined;
  unit: string;
  baseline: number | null | undefined;
}) {
  const value = evaluation?.value,
    delta =
      value !== null &&
      value !== undefined &&
      baseline !== null &&
      baseline !== undefined
        ? value - baseline
        : null;
  return (
    <div>
      <span className="font-medium tabular-nums">
        {value === null || value === undefined
          ? "Unknown"
          : `${Number(value.toFixed(3))} ${unit}`}
      </span>
      {delta !== null && (
        <span className="block text-[10px] subtle mt-1">
          {delta > 0 ? "+" : ""}
          {Number(delta.toFixed(3))} {unit} vs baseline
        </span>
      )}
      {evaluation && (
        <details className="mt-2 text-[10px] subtle">
          <summary className="cursor-pointer">
            {evaluation.confidence} confidence · estimate
          </summary>
          <p className="mt-2 leading-5 whitespace-pre-wrap">
            {evaluation.explanation}
          </p>
        </details>
      )}
    </div>
  );
}
function Preview({
  experiment,
  designs,
  title,
}: {
  experiment: Experiment;
  designs: Designs;
  title: string;
}) {
  const [show, setShow] = useState(true);
  return (
    <div className="rounded-lg border overflow-hidden min-w-0">
      <p className="border-b p-3 text-xs font-medium">{title}</p>
      <div className="relative h-[330px]">
        <Suspense
          fallback={<p className="p-5 text-xs subtle">Loading 3D preview…</p>}
        >
          <RoomScene
            plan={experiment.baseline.interior.plan}
            surfacePlans={experiment.baseline.interior.surfaces}
            jobs={[]}
            previewDesigns={designs}
            selected=""
            onSelect={() => {}}
            focusObject={null}
            showDesigns={show}
            onToggleDesigns={() => setShow(!show)}
          />
        </Suspense>
      </div>
    </div>
  );
}
export function ExperimentPage({
  id,
  go,
  notify,
  onDirtyChange,
  onCopied,
}: Props & { id: string; onCopied: () => unknown }) {
  const [experiment, setExperiment] = useState<Experiment | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(3),
    [brief, setBrief] = useState(""),
    [left, setLeft] = useState("baseline"),
    [right, setRight] = useState(""),
    [sort, setSort] = useState("rank"),
    [notes, setNotes] = useState<Record<string, string>>({});
  const etag = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/experiments/${id}`, {
        headers: etag.current ? { "If-None-Match": etag.current } : {},
      });
      if (response.status === 304) {
        setError("");
        return;
      }
      const e = await response.json();
      if (!response.ok) throw new Error(e.error ?? "Could not load experiment");
      etag.current = response.headers.get("ETag");
      setExperiment(e);
      setRight((v) => v || e.variants[0]?.id || "");
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
  useUnsavedChanges(
    !!brief.trim() || Object.keys(notes).length > 0,
    onDirtyChange,
  );
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      await load();
    } catch (e: any) {
      notify(e.message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!experiment)
    return (
      <div className="page-body">
        <p className="text-sm" role={error ? "alert" : undefined}>
          {error || "Loading experiment…"}
        </p>
        <Button className="mt-4" variant="ghost" onClick={() => go("/")}>
          <ArrowLeft />
          Interiors
        </Button>
      </div>
    );
  const e = experiment,
    active = e.jobs.find(
      (j) => j.status === "queued" || j.status === "running",
    ),
    last = e.jobs[0],
    baseline = e.baseline.interior;
  const candidates = [
      {
        id: "baseline",
        name: "Baseline",
        evaluations: e.baselineEvaluations,
        designs: e.baseline.designs,
      },
      ...e.variants,
    ],
    scores = metricScores(e.metrics, candidates);
  const shown = [...e.variants].sort((a, b) =>
    sort === "score"
      ? (scores[b.id] ?? -1) - (scores[a.id] ?? -1)
      : sort === "shortlist"
        ? Number(b.shortlisted) - Number(a.shortlisted) || a.rank - b.rank
        : a.rank - b.rank,
  );
  const l = candidates.find((c) => c.id === left) ?? candidates[0]!,
    r = candidates.find((c) => c.id === right);
  const options = candidates.map((c) => (
    <option key={c.id} value={c.id}>
      {c.name}
    </option>
  ));
  async function move(variantId: string, offset: number) {
    const ids = e.variants.map((v) => v.id),
      index = ids.indexOf(variantId),
      target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await action(() =>
      api(`/experiments/${id}/ranking`, {
        method: "PUT",
        body: JSON.stringify({ ids, revision: e.revision }),
      }),
    );
  }
  return (
    <>
      <header className="topbar">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to experiments"
            onClick={() => go(`/interiors/${e.interiorId}/experiments`)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-xs truncate">
            {baseline.name} / {e.name}
          </span>
        </div>
        <ThemeMenu />
      </header>
      <div className="page-body experiment-page">
        <div className="flex flex-wrap justify-between gap-5">
          <div>
            <p className="eyebrow mb-3">Explore, compare, decide</p>
            <h1 className="page-heading">{e.name}</h1>
            <p className="text-[13px] subtle leading-6 mt-3 max-w-2xl whitespace-pre-wrap">
              {e.goals}
            </p>
          </div>
          <div className="text-xs subtle leading-6">
            Fixed space · {area(baseline.plan.points).toFixed(1)} m²
            <br />
            Snapshot from {new Date(e.createdAt).toLocaleString()}
            <br />
            {e.variants.length} alternatives
          </div>
        </div>
        {e.sourceRevision !== baseline.revision && (
          <p className="text-xs mt-4 rounded-lg border p-3">
            The source interior has changed. This experiment still uses its
            saved snapshot so comparisons stay consistent.
          </p>
        )}
        <details className="mt-5 border rounded-lg p-4">
          <summary className="cursor-pointer text-xs font-medium">
            Goals, constraints and metric definitions
          </summary>
          <p className="text-xs mt-3 leading-6 whitespace-pre-wrap">
            {e.constraints ||
              "No extra constraints. Footprint, ceiling and existing openings remain fixed."}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {e.metrics.map((m) => (
              <div key={m.id} className="text-xs border-t pt-3">
                <p className="font-medium">
                  {m.name} · {m.unit} · priority {m.weight}/10
                </p>
                <p className="mt-1 subtle">
                  {m.direction === "target"
                    ? `Target ${m.target} ${m.unit}`
                    : m.direction === "maximize"
                      ? "More is better"
                      : "Less is better"}
                </p>
                <p className="mt-2 subtle leading-5">{m.definition}</p>
              </div>
            ))}
          </div>
        </details>
        <section className="mt-6 rounded-lg border p-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h2 className="text-sm font-medium">
                Explore more possibilities
              </h2>
              <p className="text-xs subtle mt-1">
                Each batch uses the same baseline and metric definitions.
              </p>
            </div>
            <div className="flex gap-2">
              <select
                aria-label="Number of alternatives"
                className={selectClass}
                disabled={busy || !!active}
                value={count}
                onChange={(ev) => setCount(Number(ev.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "alternative" : "alternatives"}
                  </option>
                ))}
              </select>
              <Button
                disabled={busy || !!active || e.variants.length + count > 24}
                onClick={() =>
                  void action(async () => {
                    await api(`/experiments/${id}/generate`, {
                      method: "POST",
                      body: JSON.stringify({ count, brief }),
                    });
                    setBrief("");
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Generate
              </Button>
            </div>
          </div>
          <Textarea
            className="mt-4 min-h-16"
            aria-label="Direction for next alternatives"
            placeholder="Optional direction for this batch: try an island, explore a smaller table, prioritize easier circulation…"
            value={brief}
            maxLength={4000}
            disabled={busy || !!active}
            onChange={(ev) => setBrief(ev.target.value)}
          />
          {active && (
            <div className="mt-4 border-t pt-3">
              <div className="flex items-center justify-between">
                <JobBadge status={active.status} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void action(() =>
                      api(`/jobs/${active.id}/cancel`, { method: "POST" }),
                    )
                  }
                >
                  Cancel generation
                </Button>
              </div>
              <p className="text-xs subtle mt-2">{active.message}</p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.max(3, active.progress)}%` }}
                />
              </div>
            </div>
          )}
          {!active && last && (
            <p
              className={`text-xs mt-3 ${last.status === "failed" ? "text-destructive" : "subtle"}`}
              role={last.status === "failed" ? "alert" : undefined}
            >
              {last.message}
            </p>
          )}
        </section>
        {e.variants.length > 0 ? (
          <>
            <section id="experiment-compare-anchor" className="mt-9">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium">Compare the designs</h2>
                  <p className="text-xs subtle mt-2 leading-5">
                    Agent estimates, with evidence and confidence. Deltas
                    compare against the saved baseline.
                  </p>
                </div>
              </div>
              <div className="mt-5 overflow-x-auto rounded-lg border">
                <table className="experiment-table">
                  <caption className="sr-only">
                    Metrics for baseline and design alternatives
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      {candidates.map((c) => (
                        <th key={c.id} scope="col">
                          <button
                            className="text-left hover:underline"
                            onClick={() => setRight(c.id)}
                          >
                            {c.name}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {e.metrics.map((m) => (
                      <tr key={m.id}>
                        <th scope="row">
                          <span>{m.name}</span>
                          <span className="block font-normal text-[10px] subtle mt-1">
                            {m.direction === "target"
                              ? `Target ${m.target}`
                              : m.direction === "maximize"
                                ? "More is better"
                                : "Less is better"}{" "}
                            · priority {m.weight}
                          </span>
                        </th>
                        {candidates.map((c) => (
                          <td key={c.id}>
                            <EvaluationCell
                              evaluation={c.evaluations.find(
                                (v) => v.metricId === m.id,
                              )}
                              unit={m.unit}
                              baseline={
                                c.id === "baseline"
                                  ? undefined
                                  : e.baselineEvaluations.find(
                                      (v) => v.metricId === m.id,
                                    )?.value
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Relative metric score</th>
                      {candidates.map((c) => (
                        <td key={c.id} className="tabular-nums font-medium">
                          {scores[c.id] === null
                            ? "Incomplete"
                            : `${scores[c.id]} / 100`}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] subtle leading-5 mt-3">
                Scores normalize each metric across this baseline and all
                alternatives, then apply your priorities. Target metrics use
                distance from the target. Scores change as alternatives are
                added. Missing estimates leave a design unscored. Your ranking
                below is independent.
              </p>
              <div className="grid md:grid-cols-2 gap-4 mt-6">
                <label className="text-xs space-y-2">
                  Compare left
                  <select
                    className={`${selectClass} block w-full`}
                    aria-label="Left design"
                    value={l.id}
                    onChange={(ev) => setLeft(ev.target.value)}
                  >
                    {options}
                  </select>
                </label>
                <label className="text-xs space-y-2">
                  Compare right
                  <select
                    className={`${selectClass} block w-full`}
                    aria-label="Right design"
                    value={r?.id ?? ""}
                    onChange={(ev) => setRight(ev.target.value)}
                  >
                    <option value="" disabled>
                      Choose an alternative
                    </option>
                    {options}
                  </select>
                </label>
                <Preview
                  key={`left:${l.id}`}
                  experiment={e}
                  designs={l.designs}
                  title={l.name}
                />
                {r && (
                  <Preview
                    key={`right:${r.id}`}
                    experiment={e}
                    designs={r.designs}
                    title={r.name}
                  />
                )}
              </div>
            </section>
            <section className="mt-10">
              <div className="flex justify-between items-center gap-3">
                <h2 className="text-lg font-medium">Your alternatives</h2>
                <select
                  aria-label="Sort alternatives"
                  className={selectClass}
                  value={sort}
                  onChange={(ev) => setSort(ev.target.value)}
                >
                  <option value="rank">Your ranking</option>
                  <option value="score">Metric score</option>
                  <option value="shortlist">Shortlisted first</option>
                </select>
              </div>
              <p className="text-xs subtle mt-2">
                Use the arrows to rank, star a shortlist, and save your review
                notes.
              </p>
              <div className="space-y-4 mt-5">
                {shown.map((v) => (
                  <article key={v.id} className="rounded-lg border p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="size-9 flex items-center justify-center border rounded-lg text-sm font-medium">
                          #{v.rank}
                        </span>
                        <div>
                          <h3 className="text-sm font-medium">{v.name}</h3>
                          <p className="text-[10px] subtle mt-1">
                            {scores[v.id] === null
                              ? "Metrics incomplete"
                              : `${scores[v.id]} / 100 relative metric score`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || v.rank === 1}
                          aria-label={`Rank ${v.name} higher`}
                          onClick={() => void move(v.id, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || v.rank === e.variants.length}
                          aria-label={`Rank ${v.name} lower`}
                          onClick={() => void move(v.id, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          variant={v.shortlisted ? "secondary" : "ghost"}
                          size="icon-sm"
                          disabled={busy}
                          aria-label={`Shortlist ${v.name}`}
                          aria-pressed={v.shortlisted}
                          onClick={() =>
                            void action(() =>
                              api(`/experiments/${id}/variants/${v.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  revision: e.revision,
                                  notes: v.notes,
                                  shortlisted: !v.shortlisted,
                                }),
                              }),
                            )
                          }
                        >
                          <Star
                            className={`size-4 ${v.shortlisted ? "fill-current" : ""}`}
                          />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRight(v.id);
                            document
                              .querySelector("#experiment-compare-anchor")
                              ?.scrollIntoView({ behavior: "smooth" });
                          }}
                        >
                          View in comparison
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs leading-6 mt-4 whitespace-pre-wrap">
                      {v.summary}
                    </p>
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer font-medium">
                        Approach, assumptions and tradeoffs
                      </summary>
                      <p className="mt-3 leading-6 whitespace-pre-wrap">
                        {v.approach}
                      </p>
                      {v.assumptions.length > 0 && (
                        <>
                          <p className="font-medium mt-3">Assumptions</p>
                          <ul className="list-disc pl-4 mt-1 subtle leading-6">
                            {v.assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {v.tradeoffs.length > 0 && (
                        <>
                          <p className="font-medium mt-3">Tradeoffs</p>
                          <ul className="list-disc pl-4 mt-1 subtle leading-6">
                            {v.tradeoffs.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </details>
                    <label className="block text-xs mt-4">
                      Your review
                      <Textarea
                        className="mt-2 min-h-16"
                        aria-label={`Review ${v.name}`}
                        disabled={busy}
                        value={notes[v.id] ?? v.notes}
                        maxLength={4000}
                        placeholder="What works, what doesn’t, and why you prefer this option…"
                        onChange={(ev) =>
                          setNotes((current) => {
                            const next = { ...current };
                            if (ev.target.value === v.notes) delete next[v.id];
                            else next[v.id] = ev.target.value;
                            return next;
                          })
                        }
                      />
                    </label>
                    <div className="flex flex-wrap justify-between gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || notes[v.id] === undefined}
                        onClick={() =>
                          void action(async () => {
                            await api(`/experiments/${id}/variants/${v.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                revision: e.revision,
                                notes: notes[v.id],
                                shortlisted: v.shortlisted,
                              }),
                            });
                            setNotes((current) => {
                              const next = { ...current };
                              delete next[v.id];
                              return next;
                            });
                          })
                        }
                      >
                        <Check />
                        Save review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const result = await api<{ interior: Interior }>(
                              `/experiments/${id}/variants/${v.id}/copy`,
                              { method: "POST" },
                            );
                            await onCopied();
                            notify(
                              `Saved “${result.interior.name}” as a new interior`,
                            );
                          })
                        }
                      >
                        Save as new interior
                        <ArrowUpRight />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-room min-h-[280px] mt-6">
            <FlaskConical className="size-7 subtle mb-4" />
            <h2 className="text-sm font-medium">
              Alternatives will appear here
            </h2>
            <p className="text-xs subtle leading-6 mt-2 max-w-sm text-center">
              Generate a batch to compare metrics and 3D layouts. Your baseline
              is saved and the original interior stays as it is.
            </p>
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive mt-4" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
