import { useEffect, useRef, useState } from "react";
import {
  Check,
  Minus,
  MousePointer2,
  PencilRuler,
  Plus,
  Scan,
  Undo2,
  X,
} from "lucide-react";
import {
  area,
  bounds,
  signedArea,
  validPolygon,
  type FloorPlan,
  type Point,
} from "@interior-planner/shared";
import { Button } from "./ui/button";
import type { Notify } from "./app";

export function FloorCanvas({
  plan,
  onChange,
  selected,
  onSelect,
  snap,
  notify,
  onUndo,
  canUndo,
}: {
  plan: FloorPlan;
  onChange: (plan: FloorPlan) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  snap: boolean;
  notify: Notify;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [pixels, setPixels] = useState(650);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (svg.current)
        setPixels(
          Math.max(
            200,
            Math.min(svg.current.clientWidth, svg.current.clientHeight),
          ),
        );
    });
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const [zoom, setZoom] = useState(1),
    [drawing, setDrawing] = useState(false),
    [outline, setOutline] = useState<Point[]>([]);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const dragging = useRef<string | null>(null);
  const points = draft ?? plan.points,
    box = bounds(plan.points);
  const size = (Math.max(box.width, box.height, 3) * 1.8) / zoom;
  const view = {
    x: (box.minX + box.maxX) / 2 - size / 2,
    y: (box.minY + box.maxY) / 2 - size / 2,
    size,
  };
  const scale = size / pixels;
  function coords(e: React.PointerEvent) {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const local = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    const step = snap ? 0.25 : 0.01;
    return {
      x: Math.max(0, Math.min(50, Math.round(local.x / step) * step)),
      y: Math.max(0, Math.min(50, Math.round(local.y / step) * step)),
    };
  }
  function finish() {
    const next = signedArea(outline) < 0 ? [...outline].reverse() : outline;
    if (!validPolygon(next))
      return notify("Draw a closed, non-intersecting plan of at least 0.5 m².");
    onChange({ ...plan, points: next });
    setDrawing(false);
    setOutline([]);
    onSelect(null);
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawing(false);
        setOutline([]);
        dragging.current = null;
        setDraft(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <>
      <div className="canvas-tools">
        <Button
          variant={!drawing ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Select corners"
          onClick={() => {
            setDrawing(false);
            setOutline([]);
          }}
        >
          <MousePointer2 />
        </Button>
        <Button
          variant={drawing ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Draw a new boundary"
          onClick={() => {
            setDrawing(true);
            setOutline([]);
          }}
        >
          <PencilRuler />
        </Button>
        <span className="mx-1 border-l" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Undo floor plan change"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </Button>
        {drawing && (
          <>
            <span className="mx-1 border-l" />
            <Button size="sm" disabled={outline.length < 3} onClick={finish}>
              <Check />
              Finish
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel drawing"
              onClick={() => {
                setDrawing(false);
                setOutline([]);
              }}
            >
              <X />
            </Button>
          </>
        )}
      </div>
      <svg
        ref={svg}
        className="plan-svg"
        viewBox={`${view.x} ${view.y} ${size} ${size}`}
        role="group"
        aria-label="Editable floor plan. Drag corner points to change the room shape."
        style={{ cursor: drawing ? "crosshair" : undefined }}
        onPointerDown={(e) => {
          if (!drawing) return;
          const p = coords(e);
          if (
            outline.length > 2 &&
            Math.hypot(p.x - outline[0]!.x, p.y - outline[0]!.y) < 0.3
          )
            finish();
          else if (outline.length < 40)
            setOutline([...outline, { ...p, id: crypto.randomUUID() }]);
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            const p = coords(e);
            setDraft(
              plan.points.map((point) =>
                point.id === dragging.current ? { ...point, ...p } : point,
              ),
            );
          }
        }}
        onPointerUp={() => {
          if (dragging.current && draft) {
            if (validPolygon(draft)) onChange({ ...plan, points: draft });
            else notify("That corner would create an invalid floor plan.");
          }
          dragging.current = null;
          setDraft(null);
        }}
        onPointerCancel={() => {
          dragging.current = null;
          setDraft(null);
        }}
      >
        <defs>
          <pattern
            id="floor-grid"
            width=".25"
            height=".25"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r={scale * 0.65} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect
          x={view.x}
          y={view.y}
          width={size}
          height={size}
          fill="url(#floor-grid)"
        />
        {!drawing && (
          <>
            <polygon
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="var(--background)"
              stroke="var(--foreground)"
              strokeWidth={plan.wallThickness}
              strokeLinejoin="miter"
            />
            <text
              x={(box.minX + box.maxX) / 2}
              y={(box.minY + box.maxY) / 2 - scale * 2}
              textAnchor="middle"
              fill="var(--foreground)"
              fontSize={scale * 22}
              fontWeight="500"
            >
              {area(points).toFixed(1)}
              <tspan fontSize={scale * 12}> m²</tspan>
            </text>
            <text
              x={(box.minX + box.maxX) / 2}
              y={(box.minY + box.maxY) / 2 + scale * 21}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={scale * 10}
              letterSpacing={scale * 1.6}
            >
              FLOOR PLAN
            </text>
            {points.map((p, i) => {
              const next = points[(i + 1) % points.length]!,
                length = Math.hypot(next.x - p.x, next.y - p.y);
              const mx = (p.x + next.x) / 2,
                my = (p.y + next.y) / 2,
                nx = (next.y - p.y) / length,
                ny = -(next.x - p.x) / length;
              return (
                <g key={p.id}>
                  <line
                    x1={p.x + nx * 0.3}
                    y1={p.y + ny * 0.3}
                    x2={next.x + nx * 0.3}
                    y2={next.y + ny * 0.3}
                    stroke="var(--border)"
                    strokeWidth={scale}
                  />
                  <text
                    x={mx + nx * 0.49}
                    y={my + ny * 0.49}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--muted-foreground)"
                    fontSize={scale * 11}
                  >
                    {length.toFixed(2)} m
                  </text>
                  {points.length < 40 && (
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`Add corner to wall ${i + 1}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const point = { id: crypto.randomUUID(), x: mx, y: my };
                        const updated = [...plan.points];
                        updated.splice(i + 1, 0, point);
                        onChange({ ...plan, points: updated });
                        onSelect(point.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const point = {
                            id: crypto.randomUUID(),
                            x: mx,
                            y: my,
                          };
                          const updated = [...plan.points];
                          updated.splice(i + 1, 0, point);
                          onChange({ ...plan, points: updated });
                          onSelect(point.id);
                        }
                      }}
                      style={{ cursor: "copy" }}
                    >
                      <circle
                        cx={mx}
                        cy={my}
                        r={scale * 8}
                        fill="var(--background)"
                        stroke="var(--border)"
                        strokeWidth={scale}
                      />
                      <path
                        d={`M ${mx - scale * 3} ${my} h ${scale * 6} M ${mx} ${my - scale * 3} v ${scale * 6}`}
                        stroke="var(--muted-foreground)"
                        strokeWidth={scale}
                      />
                    </g>
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={scale * (selected === p.id ? 6.5 : 5)}
                    fill={
                      selected === p.id
                        ? "var(--foreground)"
                        : "var(--background)"
                    }
                    stroke="var(--foreground)"
                    strokeWidth={scale * 1.5}
                    style={{ cursor: "grab" }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Corner ${i + 1}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(p.id);
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect(p.id);
                      dragging.current = p.id;
                      svg.current!.setPointerCapture(e.pointerId);
                    }}
                  />
                </g>
              );
            })}
          </>
        )}
        {drawing && (
          <>
            <polygon
              points={outline.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="var(--background)"
              fillOpacity=".75"
              stroke="var(--foreground)"
              strokeWidth={scale * 2}
              strokeDasharray={`${scale * 6} ${scale * 4}`}
            />
            {outline.map((p, i) => (
              <g key={p.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={scale * 5}
                  fill="var(--foreground)"
                />
                <text
                  x={p.x + scale * 11}
                  y={p.y - scale * 10}
                  fill="var(--foreground)"
                  fontSize={scale * 10}
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </>
        )}
      </svg>
      <p className="canvas-caption">
        {drawing
          ? "Click to place corners. Finish to close the outline. Esc to cancel."
          : `Drag corners to reshape · Click + to add a corner · ${snap ? "25 cm grid" : "Free positioning"}`}
      </p>
      <div className="canvas-zoom">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom out"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.2))}
        >
          <Minus />
        </Button>
        <span className="text-[10px] w-10 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom in"
          onClick={() => setZoom(Math.min(3, zoom + 0.2))}
        >
          <Plus />
        </Button>
        <span className="border-l h-4 mx-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Fit plan to canvas"
          onClick={() => setZoom(1)}
        >
          <Scan />
        </Button>
      </div>
    </>
  );
}
