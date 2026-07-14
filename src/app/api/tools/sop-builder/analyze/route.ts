import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canEditSop } from "@/lib/sop/access";
import { analyzeSopRequest } from "@/lib/sop/gemini";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().default(""),
  department: z.string(),
  workCategory: z.string().default(""),
  purpose: z.string().default(""),
  rawProcedure: z.string().min(10),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canEditSop(session.user))) return NextResponse.json({ error: "You don't have permission to create SOPs" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the procedure in at least a sentence or two." }, { status: 400 });

  try {
    return NextResponse.json(await analyzeSopRequest(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
