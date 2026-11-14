import { useEffect, useRef, useState } from "react";
import { DoorOpen, MousePointer2, Square } from "lucide-react";
import {
  bounds,
  type FloorPlan,
  type PlanElement,
  type Surface,
  type SurfacePlan,
} from "@interior-planner/shared";
import { Button } from "./ui/button";

export function SurfaceCanvas({
  surface,
  plan,
  value,
  onChange,
  selected,
  onSelect,
}: {
  surface: Surface;
  plan: FloorPlan;
  value: SurfacePlan;
  onChange: (value: SurfacePlan) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    [tool, setTool] = useState<"select" | "feature" | "opening">("select");
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
  const [draft, setDraft] = useState<PlanElement[] | null>(null);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    original?: PlanElement;
  } | null>(null);
  const size = Math.max(surface.width, surface.height, 3) * 1.6,
    scale = size / pixels;
  const viewX = (surface.width - size) / 2,
    viewY = (surface.height - size) / 2;
  const box = bounds(plan.points);
  const footprint = plan.points
    .map(
      (p) =>
        `${p.x - box.minX},${surface.kind === "ceiling" ? box.maxY - p.y : p.y - box.minY}`,
    )
    .join(" ");
  function coords(e: React.PointerEvent) {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const local = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return {
      x: Math.max(
        0,
        Math.min(surface.width, Math.round(local.x / 0.05) * 0.05),
      ),
      y: Math.max(
        0,
        Math.min(
          surface.height,
          Math.round((surface.height - local.y) / 0.05) * 0.05,
        ),
      ),
    };
  }
  const elements = draft ?? value.elements;
  return (
    <>
      <div className="canvas-tools">
        {(
          [
            ["select", MousePointer2, "Select features"],
            ["feature", Square, "Draw a feature"],
            ["opening", DoorOpen, "Draw an opening"],
          ] as const
        ).map(([kind, Icon, label]) => (
          <Button
            key={kind}
            size="icon-sm"
            variant={tool === kind ? "secondary" : "ghost"}
            aria-label={label}
            onClick={() => setTool(kind)}
          >
            <Icon />
          </Button>
        ))}
      </div>
      <svg
        ref={svg}
        className="plan-svg"
        role="group"
        aria-label={`${surface.name} design plan. Draw features and openings to guide the agent.`}
        viewBox={`${viewX} ${viewY} ${size} ${size}`}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
        onPointerDown={(e) => {
          if (tool === "select") {
            onSelect(null);
            return;
          }
          const p = coords(e),
            id = crypto.randomUUID();
          gesture.current = { id, ...p };
          const feature: PlanElement = {
            id,
            kind: tool,
            x: p.x,
            y: p.y,
            width: 0.1,
            height: 0.1,
            label: tool === "opening" ? "Opening" : "New feature",
          };
          setDraft([...value.elements, feature]);
          onSelect(id);
          svg.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = gesture.current;
          if (!drag) return;
          const p = coords(e);
          if (drag.original) {
            const element = {
              ...drag.original,
              x: Math.max(
                0,
                Math.min(
                  surface.width - drag.original.width,
                  drag.original.x + p.x - drag.x,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  surface.height - drag.original.height,
                  drag.original.y + p.y - drag.y,
                ),
              ),
            };
            setDraft(
              value.elements.map((f) => (f.id === drag.id ? element : f)),
            );
          } else {
            const element: PlanElement = {
              id: drag.id,
              kind: tool === "opening" ? "opening" : "feature",
              x: Math.min(p.x, drag.x),
              y: Math.min(p.y, drag.y),
              width: Math.max(0.05, Math.abs(p.x - drag.x)),
              height: Math.max(0.05, Math.abs(p.y - drag.y)),
              label: tool === "opening" ? "Opening" : "New feature",
            };
            setDraft([...value.elements, element]);
          }
        }}
        onPointerUp={() => {
          if (draft) {
            const clipped = draft.map((f) => ({
              ...f,
              width: Math.max(0.05, Math.min(f.width, surface.width - f.x)),
              height: Math.max(0.05, Math.min(f.height, surface.height - f.y)),
              x: Math.min(f.x, surface.width - 0.05),
              y: Math.min(f.y, surface.height - 0.05),
            }));
            onChange({ ...value, elements: clipped });
          }
          gesture.current = null;
          setDraft(null);
          setTool("select");
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
        }}
      >
        <defs>
          <pattern
            id="surface-grid"
            width=".25"
            height=".25"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r={scale * 0.7} fill="var(--grid)" />
          </pattern>
          <clipPath id="surface-clip">
            {surface.kind === "wall" ? (
              <rect x="0" y="0" width={surface.width} height={surface.height} />
            ) : (
              <polygon points={footprint} />
            )}
          </clipPath>
        </defs>
        <rect
          x={viewX}
          y={viewY}
          width={size}
          height={size}
          fill="url(#surface-grid)"
        />
        {surface.kind === "wall" ? (
          <rect
            x="0"
            y="0"
            width={surface.width}
            height={surface.height}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth={scale * 2}
          />
        ) : (
          <polygon
            points={footprint}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth={scale * 2}
          />
        )}
        <text
          x={surface.width / 2}
          y={-0.3}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize={scale * 11}
        >
          {surface.width.toFixed(2)} m
        </text>
        <text
          x={surface.width + 0.3}
          y={surface.height / 2}
          textAnchor="middle"
          transform={`rotate(90 ${surface.width + 0.3} ${surface.height / 2})`}
          fill="var(--muted-foreground)"
          fontSize={scale * 11}
        >
          {surface.height.toFixed(2)} m
        </text>
        <g clipPath="url(#surface-clip)">
          {elements.map((element) => (
            <g
              key={element.id}
              role="button"
              tabIndex={0}
              aria-label={element.label || element.kind}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(element.id);
                }
              }}
              onPointerDown={(e) => {
                if (tool !== "select") return;
                e.stopPropagation();
                const p = coords(e);
                onSelect(element.id);
                gesture.current = { id: element.id, ...p, original: element };
                svg.current!.setPointerCapture(e.pointerId);
              }}
              style={{ cursor: tool === "select" ? "move" : undefined }}
            >
              <rect
                x={element.x}
                y={surface.height - element.y - element.height}
                width={element.width}
                height={element.height}
                fill={
                  element.kind === "opening"
                    ? "var(--background)"
                    : "var(--muted)"
                }
                stroke="var(--foreground)"
                strokeWidth={scale * (selected === element.id ? 2 : 1)}
                strokeDasharray={
                  element.kind === "opening"
                    ? `${scale * 6} ${scale * 4}`
                    : undefined
                }
              />
              <text
                x={element.x + element.width / 2}
                y={surface.height - element.y - element.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--foreground)"
                fontSize={Math.min(
                  scale * 11,
                  (element.width / Math.max(element.label.length, 5)) * 1.6,
                )}
              >
                {element.label}
              </text>
              {selected === element.id &&
                [
                  [element.x, surface.height - element.y],
                  [
                    element.x + element.width,
                    surface.height - element.y - element.height,
                  ],
                ].map(([x, y], i) => (
                  <rect
                    key={i}
                    x={x! - scale * 3}
                    y={y! - scale * 3}
                    width={scale * 6}
                    height={scale * 6}
                    fill="var(--foreground)"
                  />
                ))}
            </g>
          ))}
        </g>
        {!elements.length && (
          <>
            <text
              x={surface.width / 2}
              y={surface.height / 2 - scale * 8}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={scale * 12}
            >
              A blank canvas for {surface.name.toLowerCase()}
            </text>
            <text
              x={surface.width / 2}
              y={surface.height / 2 + scale * 14}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={scale * 10}
            >
              Draw features, then tell your agent what you have in mind.
            </text>
          </>
        )}
        <text
          x="0"
          y={surface.height + 0.35}
          fill="var(--muted-foreground)"
          fontSize={scale * 9}
        >
          0, 0
        </text>
      </svg>
      <p className="canvas-caption">
        {tool === "select"
          ? "Select or drag a feature · Dimensions in metres"
          : "Drag to draw · 5 cm snap"}
        <span className="ml-2">
          {surface.kind === "wall" ? "Elevation view" : "Plan view"}
        </span>
      </p>
    </>
  );
}
