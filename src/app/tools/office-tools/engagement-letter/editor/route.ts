import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";

// The engagement-letter generator is a self-contained HTML page (form + live letter,
// print-to-PDF and Word export all run in the browser). Served whole rather than as a
// React page so the tested print/.doc behaviour is untouched. The server fills in:
//   __HEAD__/__FOOT__  letterhead as data URLs (the Word export needs them inline)
//   __CLIENTS__        client names already in the LMS, suggested in the Client field
//   __PRELOAD__        the saved letter for ?id= (or an earlier version with &v=<eventId>)
// See docs/EL-GENERATOR.md.
const DIR = path.join(process.cwd(), "src/lib/office-tools/engagement-letter");

// JSON inside <script>: stop "</script>" and friends from closing the tag.
const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/", req.url));
  if (!canUseOfficeTools(session.user)) return NextResponse.redirect(new URL("/dashboard", req.url));

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const v = url.searchParams.get("v");
  let preload: { id: string; version: number; data: unknown; restoredFrom?: string } | null = null;
  if (id) {
    const letter = await prisma.engagementLetter.findUnique({ where: { id }, select: { id: true, data: true } });
    if (!letter) return NextResponse.redirect(new URL("/tools/office-tools/engagement-letter", req.url));
    const saves = await prisma.engagementLetterEvent.findMany({
      where: { letterId: id, action: "saved" },
      orderBy: { at: "asc" },
      select: { id: true, data: true },
    });
    const old = v ? saves.findIndex((s) => s.id === v) : -1;
    preload =
      old >= 0
        ? { id, version: saves.length, data: saves[old].data, restoredFrom: `v${old + 1}` }
        : { id, version: saves.length, data: letter.data };
  }

  const [html, head, foot, clients] = await Promise.all([
    readFile(path.join(DIR, "el-generator.template.html"), "utf8"),
    readFile(path.join(DIR, "letterhead-header.jpg")),
    readFile(path.join(DIR, "letterhead-footer.jpg")),
    prisma.client.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const body = html
    .replace("__HEAD__", `data:image/jpeg;base64,${head.toString("base64")}`)
    .replace("__FOOT__", `data:image/jpeg;base64,${foot.toString("base64")}`)
    .replace("__CLIENTS__", () => js(clients.map((c) => c.name)))
    .replace("__PRELOAD__", () => js(preload));

  return new NextResponse(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
