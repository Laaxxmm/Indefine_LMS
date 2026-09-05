import { NextResponse } from "next/server";
import { currentActor } from "@/lib/work/actor";
import { createWorkZ } from "@/lib/work/core";
import { createWork } from "@/lib/work/db";
import { notFoundJson, parseBody } from "@/lib/work/http";

// Capture an idea. Lands in INBOX, owned by whoever typed it.
export async function POST(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(createWorkZ, req);
  if (body.res) return body.res;
  const work = await createWork(body.data, actor);
  return NextResponse.json(work, { status: 201 });
}
