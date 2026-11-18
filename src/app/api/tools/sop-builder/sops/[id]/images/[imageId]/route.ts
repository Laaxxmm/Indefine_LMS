import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewSop } from "@/lib/sop/access";

export const runtime = "nodejs";

// One screenshot of a SOP, for anyone who may read SOPs. An image row never changes, so the
// browser may keep it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canViewSop(session.user)) return NextResponse.json({ error: "You don't have access to SOPs. Ask an admin to give you access." }, { status: 403 });

  const { id, imageId } = await params;
  const image = await prisma.sopImage.findFirst({ where: { id: imageId, sopId: id }, select: { mime: true, bytes: true } });
  if (!image) return NextResponse.json({ error: "That screen wasn't found." }, { status: 404 });
  return new NextResponse(new Uint8Array(image.bytes), {
    headers: { "Content-Type": image.mime, "Content-Disposition": "inline", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
