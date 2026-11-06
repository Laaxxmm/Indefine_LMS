import { NextResponse } from "next/server";
import { confirmErasure, planErasure, publicPlan } from "@/lib/privacy/erasure";
import { guardRegister } from "@/lib/privacy/register";
import { privacyDeps } from "@/lib/privacy/defaults";
import { erasureConfirmZ } from "@/lib/privacy/http";
import { idZ, parse, readJson, signedIn, toJson } from "@/lib/corrections/http";

// GET: the erasure plan — per item, anonymise or legal hold (with basis and hold-until date), kept,
// or a manual step outside Firm OS. POST: a partner or admin confirms the plan they saw
// (fingerprint); the service re-plans and applies it with UPDATEs only. Nothing is ever removed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const denied = guardRegister(s.user);
  if (denied) return toJson(denied);
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const deps = await privacyDeps();
  const plan = await planErasure(deps.db, id.data, deps.now());
  if (!plan) return NextResponse.json({ error: "That privacy request wasn't found. Go back to the register and open it again." }, { status: 404 });
  return NextResponse.json(publicPlan(plan));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(erasureConfirmZ, await readJson(req));
  if (!body.ok) return body.res;
  return toJson(await confirmErasure(s.user, id.data, body.data, await privacyDeps()));
}
