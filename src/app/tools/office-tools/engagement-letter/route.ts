import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseOfficeTools } from "@/lib/office-tools/access";

// The engagement-letter generator is a self-contained HTML page (form + live letter,
// print-to-PDF and Word export all run in the browser; nothing typed is sent back).
// Served whole rather than as a React page so the tested print/.doc behaviour is
// untouched. The letterhead is inlined as data URLs because the Word export needs them.
// See docs/EL-GENERATOR.md.
const DIR = path.join(process.cwd(), "src/lib/office-tools/engagement-letter");

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/", req.url));
  if (!canUseOfficeTools(session.user)) return NextResponse.redirect(new URL("/dashboard", req.url));

  const [html, head, foot] = await Promise.all([
    readFile(path.join(DIR, "el-generator.template.html"), "utf8"),
    readFile(path.join(DIR, "letterhead-header.jpg")),
    readFile(path.join(DIR, "letterhead-footer.jpg")),
  ]);
  const body = html
    .replace("__HEAD__", `data:image/jpeg;base64,${head.toString("base64")}`)
    .replace("__FOOT__", `data:image/jpeg;base64,${foot.toString("base64")}`);

  return new NextResponse(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
