import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { card, figure, sectionTitle, td, tdNum, tr } from "@/components/ui";
import { Alert, Chip, DataTable, EmptyState, PageHeader, Section } from "@/components/firm-os";
import { prisma } from "@/lib/prisma";
import { turiaStatus } from "@/lib/neo-centra/turia";
import { SERVICE_LABELS } from "@/lib/integrations/turia/adapter";
import { loadTuriaSyncPage, type TuriaSyncPage } from "@/lib/integrations/turia/pull/admin";
import { FREQUENCIES } from "@/lib/integrations/turia/pull/period";
import { ClientPick, PersonPick, RuleForm, SyncNowButton } from "./TuriaSyncForms";

export const dynamic = "force-dynamic";

// Firm OS · Turia sync (ADR-003 amendment): Firm OS reads Turia's tasks, read-only, through the Neo
// Centra sign-in and turns them into jobs. This page shows the mode, the sign-in, the last run and
// its preview, and the three mappings the sync uses (people, clients, rules). Admins only (the
// admin area); every change is recorded.

const MODE_WORDS: Record<TuriaSyncPage["mode"], string> = { off: "Off", "dry-run": "Dry run", on: "On" };
const STATUS_WORDS: Record<string, string> = {
  ok: "Finished",
  partial: "Stopped part way",
  session: "Turia sign-in missing",
  failed: "Stopped",
  running: "Running",
};
const ACTION_WORDS: Record<string, string> = { create: "New job", link: "Link", update: "Change", complete: "Completed", flag: "Flag", unflag: "Flag cleared", wait: "Waiting" };
const MATCH_WORDS: Record<string, string> = { email: "By email", name: "By name", manual: "Picked by hand", none: "Not matched" };
const CLIENT_WORDS: Record<string, string> = { matched: "Matched by name or code", manual: "Picked by hand", unmatched: "Not matched", ignored: "Ignored" };
const FREQUENCY_WORDS: Record<string, string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={card}>
      <p className={sectionTitle}>{label}</p>
      <p className={figure}>{value}</p>
    </div>
  );
}

