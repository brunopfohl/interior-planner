import { expect, test } from "bun:test";
import { defaultPlan, type Interior } from "./index";
import {
  createExperimentSchema,
  metricScores,
  validateExperimentResult,
  experimentResultJsonSchema,
  type ExperimentInput,
  type Metric,
} from "./experiments";
import { outputSchema } from "../../../scripts/worker-schema";
const metric: Metric = {
  id: "storage",
  name: "Storage",
  unit: "m³",
  definition: "Usable cabinet volume",
  direction: "maximize",
  target: null,
  weight: 3,
};
const evaluate = (metricId: string, value: number | null) => ({
  metricId,
  value,
  explanation: "Geometry estimate",
  confidence: "medium" as const,
});
const baseline = {
  interior: {
    id: "room",
    name: "Room",
    description: "",
    revision: 1,
    plan: defaultPlan,
    surfaces: {},
    createdAt: "",
    updatedAt: "",
  } as Interior,
  designs: [],
};
const input: ExperimentInput = {
  kind: "experiment",
  experimentId: "test",
  name: "Test",
  goals: "Improve storage",
  constraints: "",
  metrics: [metric],
  baseline,
  baselineEvaluations: [],
  count: 1,
  brief: "",
  previousVariants: [],
};
const variant = {
  name: "Tall storage",
  summary: "More shelves",
  approach: "Use vertical space",
  assumptions: [],
  tradeoffs: [],
  evaluations: [evaluate("storage", 2)],
  designs: [
    {
      surfaceId: "floor",
      result: {
        summary: "Cabinet",
        objects: [
          {
            id: "cabinet",
            label: "Cabinet",
            primitive: "box",
            position: [1, 1, 0.5],
            size: [1, 1, 1],
            rotation: [0, 0, 0],
            color: "#aaaaaa",
            roughness: 0.7,
            metalness: 0,
          },
        ],
      },
    },
  ],
};
const result = {
  baselineEvaluations: [evaluate("storage", 1)],
  variants: [variant],
};
test("validates custom metric definitions and required targets", () => {
  const create = {
    name: "Experiment",
    goals: "Improve",
    constraints: "",
    revision: 1,
    metrics: [metric],
  };
  expect(createExperimentSchema.safeParse(create).success).toBe(true);
  expect(
    createExperimentSchema.safeParse({ ...create, metrics: [metric, metric] })
      .success,
  ).toBe(false);
  expect(
    createExperimentSchema.safeParse({
      ...create,
      metrics: [{ ...metric, direction: "target" }],
    }).success,
  ).toBe(false);
});
test("experiment result must cover the configured metrics and fixed surfaces", () => {
  expect(validateExperimentResult(result, input).variants.length).toBe(1);
  expect(() =>
    validateExperimentResult({ ...result, variants: [] }, input),
  ).toThrow();
  expect(() =>
    validateExperimentResult(
      {
        ...result,
        variants: [{ ...variant, evaluations: [evaluate("other", 2)] }],
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    validateExperimentResult(
      {
        ...result,
        variants: [
          {
            ...variant,
            designs: [{ ...variant.designs[0], surfaceId: "wall:missing" }],
          },
        ],
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    validateExperimentResult(
      {
        ...result,
        variants: [
          { ...variant, designs: [variant.designs[0], variant.designs[0]] },
        ],
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    validateExperimentResult(
      {
        ...result,
        variants: [
          {
            ...variant,
            designs: [
              { surfaceId: "floor", result: { summary: "Empty", objects: [] } },
            ],
          },
        ],
      },
      input,
    ),
  ).toThrow();
});
test("later batches keep the first baseline estimates", () => {
  const next = { ...input, baselineEvaluations: result.baselineEvaluations };
  expect(() => validateExperimentResult(result, next)).toThrow();
  expect(
    validateExperimentResult({ ...result, baselineEvaluations: [] }, next)
      .variants.length,
  ).toBe(1);
});
test("weighted scores respect direction and target distance and do not reward unknowns", () => {
  const metrics = [
    metric,
    { ...metric, id: "cost", direction: "minimize" as const, weight: 1 },
  ];
  expect(
    metricScores(metrics, [
      {
        id: "base",
        evaluations: [evaluate("storage", 1), evaluate("cost", 10)],
      },
      {
        id: "more",
        evaluations: [evaluate("storage", 3), evaluate("cost", 30)],
      },
      {
        id: "unknown",
        evaluations: [evaluate("storage", null), evaluate("cost", 1)],
      },
    ]),
  ).toEqual({ base: 17.2, more: 75, unknown: null });
  expect(
    metricScores(
      [{ ...metric, direction: "target", target: 4 }],
      [
        { id: "close", evaluations: [evaluate("storage", 3)] },
        { id: "far", evaluations: [evaluate("storage", 8)] },
      ],
    ),
  ).toEqual({ close: 100, far: 0 });
  expect(
    metricScores(
      [metric],
      [
        { id: "a", evaluations: [evaluate("storage", -2)] },
        { id: "b", evaluations: [evaluate("storage", -1)] },
      ],
    ),
  ).toEqual({ a: 0, b: 100 });
});
test("experiment JSON schema preserves constraints for the worker", () => {
  const schema = outputSchema(experimentResultJsonSchema);
  expect(
    schema.properties.variants.items.properties.designs.items.properties.result
      .properties.objects.items.properties.size.items.minimum,
  ).toBe(0.001);
  expect(schema.properties.variants.maxItems).toBe(4);
});
