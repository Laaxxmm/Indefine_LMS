import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshVideoAssignments, canAccessVideo } from "@/lib/assignments";
import { z } from "zod";

const Body = z.object({
  lastPosition: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  completed: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: videoId } = await params;

  // Only record progress for videos assigned to the user (admins exempt) — the
  // same boundary as the page and stream API.
  const exists = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true },
  });
  if (!exists || !(await canAccessVideo(userId, videoId, session.user.role === "ADMIN"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bad body" }, { status: 400 });
  const { lastPosition, percent } = parsed.data;

  const existing = await prisma.videoProgress.findUnique({
    where: { userId_videoId: { userId, videoId } },
  });

  // Never let percent go down (skipping back shouldn't reset progress)
  const nextPercent = Math.max(existing?.percent ?? 0, percent);
  const nextCompleted = (existing?.completed ?? false) || nextPercent >= 95;

  await prisma.videoProgress.upsert({
    where: { userId_videoId: { userId, videoId } },
    create: {
      userId,
      videoId,
      lastPosition,
      percent: nextPercent,
      completed: nextCompleted,
      completedAt: nextCompleted ? new Date() : null,
      watchedSeconds: lastPosition,
    },
    update: {
      lastPosition,
      percent: nextPercent,
      completed: nextCompleted,
      completedAt: nextCompleted ? existing?.completedAt ?? new Date() : null,
      watchedSeconds: Math.max(existing?.watchedSeconds ?? 0, lastPosition),
    },
  });

  if (nextCompleted && !existing?.completed) {
    // First time crossing the completion threshold — re-check assignments.
    await refreshVideoAssignments(userId, videoId);
  }

  return NextResponse.json({ ok: true, percent: nextPercent, completed: nextCompleted });
}
