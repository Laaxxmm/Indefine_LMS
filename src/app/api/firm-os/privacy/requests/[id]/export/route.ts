import { NextResponse } from "next/server";
import { downloadAccessExport } from "@/lib/privacy/export";
import { privacyDeps } from "@/lib/privacy/defaults";
import { idZ, parse, signedIn, toJson } from "@/lib/corrections/http";

// Download the access export (JSON with a plain-English summary) for a verified access request.
// The download itself is audited. Never cached.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await signedIn();
  if (!s.ok) return s.res;
  const id = parse(idZ, (await params).id);
  if (!id.ok) return id.res;
  const r = await downloadAccessExport(s.user, id.data, await privacyDeps());
  if (!r.ok) return toJson(r);
  return new NextResponse(JSON.stringify(r.data.data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${r.data.filename}"`,
      "cache-control": "no-store",
    },
  });
}
