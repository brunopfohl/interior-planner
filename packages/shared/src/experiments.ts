import { z } from "zod";
import {
  sceneResultSchema,
  surfacesFor,
  type Interior,
  type Job,
} from "./index";

export const metricSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    name: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(30),
    definition: z.string().trim().min(1).max(1000),
    direction: z.enum(["maximize", "minimize", "target"]),
    target: z.number().finite().min(-1e9).max(1e9).nullable(),
    weight: z.number().int().min(1).max(10),
  })
  .superRefine((m, ctx) => {
    if (m.direction === "target" && m.target === null)
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "Set a target value for this metric",
      });
  });
export const createExperimentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    goals: z.string().trim().min(1).max(6000),
    constraints: z.string().max(6000),
    revision: z.number().int().min(1),
    metrics: z.array(metricSchema).min(1).max(12),
  })
  .superRefine((e, ctx) => {
    if (new Set(e.metrics.map((m) => m.id)).size !== e.metrics.length)
      ctx.addIssue({
        code: "custom",
        path: ["metrics"],
        message: "Metric IDs must be unique",
      });
  });
export const evaluationSchema = z.object({
  metricId: z.string().min(1).max(60),
  value: z.number().finite().min(-1e9).max(1e9).nullable(),
  explanation: z.string().min(1).max(2000),
  confidence: z.enum(["low", "medium", "high"]),
});
export const variantResultSchema = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(4000),
  approach: z.string().min(1).max(4000),
  assumptions: z.array(z.string().min(1).max(1000)).max(15),
  tradeoffs: z.array(z.string().min(1).max(1000)).max(15),
  evaluations: z.array(evaluationSchema).min(1).max(12),
  designs: z
    .array(
      z.object({
        surfaceId: z.string().min(1).max(100),
        result: sceneResultSchema,
      }),
    )
    .min(1)
    .max(42),
});
export const experimentResultSchema = z.object({
  baselineEvaluations: z.array(evaluationSchema).max(12),
  variants: z.array(variantResultSchema).min(1).max(4),
});
export const experimentResultJsonSchema = z.toJSONSchema(
  experimentResultSchema,
);
export const generationSchema = z.object({
  count: z.number().int().min(1).max(4),
  brief: z.string().max(4000).default(""),
});
export type Metric = z.infer<typeof metricSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type VariantResult = z.infer<typeof variantResultSchema>;
export type ExperimentResult = z.infer<typeof experimentResultSchema>;
export type Designs = VariantResult["designs"];
export type ExperimentBaseline = { interior: Interior; designs: Designs };
export type ExperimentInput = {
  kind: "experiment";
  experimentId: string;
  name: string;
  goals: string;
  constraints: string;
  metrics: Metric[];
  baseline: ExperimentBaseline;
  baselineEvaluations: Evaluation[];
  count: number;
  brief: string;
  previousVariants: Pick<
    VariantResult,
    "name" | "summary" | "approach" | "evaluations"
  >[];
};
export type ExperimentVariant = VariantResult & {
  id: string;
  jobId: string;
  rank: number;
  notes: string;
  shortlisted: boolean;
  createdAt: string;
};
export type Experiment = {
  id: string;
  interiorId: string;
  name: string;
  goals: string;
  constraints: string;
  metrics: Metric[];
  baseline: ExperimentBaseline;
  baselineEvaluations: Evaluation[];
  revision: number;
  sourceRevision: number;
  createdAt: string;
  updatedAt: string;
  variants: ExperimentVariant[];
  jobs: Job[];
};

export function validateExperimentResult(
  value: unknown,
  input: ExperimentInput,
): ExperimentResult {
  const result = experimentResultSchema.parse(value),
    metricIds = input.metrics.map((m) => m.id).sort(),
    surfaces = new Set(
      surfacesFor(input.baseline.interior.plan).map((s) => s.id),
    );
  function evaluations(items: Evaluation[], label: string) {
    if (
      JSON.stringify(items.map((m) => m.metricId).sort()) !==
      JSON.stringify(metricIds)
    )
      throw new Error(
        `${label} must evaluate every configured metric exactly once`,
      );
  }
  if (result.variants.length !== input.count)
    throw new Error(`Return exactly ${input.count} alternatives`);
  if (input.baselineEvaluations.length) {
    if (result.baselineEvaluations.length)
      throw new Error(
        "Baseline is already evaluated; return an empty baselineEvaluations array",
      );
  } else evaluations(result.baselineEvaluations, "Baseline");
  for (const variant of result.variants) {
    evaluations(variant.evaluations, variant.name);
    if (
      new Set(variant.designs.map((d) => d.surfaceId)).size !==
      variant.designs.length
    )
      throw new Error("Each surface design must occur once");
    if (variant.designs.some((d) => !surfaces.has(d.surfaceId)))
      throw new Error("Alternative contains an unknown surface");
    const objects = variant.designs.flatMap((d) => d.result.objects);
    if (!objects.length || objects.length > 600)
      throw new Error(
        "Each alternative must contain between 1 and 600 scene objects",
      );
  }
  return result;
}
/** Cohort-relative numeric score. Incomplete estimates never receive a score. */
export function metricScores(
  metrics: Metric[],
  candidates: { id: string; evaluations: Evaluation[] }[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const distance = (m: Metric, value: number) =>
    m.direction === "target"
      ? Math.abs(value - m.target!)
      : m.direction === "minimize"
        ? value
        : -value;
  for (const candidate of candidates) {
    let weighted = 0,
      total = 0,
      complete = true;
    for (const m of metrics) {
      const own = candidate.evaluations.find((e) => e.metricId === m.id)?.value;
      if (own === null || own === undefined) {
        complete = false;
        break;
      }
      const values = candidates.flatMap((c) => {
        const v = c.evaluations.find((e) => e.metricId === m.id)?.value;
        return v === null || v === undefined ? [] : [distance(m, v)];
      });
      const min = Math.min(...values),
        max = Math.max(...values);
      weighted +=
        (max === min ? 1 : (max - distance(m, own)) / (max - min)) * m.weight;
      total += m.weight;
    }
    result[candidate.id] = complete
      ? Math.round((weighted / total) * 1000) / 10
      : null;
  }
  return result;
}

export const rankingSchema = z.object({
  revision: z.number().int().min(1),
  ids: z.array(z.uuid()).max(24),
});
export const variantReviewSchema = z.object({
  revision: z.number().int().min(1),
  notes: z.string().max(4000),
  shortlisted: z.boolean(),
});
