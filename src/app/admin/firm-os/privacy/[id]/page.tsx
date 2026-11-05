import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { isAdmin } from "@/lib/access";
import { btnGhost, card } from "@/components/ui";
import { BackLink, chip, eyebrow, focusRing, pageTitle, sectionTitle } from "@/app/agents/parts";
import { HistoryLink } from "@/components/CorrectionHistory";
import { prisma } from "@/lib/prisma";
import { NOTHING_MATCHED, NOT_RESOLVED, getRequest } from "@/lib/privacy/register";
import { buildAccessExport } from "@/lib/privacy/export";
import { planErasure, publicPlan, type PlanAction } from "@/lib/privacy/erasure";
import { KIND_SECTIONS, PRINCIPAL_LABELS, RESTRICTIONS, VERIFY_METHODS, WITHDRAWAL_LIMITS, type PrincipalType } from "@/lib/privacy/policy";
import { activeRestrictionsOf } from "@/lib/privacy/consent";
import { canLiftRestriction } from "@/lib/rbac/policy";
import { CloseForm, ConfirmStep, LiftRestrictionForm, NominationForm, VerifyForm } from "../PrivacyForms";
import { DueDate, OverdueChip, RequestStatusChip } from "../parts";

export const dynamic = "force-dynamic";

// Firm OS · one privacy request: its facts and due dates, then the workflow — logged, identity
// verified, the step for its kind (export / correction / erasure plan / restriction / nominee /
// reply) and closing. Erasure shows the full plan, item by item, before a partner or admin confirms.

