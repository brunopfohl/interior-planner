import { describe, expect, test } from "bun:test";
import {
  drawnElement,
  duplicateSelection,
  elementSchema,
  moveSelection,
  resizeElement,
  surfacePlanSchema,
  type PlanElement,
} from "./index";

const extent = { width: 6, height: 4 };
const first: PlanElement = {
  id: "first",
  kind: "feature",
  x: 1,
  y: 1,
  width: 2,
  height: 1,
  label: "Cabinet",
};
describe("surface editing", () => {
  test("freehand strokes retain their shape through moving and resizing", () => {
    const stroke = drawnElement(
      "stroke",
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 1 },
      ],
      extent,
      "sketch",
      "Sketch 1",
      "#171717",
      0.02,
    );
    expect(stroke.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(elementSchema.safeParse(stroke).success).toBe(true);
    const moved = moveSelection(
      [stroke],
      [stroke.id],
      { x: 1, y: 0.5 },
      extent,
    )[0]!;
    expect(moved.x).toBe(2);
    expect(moved.y).toBe(1.5);
    expect(moved.points).toEqual(stroke.points);
    const resized = resizeElement(moved, "ne", { x: 5, y: 3.5 }, extent);
    expect(resized.width).toBe(3);
    expect(resized.height).toBe(2);
    expect(resized.points).toEqual(stroke.points);
  });
  test("moving a group respects surface bounds and preserves spacing", () => {
    const second = { ...first, id: "second", x: 4, width: 1 };
    const moved = moveSelection(
      [first, second],
      ["first", "second"],
      { x: 10, y: -10 },
      extent,
      0.05,
    );
    expect(moved.map((e) => e.x)).toEqual([2, 5]);
    expect(moved.map((e) => e.y)).toEqual([0, 0]);
    expect(first.x).toBe(1);
  });
  test("resize handles cannot invert or leave the surface", () => {
    expect(
      resizeElement(first, "sw", { x: -10, y: -10 }, extent),
    ).toMatchObject({ x: 0, y: 0, width: 3, height: 2 });
    const small = resizeElement(first, "ne", { x: -1, y: -1 }, extent);
    expect(small.width).toBeCloseTo(0.05);
    expect(small.height).toBeCloseTo(0.05);
  });
  test("horizontal lines and edge strokes stay valid", () => {
    for (const points of [
      [
        { x: 0, y: 1 },
        { x: 6, y: 1 },
      ],
      [
        { x: 6, y: 0 },
        { x: 6, y: 4 },
      ],
    ]) {
      const line = drawnElement(
        "line",
        points,
        extent,
        "line",
        "Line 1",
        "#171717",
        0.02,
      );
      expect(elementSchema.safeParse(line).success).toBe(true);
      expect(line.x + line.width).toBeLessThanOrEqual(6);
      expect(line.y + line.height).toBeLessThanOrEqual(4);
    }
  });
  test("duplicating preserves geometry with new IDs inside bounds", () => {
    const original = { ...first, x: 4, y: 3 };
    let n = 0;
    const result = duplicateSelection(
      [original],
      [original.id],
      extent,
      () => `copy-${++n}`,
    );
    expect(result.ids).toEqual(["copy-1"]);
    expect(result.elements[1]!.x).toBe(3.85);
    expect(result.elements[1]!.y).toBe(2.85);
    expect(result.elements[0]).toEqual(original);
  });
  test("new tools and legacy rectangles share a validated document", () => {
    const elements = [
      first,
      ...["stroke", "line", "ellipse", "text", "opening"].map((kind, i) => ({
        ...drawnElement(
          kind as PlanElement["kind"],
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          extent,
          `item-${i}`,
          "Item",
          "#445566",
          0.02,
        ),
      })),
    ];
    expect(
      surfacePlanSchema.safeParse({
        notes: "Keep these design ideas",
        elements,
      }).success,
    ).toBe(true);
    expect(
      elementSchema.safeParse({
        ...elements[1],
        points: [
          { x: -0.1, y: 0 },
          { x: 1, y: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});
