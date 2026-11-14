import { z } from "zod";

export const pointSchema = z.object({
  id: z.string().min(1).max(80),
  x: z.number().finite().min(0).max(50),
  y: z.number().finite().min(0).max(50),
});
export type Point = z.infer<typeof pointSchema>;

export function area(points: Pick<Point, "x" | "y">[]) {
  return Math.abs(signedArea(points));
}
export function signedArea(points: Pick<Point, "x" | "y">[]) {
  return (
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}
export function bounds(points: Pick<Point, "x" | "y">[]) {
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
export function validPolygon(points: Point[]) {
  if (
    points.length < 3 ||
    signedArea(points) < 0.5 ||
    new Set(points.map((p) => p.id)).size !== points.length
  )
    return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.2) return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      const o1 = orientation(a, b, c),
        o2 = orientation(a, b, d);
      const o3 = orientation(c, d, a),
        o4 = orientation(c, d, b);
      if (
        o1 * o2 <= 0 &&
        o3 * o4 <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      )
        return false;
    }
  }
  return true;
}
export const floorPlanSchema = z.object({
  points: z
    .array(pointSchema)
    .min(3)
    .max(40)
    .refine(
      validPolygon,
      "Use a non-intersecting, clockwise floor plan of at least 0.5 m², with edges at least 0.2 m long.",
    ),
  height: z.number().min(1.8).max(8),
  wallThickness: z.number().min(0.05).max(0.6),
});
export type FloorPlan = z.infer<typeof floorPlanSchema>;
export const defaultPlan: FloorPlan = {
  points: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 6, y: 0 },
    { id: "c", x: 6, y: 4 },
    { id: "d", x: 0, y: 4 },
  ],
  height: 2.7,
  wallThickness: 0.15,
};

export const elementSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["feature", "opening", "stroke", "line", "ellipse", "text"]),
  x: z.number().min(0).max(70),
  y: z.number().min(0).max(70),
  width: z.number().min(0.05).max(70),
  height: z.number().min(0.05).max(70),
  label: z.string().max(200),
  points: z
    .array(
      z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    )
    .min(2)
    .max(600)
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  strokeWidth: z.number().min(0.001).max(0.2).optional(),
});
export type PlanElement = z.infer<typeof elementSchema>;
export const surfacePlanSchema = z.object({
  notes: z.string().max(8000),
  elements: z.array(elementSchema).max(100),
});
export type SurfacePlan = z.infer<typeof surfacePlanSchema>;
export const blankSurface = (): SurfacePlan => ({ notes: "", elements: [] });
export * from "./surface-editing";

const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const sceneObjectSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  primitive: z.enum(["box", "cylinder", "sphere"]),
  position: z.tuple([
    z.number().min(-100).max(100),
    z.number().min(-100).max(100),
    z.number().min(-100).max(100),
  ]),
  size: z.tuple([
    z.number().min(0.001).max(70),
    z.number().min(0.001).max(70),
    z.number().min(0.001).max(70),
  ]),
  rotation: vector,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
});
export const sceneResultSchema = z.object({
  summary: z.string().min(1).max(4000),
  objects: z
    .array(sceneObjectSchema)
    .max(300)
    .refine(
      (objects) => new Set(objects.map((o) => o.id)).size === objects.length,
      "Object IDs must be unique",
    ),
});
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type SceneResult = z.infer<typeof sceneResultSchema>;
export const sceneResultJsonSchema = z.toJSONSchema(sceneResultSchema);

export type Surface = {
  id: string;
  name: string;
  kind: "floor" | "ceiling" | "wall";
  width: number;
  height: number;
  start?: Point;
  end?: Point;
};
export function surfacesFor(plan: FloorPlan): Surface[] {
  const box = bounds(plan.points);
  return [
    {
      id: "floor",
      name: "Floor",
      kind: "floor",
      width: box.width,
      height: box.height,
    },
    {
      id: "ceiling",
      name: "Ceiling",
      kind: "ceiling",
      width: box.width,
      height: box.height,
    },
    ...plan.points.map((start, i): Surface => {
      const end = plan.points[(i + 1) % plan.points.length]!;
      return {
        id: `wall:${start.id}`,
        name: `Wall ${String(i + 1).padStart(2, "0")}`,
        kind: "wall",
        width: Math.hypot(end.x - start.x, end.y - start.y),
        height: plan.height,
        start,
        end,
      };
    }),
  ];
}
export type Interior = {
  id: string;
  name: string;
  description: string;
  plan: FloorPlan;
  surfaces: Record<string, SurfacePlan>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";
export type Job = {
  id: string;
  interiorId: string;
  surfaceId: string;
  surfaceName: string;
  status: JobStatus;
  progress: number;
  message: string;
  workerId: string | null;
  attempt: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  result: SceneResult | null;
  objectCount: number;
};
export type JobEvent = { at: string; kind: string; message: string };
export type JobDetails = Job & {
  input: JobInput;
  draftResult: unknown;
  events: JobEvent[];
};
export type JobInput = {
  interiorName: string;
  floorPlan: FloorPlan;
  surface: Surface;
  surfacePlan: SurfacePlan;
  instructions: string;
};
export const createInteriorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
});
export const saveInteriorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000),
  plan: floorPlanSchema,
  surfaces: z.record(z.string().max(100), surfacePlanSchema),
  revision: z.number().int().min(1),
});
