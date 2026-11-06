// Test helpers: build a TaxExtract from a synthetic accuracy fixture's input files, optionally
// patching organiser.json first (no real client data anywhere).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckInput, InputFile, JobContext } from "@/lib/agents/core/runner";
import type { AisMatch, TaxExtract } from "../analyse";
import { parseTaxFiles, type TaxInput } from "../parse";

const DIR = "fixtures/accuracy/tax";

export function fixtureFiles(id: string): InputFile[] {
  return readdirSync(join(DIR, id, "input"))
    .sort()
    .map((name) => ({ name, source: "fixture" as const, bytes: readFileSync(join(DIR, id, "input", name)) }));
}

export type OrgJson = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Files of a fixture with organiser.json patched (and optional files replaced / removed). */
export function patchedFiles(id: string, patch?: (org: OrgJson) => void, files: Record<string, string | null> = {}): InputFile[] {
  let out = fixtureFiles(id).map((f) => {
    if (f.name !== "organiser.json" || !patch) return f;
    const org = JSON.parse(f.bytes.toString("utf8")) as OrgJson;
    patch(org);
    return { ...f, bytes: Buffer.from(JSON.stringify(org)) };
  });
  for (const [name, text] of Object.entries(files)) {
    out = out.filter((f) => f.name !== name);
    if (text !== null) out.push({ name, source: "fixture", bytes: Buffer.from(text) });
  }
  return out;
}

export function inputOf(id: string, patch?: (org: OrgJson) => void, files?: Record<string, string | null>): TaxInput {
  return parseTaxFiles(patchedFiles(id, patch, files));
}

/** Matches as a correct model would give for the clean salaried fixture (A1→B1, A2→B2). */
export const CLEAN_MATCHES: AisMatch[] = [
  { aisId: "A1", outcome: "matched", bookId: "B1" },
  { aisId: "A2", outcome: "matched", bookId: "B2" },
];

export function extractOf(id: string, patch?: (org: OrgJson) => void, opts: { files?: Record<string, string | null>; matches?: AisMatch[]; fy?: string } = {}): TaxExtract {
  const i = inputOf(id, patch, opts.files);
  return { fy: opts.fy ?? "2025-26", organiser: i.organiser, form26as: i.form26as, ais: i.ais, capitalGains: i.capitalGains, msme: i.msme, priorItr: i.priorItr, aisMatches: opts.matches ?? CLEAN_MATCHES };
}

export const JOB: JobContext = {
  jobTaskId: "job-1",
  title: "Income-tax return AY 2026-27",
  service: "IncomeTax",
  fy: "2025-26",
  period: "Annual",
  clientCode: "ACME01",
  clientName: "Fixture Salaried",
  assigneeId: null,
  reviewerId: null,
};

export const checkInput = (x: TaxExtract): CheckInput<TaxInput, TaxExtract> => ({ input: {} as TaxInput, extracted: x, figures: {}, job: JOB });
