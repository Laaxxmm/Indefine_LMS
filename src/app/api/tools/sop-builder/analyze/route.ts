import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canCreateSop } from "@/lib/sop/access";
import { analyzeSopRequest } from "@/lib/sop/gemini";
import { failureSentence } from "@/lib/errors";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(300).default(""),
  department: z.string().max(40),
  workCategory: z.string().max(2_000).default(""),
  purpose: z.string().max(10_000).default(""),
  rawProcedure: z.string().min(10).max(50_000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!(await canCreateSop(session.user))) return NextResponse.json({ error: "You don't have permission to create SOPs. Ask an admin to give you access." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the procedure in at least a sentence or two." }, { status: 400 });

  try {
    return NextResponse.json(await analyzeSopRequest(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The SOP draft could not be prepared.", "Try again in a minute, or write the SOP by hand.") }, { status: 502 });
  }
}
