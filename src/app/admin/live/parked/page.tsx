import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/access";
import { formatIst } from "@/lib/ist";
import { linkText, td, tr } from "@/components/ui";
import { Alert, Button, Chip, DataTable, EmptyState, PageHeader } from "@/components/firm-os";
import { NOT_PARKED, PARKED_WHAT_TO_DO, loadParkedItems, markParkedReviewed, type ParkedDb } from "@/lib/live/parked";

export const dynamic = "force-dynamic";

// Admin · Live sessions · parked for review: sessions whose recording or transcript mentions client
// details the AI masking cannot cover (AuditEvent gemini.parked). Nothing was sent to Gemini; the
// admin makes the quiz by hand and marks the session reviewed (an AuditEvent; it un-parks nothing).

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
  return session;
}

const db = (): ParkedDb => prisma;

async function markReviewed(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const r = await markParkedReviewed(db(), session.user.id, String(formData.get("entity") ?? ""), String(formData.get("entityId") ?? ""));
  if (!r.ok) redirect("/admin/live/parked?error=not-parked");
  revalidatePath("/admin/live/parked");
  redirect("/admin/live/parked?reviewed=1");
}

export default async function ParkedSessionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const items = await loadParkedItems(db());
  const open = items.filter((i) => !i.reviewed).length;

  return (
    <main className="px-6 py-8 max-w-5xl">
      <PageHeader
        back={{ href: "/admin/live", label: "Live sessions" }}
        eyebrow="Admin · Live sessions"
        title="Parked for review"
        lead="Sessions whose recording or transcript mentions client details that could not be hidden from the AI. No quiz was made for them."
        meta={items.length ? `${open} waiting for review · ${items.length - open} reviewed` : undefined}
      />

      {sp.reviewed === "1" && <Alert tone="success" className="mb-6">Marked as reviewed.</Alert>}
      {sp.error === "not-parked" && <Alert tone="error" className="mb-6">{NOT_PARKED}</Alert>}

      {items.length === 0 ? (
        <EmptyState title="No sessions are parked">A session appears here when its transcript mentions client details that could not be hidden from the AI.</EmptyState>
      ) : (
        <>
          <Alert tone="info" role="note" title="What to do" className="mb-6">
            {PARKED_WHAT_TO_DO}
          </Alert>
          <DataTable
            caption="Live sessions parked for review"
            columns={[{ label: "Session" }, { label: "What could not be hidden" }, { label: "Parked" }, { label: "Status" }, { label: "Action", srOnly: true, align: "right" }]}
          >
            {items.map((i) => (
              <tr key={`${i.entity}:${i.entityId}`} className={tr}>
                <td className={td}>
                  <p className="font-semibold">{i.title}</p>
                  <p className="text-[12px] text-ink-mute">
                    {i.heldAt ? `Held ${formatIst(i.heldAt)}` : i.entity === "Video" ? "Video" : "Live session"}
                    {i.videoHref && (
                      <>
                        {" · "}
                        <Link href={i.videoHref} className={linkText}>
                          Open the video page
                        </Link>
                      </>
                    )}
                  </p>
                </td>
                <td className={td}>{i.reasons.length ? i.reasons.join(", ") : "Client details"}</td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatIst(i.parkedAt)}</td>
                <td className={td}>
                  {i.reviewed ? (
                    <Chip tone="success" title={`Reviewed by ${i.reviewed.by}, ${formatIst(i.reviewed.at)}`}>
                      Reviewed
                    </Chip>
                  ) : (
                    <Chip tone="warning">Waiting for review</Chip>
                  )}
                </td>
                <td className={`${td} text-right`}>
                  {!i.reviewed && (
                    <form action={markReviewed}>
                      <input type="hidden" name="entity" value={i.entity} />
                      <input type="hidden" name="entityId" value={i.entityId} />
                      <Button type="submit" size="sm">
                        Mark reviewed
                      </Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </main>
  );
}