const ACTION_TONE: Record<PlanAction, string> = {
  anonymise: "border-rose-200 bg-rose-50 text-rose-700",
  hold: "border-amber-300 bg-amber-100 text-amber-900",
  keep: "border-border bg-muted text-ink-soft",
  manual: "border-sky-200 bg-sky-50 text-sky-800",
};
const ACTION_LABEL: Record<PlanAction, string> = { anonymise: "Anonymise", hold: "Legal hold", keep: "Kept as is", manual: "Manual step" };
const headCell = "font-semibold py-2.5";

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={card} aria-labelledby={`step-${n}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={`step-${n}`} className={`${sectionTitle} !mb-0`}>
          Step {n} · {title}
        </h2>
        {done !== undefined && <span className={`${chip} ${done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-muted text-ink-soft"}`}>{done ? "Done" : "To do"}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function PrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const { id } = await params;
  const now = new Date();
  const d = await getRequest(prisma, id, now);
  if (!d) notFound();

  const open = d.daysLeft !== null;
  // Every data step works on the one linked person only; several matches are resolved in Step 1 first.
  const linked = !!d.principalRef;
  const unresolved = !linked && d.matches.length > 1;
  const notLinked = unresolved ? NOT_RESOLVED : NOTHING_MATCHED;
  const clientRefs = linked && d.principalType !== "staff" ? [d.principalRef as string] : [];
  const firmClients = d.kind === "correction" && clientRefs.length ? await prisma.firmClient.findMany({ where: { lmsClientId: { in: clientRefs } }, select: { id: true, lmsClientId: true, clientCode: true } }) : [];
  const access = d.kind === "access" && d.verified && linked ? await buildAccessExport(prisma, id, now) : null;
  const plan = d.kind === "erasure" ? await planErasure(prisma, id, now) : null;
  const shown = plan ? publicPlan(plan) : null;
  const principalType = (d.principalType in PRINCIPAL_LABELS ? d.principalType : "client-contact") as PrincipalType;
  const completesHere = d.kind === "access" || d.kind === "correction" || d.kind === "grievance";
  const restricted = d.kind === "consent-withdrawal" || d.kind === "erasure" ? await activeRestrictionsOf(prisma, id) : [];
  const restrictedLabels = [...new Set(restricted.flatMap((r) => r.labels))];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <BackLink href="/admin/firm-os/privacy">Privacy requests</BackLink>
      <div className="mb-6">
        <p className={eyebrow}>Admin · Firm OS · Privacy request</p>
        <h1 className={pageTitle}>{d.kindLabel}</h1>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-sm text-ink-mute">
          <RequestStatusChip status={d.status} label={d.statusLabel} />
          {d.overdue && <OverdueChip />}
          <span className="break-words">{d.principalLabel}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Step n={1} title="Logged" done>
            <p className="text-[13.5px]">
              Received {d.receivedLabel}.{" "}
              {linked
                ? "Linked to one record in Firm OS and the LMS client master; every step below works on that record only."
                : unresolved
                  ? `These identifiers match ${d.matches.length} different records. Choose the one this request is about; until then nothing is shared, changed or erased.`
                  : "No matching records were found. The request can't be completed as done; log it again with another identifier, or refuse it with the reason."}
            </p>
            {unresolved && open && (
              <ul className="mt-3 space-y-3">
                {d.matches.map((m) => (
                  <li key={`${m.principalType}:${m.ref}`} className="rounded-xl border border-border p-3">
                    <p className="text-[13.5px] font-semibold break-words">{m.label}</p>
                    <p className="text-[12px] text-ink-mute mb-2">{PRINCIPAL_LABELS[m.principalType]}</p>
                    <ConfirmStep
                      url={`/api/firm-os/privacy/requests/${encodeURIComponent(d.id)}/resolve`}
                      body={{ ref: m.ref }}
                      label="This request is about this record…"
                      confirmLabel="Link to this record"
                      consequence="Only this record's data will be shared, corrected, restricted or erased for this request. The other matches are left alone."
                      tone="primary"
                    />
                  </li>
                ))}
              </ul>
            )}
            {d.notes && <p className="text-[13px] text-ink-soft mt-2 whitespace-pre-wrap">{d.notes}</p>}
          </Step>

          <Step n={2} title="Verify identity" done={d.verified}>
            {d.verified ? (
              <p className="text-[13.5px]">Identity verified. See the timeline for how it was checked.</p>
            ) : open ? (
              <>
                <p className="text-[13px] text-ink-soft mb-3">Check that the request really comes from the person before sharing, changing or erasing anything.</p>
                <VerifyForm id={d.id} methods={VERIFY_METHODS} />
              </>
            ) : (
              <p className="text-[13px] text-ink-mute">The request was closed without verifying identity.</p>
            )}
          </Step>

          {d.kind === "access" && (
            <Step n={3} title="Share the data">
              {!d.verified ? (
                <p className="text-[13px] text-ink-mute">Verify identity first; the export is available after that.</p>
              ) : !linked ? (
                <p className="text-[13px] text-ink-mute">{notLinked}</p>
              ) : (
                <>
                  <ul className="space-y-1.5 text-[13.5px] mb-4 list-disc pl-5">
                    {access?.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <a href={`/api/firm-os/privacy/requests/${encodeURIComponent(d.id)}/export`} className={`${btnGhost} ${focusRing} inline-flex items-center gap-1.5`} download>
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download export (JSON)
                  </a>
                  <p className="text-[12px] text-ink-mute mt-2">The file holds the person&apos;s personal data. Send it only to them, by a secure route; each download is recorded.</p>
                </>
              )}
            </Step>
          )}

          {d.kind === "correction" && (
            <Step n={3} title="Correct the records">
              {!d.verified ? (
                <p className="text-[13px] text-ink-mute">Verify identity first; corrections open after that.</p>
              ) : !linked ? (
                <p className="text-[13px] text-ink-mute">{notLinked}</p>
              ) : principalType === "staff" ? (
                <p className="text-[13.5px]">Staff details are corrected in Admin → Team &amp; hierarchy. Make the change there, then close this request with the reply.</p>
              ) : clientRefs.length === 0 ? (
                <p className="text-[13px] text-ink-mute">No client records matched, so there is nothing to correct here.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] text-ink-soft">Each correction is checked the same way as on the client page, saved with a reason and recorded against this request.</p>
                  {clientRefs.map((ref) => (
                    <div key={ref} className="space-y-2">
                      <HistoryLink entity="Client" id={ref} label="Client master: history and corrections" privacyRequestId={d.id} />
                      {firmClients
                        .filter((fc) => fc.lmsClientId === ref)
                        .map((fc) => (
                          <HistoryLink key={fc.id} entity="FirmClient" id={fc.id} label={`Firm OS client ${fc.clientCode}: history and corrections`} privacyRequestId={d.id} />
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </Step>
          )}

          {d.kind === "erasure" && shown && (
            <Step n={3} title="Erasure plan">
              <p className="text-[13px] text-ink-soft mb-3">
                Nothing is deleted. Each item is anonymised in place, or kept under a legal hold where a law makes the firm keep it. Periods are counted from the
                end of the client&apos;s latest financial year with work; a partner or lawyer is to verify each basis.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Erasure plan, one row per item of personal data</caption>
                  <thead className="text-ink-mute">
                    <tr className="border-b border-border">
                      <th scope="col" className={`text-left ${headCell} pr-3`}>Item</th>
                      <th scope="col" className={`text-left ${headCell} px-3`}>Action</th>
                      <th scope="col" className={`text-left ${headCell} px-3`}>Hold until</th>
                      <th scope="col" className={`text-left ${headCell} pl-3`}>What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.items.map((i) => (
                      <tr key={i.key} className="border-b border-border last:border-0 align-top">
                        <td className="pr-3 py-2.5">{i.label}</td>
                        <td className="px-3 py-2.5">
                          <span className={`${chip} ${ACTION_TONE[i.action]}`}>{ACTION_LABEL[i.action]}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{i.holdUntilLabel ?? <span className="text-ink-mute">–</span>}</td>
                        <td className="pl-3 py-2.5 text-[13px]">
                          <p>{i.consequence}</p>
                          {i.basis.length > 0 && (
                            <details className="mt-1">
                              <summary className={`cursor-pointer text-[12px] font-semibold text-brand-600 rounded ${focusRing}`}>Basis and what to verify</summary>
                              <ul className="mt-1 space-y-1.5 text-[12px] text-ink-soft">
                                {i.basis.map((b) => (
                                  <li key={b.id}>
                                    <span className="font-semibold">{b.label}.</span> {b.rule} <span className="text-amber-800">{b.verify}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                {!open ? (
                  <p className="text-[13px] text-ink-mute">This request is closed.</p>
                ) : !d.verified ? (
                  <p className="text-[13px] text-ink-mute">Verify identity first; a partner or admin can confirm the erasure after that.</p>
                ) : !linked ? (
                  <p className="text-[13px] text-ink-mute">{notLinked}</p>
                ) : (
                  <ConfirmStep
                    url={`/api/firm-os/privacy/requests/${encodeURIComponent(d.id)}/erasure`}
                    body={{ fingerprint: shown.fingerprint }}
                    label="Erase personal data…"
                    confirmLabel="Confirm erasure"
                    consequence={`${shown.counts.anonymise} item${shown.counts.anonymise === 1 ? "" : "s"} will be anonymised and can't be restored. ${shown.counts.hold} stay on legal hold, unchanged, and processing of held client data is restricted. ${shown.counts.manual} step${shown.counts.manual === 1 ? "" : "s"} outside Firm OS stay with a partner.`}
                  />
                )}
              </div>
            </Step>
          )}

          {d.kind === "consent-withdrawal" && (
            <Step n={3} title="Restrict processing">
              <ul className="space-y-1.5 text-[13.5px] mb-3">
                {RESTRICTIONS.map((r) => (
                  <li key={r.key}>
                    <span className="font-semibold">{r.label}.</span> <span className="text-ink-soft">{r.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-ink-soft mb-3">{WITHDRAWAL_LIMITS}</p>
              {open && d.verified && unresolved ? (
                <p className="text-[13px] text-ink-mute">{NOT_RESOLVED}</p>
              ) : open && d.verified ? (
                <ConfirmStep
                  url={`/api/firm-os/privacy/requests/${encodeURIComponent(d.id)}/consent-withdrawal`}
                  label="Restrict processing…"
                  confirmLabel="Confirm restrictions"
                  consequence="The restrictions apply to the record this request is linked to, and the request is completed. Firm OS keeps the record of the restriction."
                  tone="primary"
                />
              ) : (
                <p className="text-[13px] text-ink-mute">{open ? "Verify identity first; the restrictions can be recorded after that." : "This request is closed."}</p>
              )}
            </Step>
          )}

          {d.kind === "nomination" && (
            <Step n={3} title="Record the nominee">
              {open && d.verified ? (
                <NominationForm id={d.id} />
              ) : (
                <p className="text-[13px] text-ink-mute">{open ? "Verify identity first; the nominee can be recorded after that." : "This request is closed."}</p>
              )}
            </Step>
          )}

          {restricted.length > 0 && (
            <section className={card} aria-labelledby="restriction-in-force">
              <h2 id="restriction-in-force" className={sectionTitle}>
                Restriction in force
              </h2>
              <p className="text-[13.5px] mb-2">
                {restricted.length} record{restricted.length === 1 ? "" : "s"} of this person {restricted.length === 1 ? "is" : "are"} restricted: {restrictedLabels.join("; ")}. Agent runs, onboarding
                reading and message drafts for {restricted.length === 1 ? "it" : "them"} are refused until a partner lifts the restriction.
              </p>
              {canLiftRestriction(session.user) ? (
                <LiftRestrictionForm id={d.id} />
              ) : (
                <p className="text-[13px] text-ink-mute">Only a partner can lift this restriction. Ask a partner to review this request.</p>
              )}
            </section>
          )}

          <Step n={d.kind === "grievance" ? 3 : 4} title={d.kind === "grievance" ? "Reply and close" : "Close"} done={!open}>
            {open ? (
              <CloseForm id={d.id} canComplete={completesHere} completeLabel={d.kind === "grievance" ? "Send reply and close" : "Complete request"} />
            ) : (
              <div className="text-[13.5px] space-y-1">
                <p>
                  <span className="font-semibold">Outcome:</span> {d.outcome ?? "–"}
                </p>
                {d.legalHold && (
                  <p>
                    <span className="font-semibold">Legal hold:</span> {d.legalHold}
                  </p>
                )}
              </div>
            )}
          </Step>
        </div>

        <aside className="space-y-6 min-w-0">
          <section className={card} aria-labelledby="facts">
            <h2 id="facts" className={sectionTitle}>
              Request
            </h2>
            <dl className="text-[13.5px] space-y-2">
              <div>
                <dt className="text-ink-mute text-[12px]">Right</dt>
                <dd>
                  {d.kindLabel} (DPDP Act {KIND_SECTIONS[d.kind]})
                </dd>
              </div>
              <div>
                <dt className="text-ink-mute text-[12px]">Person</dt>
                <dd>{PRINCIPAL_LABELS[principalType]}</dd>
              </div>
              <div>
                <dt className="text-ink-mute text-[12px]">Received</dt>
                <dd className="tabular-nums">{d.receivedLabel}</dd>
              </div>
              <div>
                <dt className="text-ink-mute text-[12px]">Due (firm target)</dt>
                <dd>
                  <DueDate label={d.dueLabel} overdue={d.overdue} daysLeft={d.daysLeft} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-mute text-[12px]">Outer limit</dt>
                <dd className="tabular-nums">{d.outerLimitLabel}</dd>
              </div>
            </dl>
            <p className="text-[12px] text-ink-soft mt-3">{d.timelineBasis.basis}</p>
            <p className="text-[12px] text-amber-800 mt-1">{d.timelineBasis.verify}</p>
          </section>

          <section className={card} aria-labelledby="timeline">
            <h2 id="timeline" className={sectionTitle}>
              Timeline
            </h2>
            <ol className="space-y-3">
              {d.timeline.map((e) => (
                <li key={e.id} className="text-[13px]">
                  <p className="text-[11.5px] text-ink-mute tabular-nums">
                    {e.actorName} · {e.atLabel} IST
                  </p>
                  <p className="font-semibold">{e.label}</p>
                  {e.detail && <p className="text-ink-soft">{e.detail}</p>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
