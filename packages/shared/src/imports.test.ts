import { expect, test } from "bun:test";
import { defaultPlan } from "./index";
import {
  importReplySchema,
  importProposalSchema,
  importReplyJsonSchema,
} from "./imports";
import { outputSchema } from "../../../scripts/worker-schema";
const proposal = {
  name: "Kitchen",
  description: "Imported drawing",
  summary: "A measured shell",
  assumptions: [],
  plan: defaultPlan,
  surfacePlans: [],
  designs: [],
};
test("import can ask questions before proposing a scene", () => {
  expect(
    importReplySchema.safeParse({
      message: "What is the wall length?",
      questions: ["How long is the wall?"],
      proposal: null,
    }).success,
  ).toBe(true);
  expect(importProposalSchema.safeParse(proposal).success).toBe(true);
});
test("import rejects unknown, duplicate and out-of-bounds surface annotations", () => {
  const entry = {
    surfaceId: "wall:a",
    notes: "",
    elements: [
      {
        id: "door",
        kind: "opening",
        x: 0,
        y: 0,
        width: 1,
        height: 2,
        label: "Door",
      },
    ],
  };
  expect(
    importProposalSchema.safeParse({ ...proposal, surfacePlans: [entry] })
      .success,
  ).toBe(true);
  for (const surfacePlans of [
    [{ ...entry, surfaceId: "wall:unknown" }],
    [entry, entry],
    [{ ...entry, elements: [{ ...entry.elements[0], x: 6 }] }],
  ])
    expect(
      importProposalSchema.safeParse({ ...proposal, surfacePlans }).success,
    ).toBe(false);
});
test("import worker schema preserves nullable proposals and geometry constraints", () => {
  const schema = outputSchema(importReplyJsonSchema);
  const p = schema.properties.proposal.anyOf.find(
    (s: any) => s.type === "object",
  );
  expect(
    p.properties.designs.items.properties.result.properties.objects.items
      .properties.size.items.minimum,
  ).toBe(0.001);
  expect(p.required).toContain("assumptions");
});
