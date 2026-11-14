import { z } from "zod";
import {
  floorPlanSchema,
  sceneResultSchema,
  surfacesFor,
  type Interior,
  type Job,
} from "./index";

const importElement = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["feature", "opening"]),
  x: z.number().min(0).max(70),
  y: z.number().min(0).max(70),
  width: z.number().min(0.05).max(70),
  height: z.number().min(0.05).max(70),
  label: z.string().max(200),
});
export const importProposalSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000),
    summary: z.string().min(1).max(4000),
    assumptions: z.array(z.string().min(1).max(1000)).max(15),
    plan: floorPlanSchema,
    surfacePlans: z
      .array(
        z.object({
          surfaceId: z.string().min(1).max(100),
          notes: z.string().max(8000),
          elements: z.array(importElement).max(100),
        }),
      )
      .max(42),
    designs: z
      .array(
        z.object({
          surfaceId: z.string().min(1).max(100),
          result: sceneResultSchema,
        }),
      )
      .max(42),
  })
  .superRefine((proposal, ctx) => {
    const surfaces = surfacesFor(proposal.plan),
      ids = new Set(surfaces.map((s) => s.id));
    for (const [key, items] of [
      ["surfacePlans", proposal.surfacePlans],
      ["designs", proposal.designs],
    ] as const) {
      if (new Set(items.map((item) => item.surfaceId)).size !== items.length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Each surface may appear only once",
        });
      for (const [i, item] of items.entries())
        if (!ids.has(item.surfaceId))
          ctx.addIssue({
            code: "custom",
            path: [key, i, "surfaceId"],
            message: "Unknown surface",
          });
    }
    for (const [i, entry] of proposal.surfacePlans.entries()) {
      const surface = surfaces.find((s) => s.id === entry.surfaceId);
      if (!surface) continue;
      for (const [j, item] of entry.elements.entries())
        if (
          item.x + item.width > surface.width + 0.001 ||
          item.y + item.height > surface.height + 0.001
        )
          ctx.addIssue({
            code: "custom",
            path: ["surfacePlans", i, "elements", j],
            message: "Feature extends outside the surface",
          });
    }
    if (
      proposal.designs.reduce((sum, d) => sum + d.result.objects.length, 0) >
      600
    )
      ctx.addIssue({
        code: "custom",
        path: ["designs"],
        message: "Use at most 600 scene objects across the import",
      });
  });
export const importReplySchema = z.object({
  message: z.string().min(1).max(6000),
  questions: z.array(z.string().min(1).max(1000)).max(6),
  proposal: importProposalSchema.nullable(),
});
export const importReplyJsonSchema = z.toJSONSchema(importReplySchema);
export type ImportProposal = z.infer<typeof importProposalSchema>;
export type ImportReply = z.infer<typeof importReplySchema>;
export type ImportImage = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
};
export type ImportMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  revision: number;
  imageIds: string[];
  reply: ImportReply | null;
};
export type ImportSession = {
  id: string;
  name: string;
  revision: number;
  interiorId: string | null;
  createdAt: string;
  updatedAt: string;
  images: ImportImage[];
  messages: ImportMessage[];
  jobs: Job[];
};
export type ImportJobInput = {
  kind: "import";
  sessionId: string;
  images: ImportImage[];
  messages: Pick<ImportMessage, "role" | "content" | "reply">[];
  previousProposal: ImportProposal | null;
};
export type AppliedImport = { interior: Interior };
export const importChatSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});
