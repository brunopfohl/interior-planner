import type { PlanElement } from "./index";

export type XY = { x: number; y: number };
export type Extent = { width: number; height: number };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const snapTo = (n: number, step: number) =>
  step ? Math.round(n / step) * step : n;
export function selectionBounds(items: PlanElement[]) {
  const x = Math.min(...items.map((e) => e.x)),
    y = Math.min(...items.map((e) => e.y));
  return {
    x,
    y,
    width: Math.max(...items.map((e) => e.x + e.width)) - x,
    height: Math.max(...items.map((e) => e.y + e.height)) - y,
  };
}
export function moveSelection(
  elements: PlanElement[],
  ids: string[],
  delta: XY,
  extent: Extent,
  step = 0,
) {
  const selected = elements.filter((e) => ids.includes(e.id));
  if (!selected.length) return elements;
  const box = selectionBounds(selected),
    dx = clamp(snapTo(delta.x, step), -box.x, extent.width - box.x - box.width),
    dy = clamp(
      snapTo(delta.y, step),
      -box.y,
      extent.height - box.y - box.height,
    );
  return elements.map((e) =>
    ids.includes(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e,
  );
}
export function resizeElement(
  element: PlanElement,
  handle: ResizeHandle,
  point: XY,
  extent: Extent,
  step = 0,
): PlanElement {
  let left = element.x,
    right = element.x + element.width,
    bottom = element.y,
    top = element.y + element.height;
  const x = clamp(snapTo(point.x, step), 0, extent.width),
    y = clamp(snapTo(point.y, step), 0, extent.height);
  if (handle.includes("w")) left = Math.min(x, right - 0.05);
  if (handle.includes("e")) right = Math.max(x, left + 0.05);
  if (handle.includes("s")) bottom = Math.min(y, top - 0.05);
  if (handle.includes("n")) top = Math.max(y, bottom + 0.05);
  return {
    ...element,
    x: left,
    y: bottom,
    width: Number((right - left).toFixed(6)),
    height: Number((top - bottom).toFixed(6)),
  };
}
export function drawnElement(
  kind: PlanElement["kind"],
  points: XY[],
  extent: Extent,
  id: string,
  label: string,
  color: string,
  strokeWidth: number,
): PlanElement {
  const xs = points.map((p) => clamp(p.x, 0, extent.width)),
    ys = points.map((p) => clamp(p.y, 0, extent.height));
  const x = Math.min(Math.min(...xs), extent.width - 0.05),
    y = Math.min(Math.min(...ys), extent.height - 0.05);
  const width = Math.max(0.05, Math.max(...xs) - x),
    height = Math.max(0.05, Math.max(...ys) - y);
  const element: PlanElement = {
    id,
    kind,
    x,
    y,
    width,
    height,
    label,
    color,
    strokeWidth,
  };
  if (kind === "stroke" || kind === "line")
    element.points = points.map((p) => ({
      x: Math.round(clamp((p.x - x) / width, 0, 1) * 10000) / 10000,
      y: Math.round(clamp((p.y - y) / height, 0, 1) * 10000) / 10000,
    }));
  return element;
}
export function duplicateSelection(
  elements: PlanElement[],
  ids: string[],
  extent: Extent,
  makeId: () => string,
): { elements: PlanElement[]; ids: string[] } {
  const selected = elements.filter((e) => ids.includes(e.id));
  if (!selected.length) return { elements, ids: [] };
  const box = selectionBounds(selected),
    dx =
      box.x + box.width + 0.15 <= extent.width
        ? 0.15
        : box.x >= 0.15
          ? -0.15
          : 0,
    dy =
      box.y + box.height + 0.15 <= extent.height
        ? 0.15
        : box.y >= 0.15
          ? -0.15
          : 0;
  const copies = selected.map((e) => ({
    ...e,
    id: makeId(),
    x: e.x + dx,
    y: e.y + dy,
    label: e.kind === "text" ? e.label : `${e.label} copy`.slice(0, 200),
  }));
  return { elements: [...elements, ...copies], ids: copies.map((e) => e.id) };
}
