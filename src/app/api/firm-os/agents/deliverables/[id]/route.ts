import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, readDeliverable } from "@/lib/agents/service";

// Download a deliverable from SharePoint (access-checked; the file is streamed, never re-hosted).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { id } = await params;
  const f = await readDeliverable(g.user, id, await defaultAgentDeps());
  if (!f.ok) return toJson(f);
  const safe = f.data.name.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(f.data.bytes), {
    status: 200,
    headers: {
      "Content-Type": f.data.mimeType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
