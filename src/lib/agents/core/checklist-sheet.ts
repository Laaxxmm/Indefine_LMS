// The "Checklist" sheet of a draft pack workbook: one row per checklist result (rule, severity,
// status, finding, evidence "quote @ location"). Shared by the agents that print their checklist
// in the pack (ROC, Tax). Pure.
import type { ChecklistResultItem } from "./checklist";
import type { SheetSpec } from "./templates";

export function checklistSheet(results: ChecklistResultItem[]): SheetSpec {
  return {
    name: "Checklist",
    columns: [
      { key: "rule", header: "Rule", width: 26 },
      { key: "severity", header: "Severity" },
      { key: "status", header: "Status" },
      { key: "message", header: "Finding", width: 70 },
      { key: "evidence", header: "Evidence", width: 40 },
    ],
    rows: results.map((r) => ({
      rule: r.ruleId,
      severity: r.severity,
      status: r.status,
      message: r.message,
      evidence: r.evidence ? [r.evidence.quote, r.evidence.location].filter(Boolean).join(" @ ") : "",
    })),
  };
}
