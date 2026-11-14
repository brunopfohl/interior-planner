import { describe, expect, test } from "bun:test";
import {
  area,
  defaultPlan,
  floorPlanSchema,
  sceneResultSchema,
  surfacesFor,
  validPolygon,
} from "./index";

describe("floor plan geometry", () => {
  test("computes shell surfaces in metres with stable wall IDs", () => {
    expect(area(defaultPlan.points)).toBe(24);
    const surfaces = surfacesFor(defaultPlan);
    expect(surfaces.map((s) => s.id)).toEqual([
      "floor",
      "ceiling",
      "wall:a",
      "wall:b",
      "wall:c",
      "wall:d",
    ]);
    expect(surfaces[2]!.width).toBe(6);
    expect(surfaces[3]!.width).toBe(4);
    expect(surfaces[2]!.height).toBe(2.7);
  });
  test("accepts concave footprints", () => {
    const points = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 6, y: 0 },
      { id: "c", x: 6, y: 2 },
      { id: "d", x: 3, y: 2 },
      { id: "e", x: 3, y: 5 },
      { id: "f", x: 0, y: 5 },
    ];
    expect(validPolygon(points)).toBe(true);
    expect(area(points)).toBe(21);
  });
  test("rejects crossings, reversed winding, short edges, and duplicated IDs", () => {
    expect(validPolygon([...defaultPlan.points].reverse())).toBe(false);
    expect(
      validPolygon([
        defaultPlan.points[0]!,
        defaultPlan.points[2]!,
        defaultPlan.points[1]!,
        defaultPlan.points[3]!,
      ]),
    ).toBe(false);
    expect(
      validPolygon(
        defaultPlan.points.map((p, i) => (i === 1 ? { ...p, x: 0.1 } : p)),
      ),
    ).toBe(false);
    expect(
      validPolygon(defaultPlan.points.map((p) => ({ ...p, id: "same" }))),
    ).toBe(false);
    expect(
      floorPlanSchema.safeParse({ ...defaultPlan, height: 0 }).success,
    ).toBe(false);
  });
});
describe("agent output validation", () => {
  const object = {
    id: "cabinet",
    label: "Oak cabinet",
    primitive: "box",
    position: [1, 0.4, 0.25],
    size: [2, 0.8, 0.5],
    rotation: [0, 0, 0],
    color: "#a88a65",
    roughness: 0.7,
    metalness: 0,
  };
  test("accepts declarative geometry", () =>
    expect(
      sceneResultSchema.safeParse({
        summary: "Custom cabinetry",
        objects: [object],
      }).success,
    ).toBe(true));
  test("rejects executable output, invalid geometry and duplicate object IDs", () => {
    expect(
      sceneResultSchema.safeParse({
        summary: "Bad output",
        objects: [{ ...object, primitive: "javascript", code: "alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      sceneResultSchema.safeParse({
        summary: "Bad size",
        objects: [{ ...object, size: [0, -1, 2] }],
      }).success,
    ).toBe(false);
    expect(
      sceneResultSchema.safeParse({
        summary: "Duplicate",
        objects: [object, object],
      }).success,
    ).toBe(false);
    expect(
      sceneResultSchema.safeParse({
        summary: "Bad color",
        objects: [{ ...object, color: "url(unsafe)" }],
      }).success,
    ).toBe(false);
  });
});
