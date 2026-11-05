// Request bodies for /api/firm-os/agents/** (zod; the routes reject anything else with 400).
import { z } from "zod";

const note = z.string().trim().max(2000, "Keep the note under 2,000 characters");

export const requestChangesZ = z.object({ note: note.min(3, "Say what needs to change") }).strict();
export const approveZ = z.object({ note: note.optional().nullable() }).strict();
export const commentZ = z.object({ text: z.string().trim().min(1, "Write a comment first").max(2000) }).strict();
export const mistakeZ = z
  .object({
    finding: z.string().trim().min(3, "Describe what the agent missed or got wrong").max(1000),
    ruleProposal: z.record(z.unknown()),
    example: z.unknown().optional(),
  })
  .strict();
export const decideZ = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
