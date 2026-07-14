import { createHash } from "node:crypto";
import type { CertificateTemplate, Segment } from "./types";

// Normalization defines what "verbatim" means for the fidelity verifier (§6.1).
// The SAME normalizer is applied to both the source-PDF text and the template's
// locked segments before comparison. Rendering (toHtml/toDocx) uses the RAW
// segment text, so output keeps correct spacing while matching normalizes noise.
export function normalize(input: string): string {
  return (
    input
      // curly quotes / apostrophes / ellipsis -> ASCII
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/…/g, "...")
      // en/em dash -> hyphen (PDF sometimes renders "-" as these)
      .replace(/[–—]/g, "-")
      // ponytail: join hyphenated line-breaks ("...00-00-\n   007..." -> "...00-00-007...").
      // The ICAI reference numbers wrap after a real hyphen; without this the collapsed
      // whitespace would insert a stray space. Safe for this corpus: only fires on a
      // hyphen at end-of-line (bullets start a line, so they are untouched).
      .replace(/-[ \t]*\r?\n[ \t]*/g, "-")
      // collapse all remaining whitespace to single spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

// The canonical locked text of a template: every { kind: "text" } segment, in order,
// joined and normalized. This is what the hash pins (§6.5) and what the verifier
// asserts appears verbatim & in order in the source (§6.3).
export function lockedTextSegments(t: CertificateTemplate): string[] {
  return t.segments.filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text").map((s) => s.text);
}

export function canonicalLockedText(t: CertificateTemplate): string {
  return normalize(lockedTextSegments(t).join("\n"));
}

export function hashTemplate(t: CertificateTemplate): string {
  return createHash("sha256").update(canonicalLockedText(t), "utf8").digest("hex");
}
