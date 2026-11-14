import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Copy,
  DoorOpen,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Scan,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import {
  bounds,
  clamp,
  drawnElement,
  duplicateSelection,
  moveSelection,
  resizeElement,
  selectionBounds,
  snapTo,
  type FloorPlan,
  type PlanElement,
  type ResizeHandle,
  type Surface,
  type SurfacePlan,
  type XY,
} from "@interior-planner/shared";
import { Button } from "./ui/button";

type Tool =
  | "select"
  | "stroke"
  | "feature"
  | "ellipse"
  | "line"
  | "opening"
  | "text"
  | "erase"
  | "pan";
type Gesture = {
  kind: "draw" | "move" | "resize" | "marquee" | "erase" | "pan";
  start: XY;
  client: XY;
  before: PlanElement[];
  ids: string[];
  points: XY[];
  handle?: ResizeHandle;
  original?: PlanElement;
  pan: XY;
  pointerId: number;
};
const tools = [
  ["select", MousePointer2, "Select", "V"],
  ["stroke", Pencil, "Draw", "B"],
  ["feature", Square, "Rectangle", "R"],
  ["ellipse", Circle, "Ellipse", "E"],
  ["line", Slash, "Line", "L"],
  ["opening", DoorOpen, "Opening", "O"],
  ["text", Type, "Text", "T"],
  ["erase", Eraser, "Eraser", "X"],
  ["pan", Hand, "Pan", "H"],
] as const;
const names: Record<string, string> = {
  feature: "Rectangle",
  stroke: "Sketch",
  ellipse: "Ellipse",
  line: "Line",
  opening: "Opening",
  text: "Note",
};
const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
function inputTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable="true"],[role="dialog"]',
    )
  );
}

