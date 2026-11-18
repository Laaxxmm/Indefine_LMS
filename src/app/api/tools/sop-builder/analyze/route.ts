import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { canCreateSop } from "@/lib/sop/access";
import { analyzeSopRequest } from "@/lib/sop/gemini";
import { aiFailure } from "@/lib/sop/service";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(300).default(""),
  department: z.string().max(40),
  workCategory: z.string().max(2_000).default(""),
  purpose: z.string().max(10_000).default(""),
  rawProcedure: z.string().min(10).max(50_000),
});

// Check a described procedure with the AI (through the mask gate) and draft the brief. Nothing is
// saved; the call itself is audited (who sent how much text, and whether the gate refused it).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!(await canCreateSop(session.user))) return NextResponse.json({ error: "You don't have permission to create SOPs. Ask an admin to give you access." }, { status: 403 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = Body.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: "Describe the procedure in at least a sentence or two." }, { status: 400 });

  const audit = (outcome: string) =>
    logAudit(prisma, { actorId: session.user.id, action: "sop.analyze", entity: "Sop", entityId: null, meta: { department: parsed.data.department, chars: parsed.data.rawProcedure.length, outcome } });
  try {
    const analysis = await analyzeSopRequest(parsed.data);
    await audit(analysis.valid ? "valid" : "rejected");
    return NextResponse.json(analysis);
  } catch (e) {
    await audit((e as { name?: unknown } | null)?.name === "LegacyGateError" ? "gate-refused" : "failed");
    const f = aiFailure(e, "The SOP draft could not be prepared.", "Try again in a minute, or write the SOP by hand.");
    return NextResponse.json(f.body, { status: f.status });
  }
}
