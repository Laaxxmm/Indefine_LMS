// The mistake log: proposed rules (with the diff they would make to the active SOP pack) and
// decided ones (with the diff they made). Rendered at /agents/mistakes (partners, managers and
// admins) and /admin/firm-os/mistakes (admin area). Only partners and managers get the buttons.
import Link from "next/link";
import type { RuleDefinition } from "@/lib/agents/core/checklist";
import type { MistakeRow } from "@/lib/agents/views";
import { card } from "@/components/ui";
import { BackLink, chip, eyebrow, focusRing, pageTitle, sectionTitle } from "../parts";
import { MistakeDecision } from "./MistakeDecision";

function RuleLines({ rule }: { rule: RuleDefinition }) {
  const rows: [string, string][] = [
    ["id", rule.id],
    ["title", rule.title],
    ["severity", rule.severity],
    ["kind", rule.kind],
    ["check", rule.check],
    ["evidence", rule.evidence],
  ];
  if (rule.params) rows.push(["params", JSON.stringify(rule.params)]);
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span aria-hidden="true">+</span>
          <span className="text-emerald-900">
            <span className="font-bold">{k}:</span> {v}
          </span>
        </div>
      ))}
    </>
  );
}

function Diff({ row }: { row: MistakeRow }) {
  if (row.problem) return <p className="text-[12.5px] text-rose-700 mt-2">{row.problem}</p>;
  if (!row.diff) return null;
  const d = row.diff;
  return (
    <div className="mt-2">
      <p className="text-[11.5px] text-ink-mute">
        SOP pack {d.from === "previous" ? "previous version" : `v${d.from}`} → v{d.to}
        {row.status === "PROPOSED" && " (on approval)"}
      </p>
      <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-[12px] break-words" aria-label="Rule added">
        {d.added.map((r) => (
          <RuleLines key={r.id} rule={r} />
        ))}
        {d.added.length === 0 && <span>No rule change</span>}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<MistakeRow["status"], string> = {
  PROPOSED: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REJECTED: "border-border bg-muted text-ink-soft",
};

function Row({ row, canDecide, names }: { row: MistakeRow; canDecide: boolean; names: Map<string, string> }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">{row.pattern}</p>
          <p className="text-[11.5px] text-ink-mute mt-0.5">
            {row.agentTitle} · {row.ruleTitle} ({row.severity}) · logged by {names.get(row.createdBy) ?? row.createdBy} on {row.createdAt}
            {row.status !== "PROPOSED" && ` · decided ${row.decidedAt}`}
            {row.runId && (
              <>
                {" · "}
                <Link href={`/agents/${row.agent}/runs/${row.runId}`} className={`text-brand-600 hover:underline rounded ${focusRing}`}>
                  View the run
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`${chip} ${STATUS_TONE[row.status]}`}>
            {row.status}
            {row.promotedToVersion && ` → v${row.promotedToVersion}`}
          </span>
          {row.status === "PROPOSED" && canDecide && !row.problem && <MistakeDecision id={row.id} label={row.ruleTitle} />}
        </div>
      </div>
      <Diff row={row} />
    </li>
  );
}

const INTRO =
  "Findings reviewers say an agent missed or got wrong. Approving one adds its rule to a new minor version of the SOP pack; the next runs use it. Nothing is promoted without a partner or manager.";

/** The admin area's page header (eyebrow "Admin · …", title, "← Admin" on the right), as on the models and cycle-time pages. */
function AdminHeader() {
  return (
    <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
      <div>
        <p className={`${eyebrow} mb-1.5`}>Admin · Firm OS</p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">Mistake log</h1>
        <p className="text-sm text-ink-mute mt-2 max-w-2xl">{INTRO}</p>
      </div>
      <Link
        href="/admin"
        className={`text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0 ${focusRing}`}
      >
        ← Admin
      </Link>
    </div>
  );
}

/**
 * `back` renders the agents-area header (back link to the runs list, eyebrow "Firm OS"); `admin`
 * renders the admin-area header instead, so each copy matches the pages around it.
 */
export function MistakesView({ data, names, back, admin = false }: { data: { canDecide: boolean; proposed: MistakeRow[]; decided: MistakeRow[] }; names: Map<string, string>; back?: { href: string; label: string }; admin?: boolean }) {
  return (
    <div>
      {admin ? (
        <AdminHeader />
      ) : (
        <>
          {back && <BackLink href={back.href}>{back.label}</BackLink>}
          <div className="mb-6">
            <p className={eyebrow}>Firm OS · supervised learning</p>
            <h1 className={pageTitle}>Mistake log</h1>
            <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">{INTRO}</p>
          </div>
        </>
      )}
      <section aria-labelledby="proposed" className={`${card} mb-6`}>
        <h2 id="proposed" className={sectionTitle}>
          Waiting for a decision ({data.proposed.length})
        </h2>
        {data.proposed.length === 0 ? (
          <p className="text-[13px] text-ink-mute">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.proposed.map((r) => (
              <Row key={r.id} row={r} canDecide={data.canDecide} names={names} />
            ))}
          </ul>
        )}
        {!data.canDecide && data.proposed.length > 0 && <p className="text-[12.5px] text-ink-mute mt-3">Only a partner or manager can approve or reject.</p>}
      </section>
      <section aria-labelledby="decided" className={card}>
        <h2 id="decided" className={sectionTitle}>
          Decided
        </h2>
        {data.decided.length === 0 ? (
          <p className="text-[13px] text-ink-mute">No decisions yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.decided.map((r) => (
              <Row key={r.id} row={r} canDecide={false} names={names} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