export function SurfaceCanvas({
  surface,
  plan,
  value,
  onChange,
  selected,
  onSelect,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectionToolRequest,
}: {
  surface: Surface;
  plan: FloorPlan;
  value: SurfacePlan;
  onChange: (value: SurfacePlan) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectionToolRequest: number;
}) {
  const svg = useRef<SVGSVGElement>(null),
    stage = useRef<HTMLDivElement>(null),
    toolbar = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    draftRef = useRef<PlanElement[] | null>(null),
    clipboard = useRef<PlanElement[]>([]);
  const [tool, setTool] = useState<Tool>("select"),
    [draft, setDraft] = useState<PlanElement[] | null>(null),
    [viewport, setViewport] = useState({ width: 900, height: 650 });
  const [toolbarHeight, setToolbarHeight] = useState(90);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState<XY>({ x: 0, y: 0 }),
    [snap, setSnap] = useState(true),
    [grid, setGrid] = useState(true),
    [space, setSpace] = useState(false);
  const [color, setColor] = useState("#171717"),
    [weight, setWeight] = useState(0.02),
    [marquee, setMarquee] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null),
    [hint, setHint] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const editingId = useRef<string | null>(null);
  useEffect(() => {
    editingId.current = editing?.id ?? null;
  }, [editing?.id]);
  const state = useRef({
    value,
    selected,
    onChange,
    onSelect,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    tool,
    snap,
    surface,
  });
  state.current = {
    value,
    selected,
    onChange,
    onSelect,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    tool,
    snap,
    surface,
  };
  const unit =
    Math.max(
      (surface.width + 1.2) / Math.max(250, viewport.width - 64),
      (surface.height + 1.2) /
        Math.max(140, viewport.height - toolbarHeight - 110),
    ) / zoom;
  const view = {
    x: surface.width / 2 + pan.x - (viewport.width * unit) / 2,
    y:
      surface.height / 2 +
      pan.y -
      (viewport.height * unit) / 2 -
      ((toolbarHeight - 40) * unit) / 2,
    width: viewport.width * unit,
    height: viewport.height * unit,
  };
  const elements = draft ?? value.elements,
    selection = elements.filter((e) => selected.includes(e.id)),
    selectionBox = selection.length ? selectionBounds(selection) : null;
  const floor = bounds(plan.points),
    footprint = plan.points
      .map(
        (p) =>
          `${p.x - floor.minX},${surface.kind === "ceiling" ? floor.maxY - p.y : p.y - floor.minY}`,
      )
      .join(" ");
  const drawing = !["select", "erase", "pan"].includes(tool);
  function updateDraft(items: PlanElement[] | null) {
    draftRef.current = items;
    setDraft(items);
  }
  function coords(clientX: number, clientY: number): XY {
    const p = svg.current!.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const local = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: local.x, y: surface.height - local.y };
  }
  function point(event: React.PointerEvent, free = false): XY {
    const p = coords(event.clientX, event.clientY),
      step = snap && !event.altKey && !free ? 0.05 : 0;
    return {
      x: clamp(snapTo(p.x, step), 0, surface.width),
      y: clamp(snapTo(p.y, step), 0, surface.height),
    };
  }
  function capture(event: React.PointerEvent) {
    try {
      svg.current?.setPointerCapture(event.pointerId);
    } catch {}
  }
  function commit(items: PlanElement[]) {
    onChange({ ...value, elements: items });
  }
  function remove() {
    if (!selected.length) return;
    commit(value.elements.filter((e) => !selected.includes(e.id)));
    onSelect([]);
    setHint("Deleted. Undo restores your items.");
  }
  function duplicate() {
    const current = state.current;
    if (
      !current.selected.length ||
      current.value.elements.length + current.selected.length > 100
    )
      return;
    const result = duplicateSelection(
      current.value.elements,
      current.selected,
      current.surface,
      () => crypto.randomUUID(),
    );
    current.onChange({ ...current.value, elements: result.elements });
    current.onSelect(result.ids);
    setTool("select");
  }
  function cancel() {
    gesture.current = null;
    updateDraft(null);
    setMarquee(null);
  }
  useEffect(() => {
    cancel();
    setTool("select");
    setHint("");
  }, [selectionToolRequest]);
  function eraseAt(clientX: number, clientY: number) {
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-element-id]");
    const id = target?.getAttribute("data-element-id");
    if (id) {
      const items = (draftRef.current ?? value.elements).filter(
        (e) => e.id !== id,
      );
      updateDraft(items);
    }
  }
  function start(
    event: React.PointerEvent,
    id?: string,
    handle?: ResizeHandle,
  ) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    svg.current?.focus({ preventScroll: true });
    setHint("");
    const at = point(event, tool === "stroke"),
      before = value.elements;
    if (space || tool === "pan" || event.button === 1) {
      gesture.current = {
        kind: "pan",
        start: at,
        client: { x: event.clientX, y: event.clientY },
        before,
        ids: [],
        points: [],
        pan,
        pointerId: event.pointerId,
      };
      capture(event);
      return;
    }
    if (handle && id) {
      const original = before.find((e) => e.id === id);
      if (!original) return;
      gesture.current = {
        kind: "resize",
        start: at,
        client: { x: event.clientX, y: event.clientY },
        before,
        ids: [id],
        points: [],
        original,
        handle,
        pan,
        pointerId: event.pointerId,
      };
      capture(event);
      return;
    }
    if (tool === "erase") {
      gesture.current = {
        kind: "erase",
        start: at,
        client: { x: event.clientX, y: event.clientY },
        before,
        ids: [],
        points: [],
        pan,
        pointerId: event.pointerId,
      };
      updateDraft(before);
      if (id) updateDraft(before.filter((e) => e.id !== id));
      else eraseAt(event.clientX, event.clientY);
      capture(event);
      return;
    }
    if (tool === "select") {
      if (id) {
        const ids = event.shiftKey
          ? selected.includes(id)
            ? selected.filter((i) => i !== id)
            : [...selected, id]
          : selected.includes(id)
            ? selected
            : [id];
        onSelect(ids);
        if (!ids.includes(id)) return;
        gesture.current = {
          kind: "move",
          start: at,
          client: { x: event.clientX, y: event.clientY },
          before,
          ids,
          points: [],
          pan,
          pointerId: event.pointerId,
        };
      } else {
        if (!event.shiftKey) onSelect([]);
        gesture.current = {
          kind: "marquee",
          start: at,
          client: { x: event.clientX, y: event.clientY },
          before,
          ids: event.shiftKey ? selected : [],
          points: [],
          pan,
          pointerId: event.pointerId,
        };
      }
      capture(event);
      return;
    }
    if (before.length >= 100) {
      setHint("This surface has 100 items. Delete an item before adding more.");
      return;
    }
    if (tool === "text") {
      const item: PlanElement = {
        id: crypto.randomUUID(),
        kind: "text",
        x: Math.min(at.x, surface.width - 0.5),
        y: Math.min(at.y, surface.height - 0.3),
        width: Math.min(1.7, surface.width),
        height: Math.min(0.4, surface.height),
        label: "Note",
        color,
      };
      item.x = clamp(item.x, 0, surface.width - item.width);
      item.y = clamp(item.y, 0, surface.height - item.height);
      commit([...before, item]);
      onSelect([item.id]);
      setEditing({ id: item.id, text: "Note" });
      setTool("select");
      return;
    }
    gesture.current = {
      kind: "draw",
      start: at,
      client: { x: event.clientX, y: event.clientY },
      before,
      ids: [crypto.randomUUID()],
      points: [at],
      pan,
      pointerId: event.pointerId,
    };
    capture(event);
  }
  function move(event: React.PointerEvent) {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.kind === "pan") {
      setPan({
        x: drag.pan.x - (event.clientX - drag.client.x) * unit,
        y: drag.pan.y - (event.clientY - drag.client.y) * unit,
      });
      return;
    }
    if (drag.kind === "erase") {
      eraseAt(event.clientX, event.clientY);
      return;
    }
    const p = point(event, tool === "stroke");
    if (drag.kind === "move") {
      updateDraft(
        moveSelection(
          drag.before,
          drag.ids,
          { x: p.x - drag.start.x, y: p.y - drag.start.y },
          surface,
          snap && !event.altKey ? 0.05 : 0,
        ),
      );
      return;
    }
    if (drag.kind === "resize" && drag.original && drag.handle) {
      const updated = resizeElement(
        drag.original,
        drag.handle,
        p,
        surface,
        snap && !event.altKey ? 0.05 : 0,
      );
      updateDraft(drag.before.map((e) => (e.id === updated.id ? updated : e)));
      return;
    }
    if (drag.kind === "marquee") {
      const box = {
        x: Math.min(drag.start.x, p.x),
        y: Math.min(drag.start.y, p.y),
        width: Math.abs(p.x - drag.start.x),
        height: Math.abs(p.y - drag.start.y),
      };
      setMarquee(box);
      const ids = drag.before
        .filter(
          (e) =>
            e.x <= box.x + box.width &&
            e.x + e.width >= box.x &&
            e.y <= box.y + box.height &&
            e.y + e.height >= box.y,
        )
        .map((e) => e.id);
      onSelect([...new Set([...drag.ids, ...ids])]);
      return;
    }
    if (drag.kind === "draw") {
      if (tool === "stroke") {
        const last = drag.points.at(-1)!;
        if (Math.hypot(last.x - p.x, last.y - p.y) < unit * 1.5) return;
        drag.points.push(p);
        if (drag.points.length > 590)
          drag.points = drag.points.filter((_, i) => i % 2 === 0);
      } else {
        let next = p;
        if (
          event.shiftKey &&
          ["feature", "ellipse", "opening"].includes(tool)
        ) {
          const side = Math.min(
            Math.abs(p.x - drag.start.x),
            Math.abs(p.y - drag.start.y),
          );
          next = {
            x: clamp(
              drag.start.x + Math.sign(p.x - drag.start.x) * side,
              0,
              surface.width,
            ),
            y: clamp(
              drag.start.y + Math.sign(p.y - drag.start.y) * side,
              0,
              surface.height,
            ),
          };
        }
        if (event.shiftKey && tool === "line") {
          if (Math.abs(p.x - drag.start.x) > Math.abs(p.y - drag.start.y))
            next = { x: p.x, y: drag.start.y };
          else next = { x: drag.start.x, y: p.y };
        }
        drag.points = [drag.start, next];
      }
      const count = drag.before.filter((e) => e.kind === tool).length + 1,
        item = drawnElement(
          tool as PlanElement["kind"],
          drag.points,
          surface,
          drag.ids[0]!,
          `${names[tool]} ${count}`,
          color,
          weight,
        );
      updateDraft([...drag.before, item]);
    }
  }
  function finish(event: React.PointerEvent) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
        event.clientX - drag.client.x,
        event.clientY - drag.client.y,
      ),
      items = draftRef.current;
    if (items && (drag.kind !== "draw" || distance > 3)) {
      commit(items);
      if (drag.kind === "draw") {
        onSelect(drag.ids);
        if (tool !== "stroke") setTool("select");
      }
      if (drag.kind === "erase")
        onSelect(selected.filter((id) => items.some((e) => e.id === id)));
    } else if (drag.kind === "draw")
      setHint(
        "Click and drag to draw. Press V when you want to select or move items.",
      );
    gesture.current = null;
    updateDraft(null);
    setMarquee(null);
  }
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (toolbar.current)
        setToolbarHeight(toolbar.current.getBoundingClientRect().height);
      if (svg.current)
        setViewport({
          width: svg.current.clientWidth,
          height: svg.current.clientHeight,
        });
    });
    if (svg.current) observer.observe(svg.current);
    if (toolbar.current) observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((previous) =>
        clamp(previous * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.25, 6),
      );
    };
    const el = svg.current;
    el?.addEventListener("wheel", wheel, { passive: false });
    return () => el?.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (inputTarget(event.target)) return;
      const current = state.current,
        key = event.key.toLowerCase(),
        mod = event.ctrlKey || event.metaKey;
      if (event.code === "Space") {
        event.preventDefault();
        setSpace(true);
        return;
      }
      if (key === "escape") {
        cancel();
        current.onSelect([]);
        setTool("select");
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        setHint(
          event.shiftKey ? "Redid the last edit." : "Undid the last edit.",
        );
        if (event.shiftKey) current.onRedo();
        else current.onUndo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        setHint("Redid the last edit.");
        current.onRedo();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setTool("select");
        current.onSelect(current.value.elements.map((e) => e.id));
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        duplicate();
        return;
      }
      if (mod && key === "c") {
        if (current.selected.length) {
          event.preventDefault();
          clipboard.current = current.value.elements.filter((e) =>
            current.selected.includes(e.id),
          );
        }
        return;
      }
      if (mod && key === "v") {
        if (
          clipboard.current.length &&
          current.value.elements.length + clipboard.current.length <= 100
        ) {
          event.preventDefault();
          const copies = duplicateSelection(
            clipboard.current,
            clipboard.current.map((e) => e.id),
            current.surface,
            () => crypto.randomUUID(),
          );
          current.onChange({
            ...current.value,
            elements: [
              ...current.value.elements,
              ...copies.elements.slice(clipboard.current.length),
            ],
          });
          current.onSelect(copies.ids);
          setTool("select");
        }
        return;
      }
      if (key === "delete" || key === "backspace") {
        if (current.selected.length) {
          event.preventDefault();
          current.onChange({
            ...current.value,
            elements: current.value.elements.filter(
              (e) => !current.selected.includes(e.id),
            ),
          });
          current.onSelect([]);
        }
        return;
      }
      if (key.startsWith("arrow") && current.selected.length) {
        event.preventDefault();
        const amount = (current.snap ? 0.05 : 0.01) * (event.shiftKey ? 10 : 1),
          delta = {
            x:
              key === "arrowleft" ? -amount : key === "arrowright" ? amount : 0,
            y: key === "arrowdown" ? -amount : key === "arrowup" ? amount : 0,
          };
        current.onChange({
          ...current.value,
          elements: moveSelection(
            current.value.elements,
            current.selected,
            delta,
            current.surface,
          ),
        });
        return;
      }
      if (key === "enter" && current.selected.length === 1) {
        const item = current.value.elements.find(
          (e) => e.id === current.selected[0],
        );
        if (item) {
          event.preventDefault();
          setEditing({ id: item.id, text: item.label });
        }
        return;
      }
      if (!mod) {
        const found = tools.find((t) => t[3].toLowerCase() === key);
        if (found) {
          event.preventDefault();
          cancel();
          setTool(found[0]);
        }
        if (key === "+" || key === "=") setZoom((z) => Math.min(6, z * 1.25));
        if (key === "-") setZoom((z) => Math.max(0.25, z / 1.25));
        if (key === "0") {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      cancel();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const editingItem = editing
    ? elements.find((e) => e.id === editing.id)
    : undefined;
  function saveText(text: string) {
    if (!editing || editingId.current !== editing.id) return;
    editingId.current = null;
    const current = state.current;
    current.onChange({
      ...current.value,
      elements: current.value.elements.map((e) =>
        e.id === editing.id ? { ...e, label: text.trim() || "Note" } : e,
      ),
    });
    setEditing(null);
  }
  function renderItem(item: PlanElement) {
    const ink =
        item.color && item.color !== "#171717"
          ? item.color
          : "var(--foreground)",
      line = Math.max(item.strokeWidth ?? 0.02, unit * 1.5),
      y = surface.height - item.y - item.height,
      path = item.points
        ?.map(
          (p, i) =>
            `${i ? "L" : "M"} ${item.x + p.x * item.width} ${surface.height - item.y - p.y * item.height}`,
        )
        .join(" ");
    return (
      <g
        key={item.id}
        data-element-id={item.id}
        role="button"
        tabIndex={0}
        aria-label={`Select ${item.label || names[item.kind]}`}
        aria-pressed={selected.includes(item.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !selected.includes(item.id)) {
            e.preventDefault();
            e.stopPropagation();
            onSelect([item.id]);
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          start(e, item.id);
        }}
        onDoubleClick={() => {
          if (tool === "select") {
            onSelect([item.id]);
            setEditing({ id: item.id, text: item.label });
          }
        }}
        style={{
          cursor:
            tool === "erase"
              ? "crosshair"
              : tool === "select"
                ? "move"
                : undefined,
        }}
      >
        {(item.kind === "stroke" || item.kind === "line") && path ? (
          <>
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(line, unit * 16)}
              strokeLinecap="round"
            />
            <path
              d={path}
              fill="none"
              stroke={ink}
              strokeWidth={line}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          </>
        ) : item.kind === "ellipse" ? (
          <ellipse
            cx={item.x + item.width / 2}
            cy={surface.height - item.y - item.height / 2}
            rx={item.width / 2}
            ry={item.height / 2}
            fill={ink}
            fillOpacity=".06"
            stroke={ink}
            strokeWidth={line}
          />
        ) : item.kind === "text" ? (
          <>
            <rect
              x={item.x}
              y={y}
              width={item.width}
              height={item.height}
              fill="transparent"
            />
            <text
              x={item.x + unit * 4}
              y={y + item.height * 0.7}
              fill={ink}
              fontSize={Math.min(item.height * 0.7, unit * 25)}
              pointerEvents="none"
            >
              {item.label}
            </text>
          </>
        ) : (
          <rect
            x={item.x}
            y={y}
            width={item.width}
            height={item.height}
            fill={item.kind === "opening" ? "var(--background)" : ink}
            fillOpacity={item.kind === "opening" ? 1 : 0.06}
            stroke={ink}
            strokeWidth={line}
            strokeDasharray={
              item.kind === "opening" ? `${unit * 7} ${unit * 4}` : undefined
            }
          />
        )}
        {!["stroke", "line", "text"].includes(item.kind) &&
          item.width / unit > 65 &&
          item.height / unit > 24 && (
            <text
              x={item.x + item.width / 2}
              y={surface.height - item.y - item.height / 2}
              fill={ink}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(
                unit * 11,
                (item.width / Math.max(item.label.length, 5)) * 1.5,
              )}
              pointerEvents="none"
            >
              {item.label}
            </text>
          )}
      </g>
    );
  }
  return (
    <div ref={stage} className="surface-workspace">
      <div
        className="surface-toolbar"
        ref={toolbar}
        role="toolbar"
        aria-label="Surface drawing tools"
      >
        <div className="surface-tool-group">
          {tools.map(([id, Icon, label, key]) => (
            <Button
              key={id}
              variant={tool === id ? "secondary" : "ghost"}
              size="sm"
              className="surface-tool"
              aria-label={`${label} (${key})`}
              aria-pressed={tool === id}
              title={`${label} · ${key}`}
              onClick={() => {
                cancel();
                setTool(id);
              }}
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </div>
        <div className="surface-tool-group">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Undo · Ctrl/⌘ Z"
            aria-label="Undo surface edit"
            disabled={!canUndo}
            onClick={() => {
              cancel();
              setHint("Undid the last edit.");
              onUndo();
            }}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Redo · Ctrl/⌘ Shift Z"
            aria-label="Redo surface edit"
            disabled={!canRedo}
            onClick={() => {
              cancel();
              setHint("Redid the last edit.");
              onRedo();
            }}
          >
            <Redo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Duplicate · Ctrl/⌘ D"
            aria-label="Duplicate selected items"
            disabled={
              !selected.length || value.elements.length + selected.length > 100
            }
            onClick={duplicate}
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            title="Delete · Delete / Backspace"
            disabled={!selected.length}
            onClick={remove}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
        <div className="surface-options">
          <label className="flex items-center gap-1.5" title="Drawing color">
            <input
              type="color"
              value={color}
              aria-label="Drawing color"
              onChange={(e) => setColor(e.target.value)}
            />
            Ink
          </label>
          <label className="flex items-center gap-1.5">
            Weight
            <select
              aria-label="Drawing line weight"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            >
              <option value="0.01">Fine</option>
              <option value="0.02">Medium</option>
              <option value="0.04">Bold</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            Snap 5 cm
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={grid}
              onChange={(e) => setGrid(e.target.checked)}
            />
            Grid
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-[11px] h-7"
            disabled={!elements.length}
            onClick={() => {
              commit([]);
              onSelect([]);
              setHint("Canvas cleared. Undo restores every item.");
            }}
          >
            Clear canvas
          </Button>
        </div>
      </div>
      <svg
        ref={svg}
        tabIndex={0}
        className="plan-svg surface-svg"
        role="group"
        aria-label={`${surface.name} drawing canvas`}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        style={{
          cursor:
            space || tool === "pan"
              ? "grab"
              : tool === "select"
                ? "default"
                : tool === "erase"
                  ? "crosshair"
                  : "crosshair",
        }}
        onPointerDown={(e) => start(e)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
      >
        <defs>
          <pattern
            id="surface-grid"
            width=".25"
            height=".25"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r={unit * 0.8} fill="var(--grid)" />
          </pattern>
          <clipPath id="surface-clip">
            {surface.kind === "wall" ? (
              <rect width={surface.width} height={surface.height} />
            ) : (
              <polygon points={footprint} />
            )}
          </clipPath>
        </defs>
        <rect
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          fill="var(--canvas)"
        />
        {grid && (
          <rect
            x={view.x}
            y={view.y}
            width={view.width}
            height={view.height}
            fill="url(#surface-grid)"
          />
        )}
        {surface.kind === "wall" ? (
          <rect
            x="0"
            y="0"
            width={surface.width}
            height={surface.height}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth={unit * 1.5}
          />
        ) : (
          <polygon
            points={footprint}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth={unit * 1.5}
          />
        )}
        {grid && (
          <g clipPath="url(#surface-clip)" pointerEvents="none">
            <rect
              x="0"
              y="0"
              width={surface.width}
              height={surface.height}
              fill="url(#surface-grid)"
              opacity=".6"
            />
          </g>
        )}
        <text
          x={surface.width / 2}
          y={-unit * 16}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize={unit * 11}
          pointerEvents="none"
        >
          {surface.width.toFixed(2)} m
        </text>
        <text
          x={surface.width + unit * 18}
          y={surface.height / 2}
          fill="var(--muted-foreground)"
          fontSize={unit * 11}
          transform={`rotate(90 ${surface.width + unit * 18} ${surface.height / 2})`}
          textAnchor="middle"
          pointerEvents="none"
        >
          {surface.height.toFixed(2)} m
        </text>
        {!elements.length && (
          <g pointerEvents="none">
            <text
              x={surface.width / 2}
              y={surface.height / 2 - unit * 8}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={unit * 14}
            >
              Sketch your idea here
            </text>
            <text
              x={surface.width / 2}
              y={surface.height / 2 + unit * 16}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={unit * 11}
            >
              {viewport.width < 600
                ? "Draw, add shapes, or type a note."
                : "Choose Draw for freehand, or drag a shape. Select an item to move or delete it."}
            </text>
          </g>
        )}
        <g clipPath="url(#surface-clip)">{elements.map(renderItem)}</g>
        {selectionBox && tool === "select" && (
          <g>
            <rect
              x={selectionBox.x - unit * 3}
              y={
                surface.height - selectionBox.y - selectionBox.height - unit * 3
              }
              width={selectionBox.width + unit * 6}
              height={selectionBox.height + unit * 6}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={unit}
              strokeDasharray={`${unit * 4} ${unit * 3}`}
              pointerEvents="none"
            />
            {selection.length === 1 &&
              handles.map((handle) => {
                const x = handle.includes("w")
                    ? selectionBox.x
                    : handle.includes("e")
                      ? selectionBox.x + selectionBox.width
                      : selectionBox.x + selectionBox.width / 2,
                  y = handle.includes("n")
                    ? selectionBox.y + selectionBox.height
                    : handle.includes("s")
                      ? selectionBox.y
                      : selectionBox.y + selectionBox.height / 2;
                return (
                  <g
                    key={handle}
                    role="button"
                    tabIndex={0}
                    aria-label={`Resize ${handle}`}
                    style={{ cursor: `${handle}-resize` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      start(e, selection[0]!.id, handle);
                    }}
                  >
                    <rect
                      x={x - unit * (viewport.width < 760 ? 20 : 10)}
                      y={
                        surface.height -
                        y -
                        unit * (viewport.width < 760 ? 20 : 10)
                      }
                      width={unit * (viewport.width < 760 ? 40 : 20)}
                      height={unit * (viewport.width < 760 ? 40 : 20)}
                      fill="transparent"
                    />
                    <rect
                      x={x - unit * 4}
                      y={surface.height - y - unit * 4}
                      width={unit * 8}
                      height={unit * 8}
                      fill="var(--background)"
                      stroke="var(--foreground)"
                      strokeWidth={unit * 1.3}
                    />
                  </g>
                );
              })}
            <text
              x={selectionBox.x + selectionBox.width / 2}
              y={
                surface.height -
                selectionBox.y -
                selectionBox.height -
                unit * 12
              }
              textAnchor="middle"
              fill="var(--foreground)"
              fontSize={unit * 10}
              pointerEvents="none"
            >
              {selectionBox.width.toFixed(2)} × {selectionBox.height.toFixed(2)}{" "}
              m
            </text>
          </g>
        )}
        {marquee && (
          <rect
            x={marquee.x}
            y={surface.height - marquee.y - marquee.height}
            width={marquee.width}
            height={marquee.height}
            fill="var(--foreground)"
            fillOpacity=".05"
            stroke="var(--foreground)"
            strokeWidth={unit}
            strokeDasharray={`${unit * 4} ${unit * 3}`}
            pointerEvents="none"
          />
        )}
        {editing && editingItem && (
          <foreignObject
            x={editingItem.x}
            y={surface.height - editingItem.y - editingItem.height}
            width={Math.max(editingItem.width, unit * 180)}
            height={Math.max(editingItem.height, unit * 40)}
          >
            <input
              className="surface-inline-text"
              key={editing.id}
              autoFocus
              aria-label="Edit item text"
              defaultValue={editing.text}
              maxLength={200}
              onFocus={(e) => e.target.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => saveText(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveText(e.currentTarget.value);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  editingId.current = null;
                  setEditing(null);
                }
              }}
              style={{ fontSize: unit * 14, padding: unit * 5 }}
            />
          </foreignObject>
        )}
      </svg>
      <div className="surface-context" role="status">
        <span>
          {hint ||
            (selected.length && tool === "select"
              ? `${selected.length} selected · Drag to move · Handles resize · Delete removes`
              : tool === "select"
                ? "Click to select · Drag empty space to select a group · Shift-click adds items"
                : tool === "stroke"
                  ? "Click and drag to draw freely · V to select"
                  : tool === "erase"
                    ? "Click or drag over items to erase · Undo restores them"
                    : tool === "pan"
                      ? "Drag to pan the canvas"
                      : tool === "text"
                        ? "Click anywhere on the surface, then type your note"
                        : `Drag to draw ${tool === "feature" ? "a rectangle" : tool === "ellipse" ? "an ellipse" : tool === "opening" ? "an opening" : "a line"} · Shift constrains · V to select`)}
        </span>
        <span>
          {surface.name} · {elements.length}/100 items
        </span>
      </div>
      <div className="canvas-zoom surface-zoom">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom surface out"
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        >
          <Minus />
        </Button>
        <span className="text-[10px] w-10 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom surface in"
          onClick={() => setZoom((z) => Math.min(6, z * 1.25))}
        >
          <Plus />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Fit surface to canvas"
          title="Fit to canvas · 0"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <Scan />
        </Button>
      </div>
    </div>
  );
}
