import type { CertificateTemplate } from "../types";
import { compose, isTotalRow } from "./compose";
import { resolveValues } from "./values";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Live preview + record view. Same compose() walk as the DOCX, so preview == download.
// Structural styles become bold/centred type; total rows are bolded. Throws (via
// compose's guard) if any placeholder survives (§0.4).
export function renderHtml(template: CertificateTemplate, rawPayload: Record<string, unknown>): string {
  const blocks = compose(template, resolveValues(template, rawPayload));
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "para") {
      const cls = b.lines.some((l) => l.style === "subheading")
        ? "cert-subheading"
        : b.lines.some((l) => l.style === "title")
          ? "cert-title"
          : b.lines.some((l) => l.style === "heading")
            ? "cert-heading"
            : "";
      const inner = b.lines.map((l) => (l.style ? `<strong>${esc(l.text)}</strong>` : esc(l.text))).join("<br/>");
      out.push(`<p${cls ? ` class="${cls}"` : ""}>${inner}</p>`);
    } else {
      const { columns, rowLabels, cells, dynamic } = b.table;
      const corner = dynamic ? "" : "<th></th>";
      const head = `<tr>${corner}${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
      const body = cells
        .map((row, r) => {
          const total = !dynamic && isTotalRow(rowLabels[r]);
          const rowHeader = dynamic ? "" : `<th scope="row">${esc(rowLabels[r])}</th>`;
          return `<tr${total ? ' class="cert-total"' : ""}>${rowHeader}${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`;
        })
        .join("");
      out.push(`<table class="cert-table"><thead>${head}</thead><tbody>${body}</tbody></table>`);
    }
  }
  return out.join("\n");
}
