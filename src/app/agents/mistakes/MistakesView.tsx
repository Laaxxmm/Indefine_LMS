// The mistake log: proposed rules (with the diff they would make to the active SOP pack) and
// decided ones (with the diff they made). Rendered at /agents/mistakes (partners, managers and
// admins) and /admin/firm-os/mistakes (admin area). Only partners get the buttons (SOP rule changes are partner decisions).
import Link from "next/link";
import type { RuleDefinition } from "@/lib/agents/core/checklist";
import type { MistakeRow } from "@/lib/agents/views";
import { linkText, type ChipTone } from "@/components/ui";
import { Chip, PageHeader, Section } from "@/components/firm-os";
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
  if (row.problem) return <p className="text-[12px] text-rose-700 mt-2">{row.problem}</p>;
  if (!row.diff) return null;
  const d = row.diff;
  return (
    <div className="mt-2">
      <p className="text-[12px] text-ink-mute">
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

const STATUS_TONE: Record<MistakeRow["status"], ChipTone> = { PROPOSED: "warning", APPROVED: "success", REJECTED: "neutral" };

function Row({ row, canDecide, names }: { row: MistakeRow; canDecide: boolean; names: Map<string, string> }) {
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{row.pattern}</p>
          <p className="text-[12px] text-ink-mute mt-1">
            {row.agentTitle} · {row.ruleTitle} ({row.severity}) · logged by {names.get(row.createdBy) ?? row.createdBy} on {row.createdAt}
            {row.status !== "PROPOSED" && ` · decided ${row.decidedAt}`}
            {row.runId && (
              <>
                {" · "}
                <Link href={`/agents/${row.agent}/runs/${row.runId}`} className={linkText}>
                  View the run
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Chip tone={STATUS_TONE[row.status]}>
            {row.status}
            {row.promotedToVersion && ` → v${row.promotedToVersion}`}
          </Chip>
          {row.status === "PROPOSED" && canDecide && !row.problem && <MistakeDecision id={row.id} label={row.ruleTitle} toVersion={row.diff?.to ?? null} />}
        </div>
      </div>
      <Diff row={row} />
    </li>
  );
}

const INTRO =
  "Findings reviewers say an agent missed or got wrong. Approving one adds its rule to a new minor version of the SOP pack; the next runs use it. Nothing is promoted without a partner.";

/**
 * `back` renders the agents-area header (back link to the runs list, eyebrow "Firm OS"); `admin`
 * renders the admin-area one (back link to Admin, eyebrow "Admin · Firm OS"). Same PageHeader.
 */
export function MistakesView({ data, names, back, admin = false }: { data: { canDecide: boolean; proposed: MistakeRow[]; decided: MistakeRow[] }; names: Map<string, string>; back?: { href: string; label: string }; admin?: boolean }) {
  return (
    <div>
      {admin ? (
        <PageHeader back={{ href: "/admin", label: "Admin" }} eyebrow="Admin · Firm OS" title="Mistake log" lead={INTRO} />
      ) : (
        <PageHeader back={back} eyebrow="Firm OS · supervised learning" title="Mistake log" lead={INTRO} />
      )}
      <Section id="proposed" title={<>Waiting for a decision ({data.proposed.length})</>} card>
        {data.proposed.length === 0 ? (
          <p className="text-[13px] text-ink-mute">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.proposed.map((r) => (
              <Row key={r.id} row={r} canDecide={data.canDecide} names={names} />
            ))}
          </ul>
        )}
        {!data.canDecide && data.proposed.length > 0 && <p className="text-[12px] text-ink-mute mt-3">Only a partner can approve or reject.</p>}
      </Section>
      <Section id="decided" title="Decided" card last>
        {data.decided.length === 0 ? (
          <p className="text-[13px] text-ink-mute">No decisions yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.decided.map((r) => (
              <Row key={r.id} row={r} canDecide={false} names={names} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