export default async function TuriaSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const turia = await turiaStatus();
  const p = await loadTuriaSyncPage(prisma, { present: turia.present, updatedAt: turia.updatedAt }, new Date());
  const run = p.lastRun;
  const c = run?.counts ?? {};
  const services = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
  const frequencies = FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_WORDS[f] }));
  const nextPosition = (p.rules.reduce((m, r) => Math.max(m, r.position), 0) || 0) + 10;

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <PageHeader
        back={{ href: "/admin", label: "Admin" }}
        eyebrow="Admin · Firm OS"
        title="Turia sync"
        lead="Firm OS reads tasks from Turia, read only, through the Neo Centra sign-in, and turns them into jobs for the people they are assigned to. Turia is never changed from here."
        action={<SyncNowButton disabled={p.mode === "off" || !p.modeValid} />}
      />

      <div className="space-y-4 mb-8">
        {!p.modeValid && <Alert tone="error" title="The sync setting is not valid.">It must be off, dry run or on. Ask IT to correct it; until then nothing is read.</Alert>}
        {p.modeValid && p.mode === "off" && <Alert tone="info" title="The sync is off.">Nothing is read from Turia. Ask IT to set it to dry run first, check the preview here, then set it to on.</Alert>}
        {p.mode === "dry-run" && <Alert tone="warning" title="Dry run.">Turia is read and the preview below shows what would happen. No job, client or close record is created or changed.</Alert>}
        {p.mode === "on" && <Alert tone="success" title="On.">Jobs are created and updated from Turia every 15 minutes, Monday to Saturday, 9:00 to 20:00 IST.</Alert>}
        {!p.session.present && <Alert tone="error" title="No Turia sign-in is stored.">Open Turia in Chrome with the Neo Centra extension signed in, then try again.</Alert>}
        {p.session.present && !p.session.fresh && (
          <Alert tone="warning" title="The Turia sign-in is not recent.">
            It was last sent {p.session.when ?? "a while ago"}. Keep Turia open in Chrome with the Neo Centra extension signed in so it stays fresh.
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Mode" value={MODE_WORDS[p.mode]} />
        <Stat label="Turia sign-in" value={p.session.present ? (p.session.fresh ? "Fresh" : "Old") : "Missing"} />
        <Stat label="Jobs from Turia" value={p.jobs.fromTuria} />
        <Stat label="Jobs flagged" value={p.jobs.flagged} />
      </div>

      <Section id="last-run" title="Last run">
        {!run ? (
          <EmptyState title="No sync has run yet." />
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] leading-5">
              <Chip tone={run.status === "ok" ? "success" : run.status === "partial" || run.status === "running" ? "warning" : "danger"}>{STATUS_WORDS[run.status] ?? run.status}</Chip>{" "}
              {run.when} · {MODE_WORDS[run.mode as TuriaSyncPage["mode"]] ?? run.mode} · {run.trigger === "manual" ? "started by hand" : "scheduled"}
            </p>
            {run.message && <p className="text-[13px] leading-5 text-ink-mute max-w-3xl">{run.message}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <Stat label="Read" value={c.fetched ?? 0} />
              <Stat label="Unchanged" value={c.unchanged ?? 0} />
              <Stat label="New in Turia" value={c.new ?? 0} />
              <Stat label="Changed in Turia" value={c.changed ?? 0} />
              <Stat label="New jobs" value={(c.create ?? 0) + (c.link ?? 0)} />
              <Stat label="Job changes" value={c.update ?? 0} />
              <Stat label="Completed" value={c.completed ?? 0} />
              <Stat label="No longer in Turia" value={c.missing ?? 0} />
              <Stat label="Without an agent" value={c.agentless ?? 0} />
              <Stat label="People not matched" value={c.unmatchedPeople ?? 0} />
              <Stat label="Clients not matched" value={c.unmatchedClients ?? 0} />
              <Stat label="Waiting" value={(c.waitingClient ?? 0) + (c.waitingPeople ?? 0)} />
            </div>
          </div>
        )}
      </Section>

      <Section id="preview" title={p.mode === "dry-run" ? "Preview: what would happen" : "What the last run did"}>
        {!run || run.preview.length === 0 ? (
          <EmptyState title="Nothing to show: the last run found nothing to create, change or wait on." />
        ) : (
          <DataTable caption="Tasks from the last run" columns={[{ label: "What" }, { label: "Turia task" }, { label: "Client" }, { label: "Detail" }]} sticky>
            {run.preview.map((i, n) => (
              <tr key={n} className={tr}>
                <td className={`${td} whitespace-nowrap`}>{ACTION_WORDS[i.action] ?? i.action}</td>
                <td className={td}>{i.task}</td>
                <td className={td}>{i.client}</td>
                <td className={td}>{i.detail}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section id="people" title="People">
        <p className="text-[13px] leading-5 text-ink-mute mb-4 max-w-3xl">
          Each Turia person is matched to one of the firm&apos;s users by email, then by exact name. Pick the right person for anyone not matched; your pick is kept. A task waits until its
          assignee is matched.
        </p>
        {p.people.length === 0 ? (
          <EmptyState title="No Turia people yet. They appear after the first sync." />
        ) : (
          <DataTable caption="Turia people and the firm's users" columns={[{ label: "Turia person" }, { label: "Matched to" }, { label: "How" }, { label: "Pick" }]}>
            {p.people.map((x) => (
              <tr key={x.turiaUserId} className={tr}>
                <td className={td}>
                  {x.turiaName || "No name in Turia"}
                  {x.turiaEmail && <span className="block text-[12px] text-ink-mute break-all">{x.turiaEmail}</span>}
                </td>
                <td className={td}>{x.userName ?? "Nobody yet"}</td>
                <td className={td}>{MATCH_WORDS[x.matchedBy] ?? x.matchedBy}</td>
                <td className={td}>
                  <PersonPick turiaUserId={x.turiaUserId} turiaName={x.turiaName} userId={x.matchedBy === "manual" ? x.userId : null} users={p.users} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section id="clients" title="Clients">
        <p className="text-[13px] leading-5 text-ink-mute mb-4 max-w-3xl">
          Each Turia client is matched to a client in the client list by its client code, then by exact name. Pick the client, or ignore it. A matched client without a Firm OS client code
          gets one when the sync is on (Turia&apos;s code when it is valid, otherwise one made from the name).
        </p>
        {p.clients.length === 0 ? (
          <EmptyState title="No Turia clients yet. They appear after the first sync." />
        ) : (
          <DataTable caption="Turia clients and the client list" columns={[{ label: "Turia client" }, { label: "Client in the list" }, { label: "Status" }, { label: "Pick" }]}>
            {p.clients.map((x) => (
              <tr key={x.key} className={tr}>
                <td className={td}>
                  {x.turiaName}
                  {x.turiaCode && <span className="block text-[12px] text-ink-mute">Code {x.turiaCode}</span>}
                </td>
                <td className={td}>
                  {x.lmsClientName ?? "None"}
                  {x.lmsClientName && !x.firmOs && <span className="block text-[12px] text-ink-mute">Gets a Firm OS client code when the sync is on</span>}
                </td>
                <td className={td}>{CLIENT_WORDS[x.status] ?? x.status}</td>
                <td className={td}>
                  <ClientPick clientKey={x.key} turiaName={x.turiaName} lmsClientId={x.lmsClientId} status={x.status} clients={p.lmsClients} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section id="rules" title="Task rules">
        <p className="text-[13px] leading-5 text-ink-mute mb-4 max-w-3xl">
          The first rule that is on, in order, whose words appear in the Turia task decides the service, the job title and how often it repeats (which period to read from the
          task name or due date). A task no rule matches still becomes a job, with no agent, prepared by hand.
          {!p.rulesSaved && " These are the starting rules; they are saved on the first sync."}
        </p>
        <DataTable caption="Turia task rules" columns={[{ label: "Order", align: "right" }, { label: "Rule" }, { label: "Words" }, { label: "Job" }, { label: "Agent" }, { label: "On" }]}>
          {p.rules.map((r) => (
            <tr key={r.id} className={tr}>
              <td className={tdNum}>{r.position}</td>
              <td className={td}>{r.label}</td>
              <td className={td}>
                {r.namePattern}
                {r.department && <span className="block text-[12px] text-ink-mute">Department: {r.department}</span>}
              </td>
              <td className={td}>
                {r.serviceLabel} · {r.title} · {FREQUENCY_WORDS[r.frequency]}
              </td>
              <td className={td}>{r.hasAgent ? "Yes" : "No"}</td>
              <td className={td}>{r.active ? "Yes" : "No"}</td>
            </tr>
          ))}
        </DataTable>
        {p.rulesSaved && (
          <div className="mt-4 space-y-2">
            {p.rules.map((r) => (
              <details key={r.id} className={card}>
                <summary className="cursor-pointer text-[13px] font-semibold">Change rule: {r.label}</summary>
                <RuleForm rule={{ ...r }} services={services} frequencies={frequencies} />
              </details>
            ))}
          </div>
        )}
        <details className={`${card} mt-4`}>
          <summary className="cursor-pointer text-[13px] font-semibold">Add a rule</summary>
          <RuleForm
            rule={{ position: nextPosition, label: "", department: null, namePattern: "", service: "GST", title: "", frequency: "MONTHLY", useAgent: true, calendarRuleId: null, active: true }}
            services={services}
            frequencies={frequencies}
          />
        </details>
      </Section>

      <Section id="runs" title="Recent runs" last>
        {p.recentRuns.length === 0 ? (
          <EmptyState title="No sync has run yet." />
        ) : (
          <DataTable caption="Recent Turia sync runs" columns={[{ label: "When" }, { label: "Mode" }, { label: "Started" }, { label: "Result" }]}>
            {p.recentRuns.map((r) => (
              <tr key={r.id} className={tr}>
                <td className={td}>{r.when}</td>
                <td className={td}>{MODE_WORDS[r.mode as TuriaSyncPage["mode"]] ?? r.mode}</td>
                <td className={td}>{r.trigger === "manual" ? "By hand" : "Scheduled"}</td>
                <td className={td}>{STATUS_WORDS[r.status] ?? r.status}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </main>
  );
}
