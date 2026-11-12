import { Fragment } from "react";
import type { SopContent, SopSubProcess } from "@/lib/sop/types";
import { departmentLabel } from "@/lib/sop/labels";

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="sop-table">
      <thead>
        <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

const List = ({ items }: { items: string[] }) => <ul className="sop-list">{items.map((r, i) => <li key={i}>{r}</li>)}</ul>;

// One sub-process's steps; a step with screens is followed by a full-width row showing them.
// A screen opens full size in a new tab.
function StepTable({ p, sopId }: { p: SopSubProcess; sopId?: string }) {
  const headers = ["Step", "Who", "Action", "System / screen", "Input → Output", "Control"];
  return (
    <table className="sop-table">
      <thead>
        <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {p.steps.map((s, i) => (
          <Fragment key={i}>
            <tr>{[s.no, s.role, s.action, s.system, [s.input, s.output].filter(Boolean).join(" → "), s.control].map((c, j) => <td key={j}>{c}</td>)}</tr>
            {sopId && s.screens?.length ? (
              <tr className="sop-screens">
                <td colSpan={headers.length}>
                  {s.screens.map((sc, k) => {
                    const src = `/api/tools/sop-builder/sops/${sopId}/images/${sc.imageId}`;
                    const caption = `Screen ${s.no}${sc.caption ? ` — ${sc.caption}` : ""}`;
                    return (
                      <figure key={k}>
                        <a href={src} target="_blank" rel="noopener" title="Open full size">
                          {/* eslint-disable-next-line @next/next/no-img-element -- served by the SOP image route, which checks access */}
                          <img src={src} alt={caption} loading="lazy" />
                        </a>
                        <figcaption>{caption}</figcaption>
                      </figure>
                    );
                  })}
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function SopDocView({ c, sopId }: { c: SopContent; sopId?: string }) {
  // Detailed SOPs (schemaVersion 2) carry sub-processes; older versions carry a flat procedure.
  const subProcesses = c.subProcesses ?? [];
  const detailed = subProcesses.length > 0;

  const sections: { t: string; body: React.ReactNode }[] = [
    { t: "Purpose", body: <p>{c.purpose}</p> },
    { t: "Scope", body: <p>{c.scope}</p> },
  ];
  if (c.definitions.length) sections.push({ t: "Definitions", body: <DataTable headers={["Term", "Meaning"]} rows={c.definitions.map((d) => [d.term, d.meaning])} /> });
  if (c.responsibilities.length) sections.push({ t: "Responsibilities", body: <DataTable headers={["Role", "Responsibility"]} rows={c.responsibilities.map((r) => [r.role, r.duty])} /> });
  if (detailed) {
    sections.push({
      t: "Procedure",
      body: subProcesses.map((p) => {
        const differences = p.steps.flatMap((s) => s.ifThen.map((t) => `${s.no}: ${t}`));
        return (
          <div key={p.code}>
            <h3 className="sop-sub">{p.code} — {p.name}</h3>
            {p.objective && <p><strong>Objective:</strong> {p.objective}</p>}
            {p.owner && <p><strong>Process owner:</strong> {p.owner}</p>}
            <div className="sop-wide">
              <StepTable p={p} sopId={sopId} />
            </div>
            {differences.length > 0 && (
              <>
                <p className="sop-label">If something is different</p>
                <List items={differences} />
              </>
            )}
          </div>
        );
      }),
    });
    if (c.controls?.length) sections.push({ t: "Controls", body: <DataTable headers={["Control", "Type", "What is checked"]} rows={c.controls.map((k) => [k.id, k.type === "APPLICATION" ? "Application" : "Manual", k.description])} /> });
    if (c.kpis?.length) sections.push({ t: "Key Performance Indicators", body: <List items={c.kpis} /> });
    if (c.risks?.length) sections.push({ t: "Risk and Control Matrix", body: <DataTable headers={["Risk", "Control", "Owner", "Frequency"]} rows={c.risks.map((r) => [r.risk, r.control, r.owner, r.frequency])} /> });
    if (c.openPoints?.length)
      sections.push({
        t: "Points to Confirm",
        body: (
          <>
            <p>The author&apos;s description did not cover these. Confirm each one, then issue a new version.</p>
            <List items={c.openPoints} />
          </>
        ),
      });
  } else {
    sections.push({ t: "Procedure", body: <DataTable headers={["Step", "Action", "Responsibility"]} rows={c.procedure.map((p) => [String(p.step), p.action, p.responsibility])} /> });
  }
  if (c.references.length) sections.push({ t: "References", body: <List items={c.references} /> });

  return (
    <div className="sop-doc">
      <h1 className="sop-title">{c.title}</h1>
      <table className="sop-meta">
        <tbody>
          <tr><th>Department</th><td>{departmentLabel(c.department)}</td><th>Revision</th><td>{c.revision}</td></tr>
          <tr><th>Work category</th><td>{c.workCategory}</td><th>Effective date</th><td>{c.effectiveDate}</td></tr>
          {detailed && <tr><th>Prepared by</th><td>{c.preparedBy ?? ""}</td><th>Reviewed by</th><td></td></tr>}
        </tbody>
      </table>

      {c.flowchart.length > 0 && (
        <div className="sop-flow">
          {c.flowchart.map((s, i) => (
            <div key={i} className="sop-flow-item">
              <div className="sop-flow-box">{s}</div>
              {i < c.flowchart.length - 1 && <div className="sop-flow-arrow">↓</div>}
            </div>
          ))}
        </div>
      )}

      {sections.map((s, i) => (
        <section key={i}>
          <h2 className="sop-h">{i + 1}. {s.t}</h2>
          {s.body}
        </section>
      ))}

      <style>{`
        .sop-doc { color: #15132b; font-size: 13.5px; line-height: 1.55; }
        .sop-doc .sop-title { font-family: var(--font-display), 'Schibsted Grotesk', sans-serif; font-weight: 800; font-size: 20px; text-align: center; margin: 0 0 14px; letter-spacing: -0.01em; }
        .sop-doc .sop-h { font-weight: 700; font-size: 14px; margin: 18px 0 7px; }
        .sop-doc .sop-sub { font-weight: 700; font-size: 13.5px; margin: 16px 0 6px; }
        .sop-doc .sop-label { font-weight: 700; margin: 8px 0 4px; }
        .sop-doc .sop-wide { overflow-x: auto; }
        .sop-doc p { margin: 0 0 10px; }
        .sop-doc table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 12.5px; }
        .sop-doc th, .sop-doc td { border: 1px solid #ececf3; padding: 6px 9px; text-align: left; vertical-align: top; }
        .sop-doc .sop-meta th { background: #f1f0f7; width: 15%; white-space: nowrap; }
        .sop-doc .sop-table thead th { background: #f5f5fb; font-weight: 700; }
        .sop-doc .sop-list { margin: 0 0 10px 18px; list-style: disc; }
        .sop-doc .sop-flow { margin: 10px 0 16px; }
        .sop-doc .sop-flow-box { border: 1px solid #cdc9ee; background: #f7f6ff; border-radius: 8px; padding: 8px 12px; text-align: center; font-weight: 600; width: 70%; margin: 0 auto; font-size: 12.5px; }
        .sop-doc .sop-flow-arrow { text-align: center; color: #8a86a8; font-size: 18px; line-height: 1.2; }
        .sop-doc .sop-screens td { background: #fafafe; text-align: center; }
        .sop-doc figure { margin: 8px auto; }
        .sop-doc figure img { display: inline-block; max-width: 100%; max-height: 520px; border: 1px solid #e4e3ee; border-radius: 6px; }
        .sop-doc figcaption { font-size: 12px; color: #6b6880; font-style: italic; margin-top: 4px; }
      `}</style>
    </div>
  );
}
