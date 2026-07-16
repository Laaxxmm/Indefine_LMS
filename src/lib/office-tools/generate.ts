import { z } from "zod";
import { rentalZ, renderRentalDocx, type RentalInput } from "./tools/rental";
import { mouZ, renderMouDocx, type MouInput } from "./tools/mou";
import { partnershipZ, renderPartnershipDocx, type PartnershipInput } from "./tools/partnership";
import { trustZ, renderTrustDocx, type TrustInput } from "./tools/trust";
import { llpZ, renderLlpDocx, type LlpInput } from "./tools/llp";
import { directorReportZ, renderDirectorReportDocx, type DirectorReportInput } from "./tools/directorReport";

// Dispatcher for the JSON-form legal/financial document generators. Each entry
// validates the posted body, renders a .docx, and supplies a filename + a one-line
// audit summary. The dynamic route /api/tools/office-tools/doc/[tool] fans out here.

export const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "document";

// Erased shape stored in the map; `def` keeps each entry strongly typed to its schema.
export type DocGen = {
  schema: z.ZodTypeAny;
  render: (input: unknown) => Promise<Buffer>;
  filename: (input: unknown) => string;
  summary: (input: unknown) => string;
};

function def<S extends z.ZodTypeAny>(g: {
  schema: S;
  render: (i: z.infer<S>) => Promise<Buffer>;
  filename: (i: z.infer<S>) => string;
  summary: (i: z.infer<S>) => string;
}): DocGen {
  return g as unknown as DocGen;
}

export const DOC_GENERATORS: Record<string, DocGen> = {
  rental: def({
    schema: rentalZ,
    render: renderRentalDocx,
    filename: (i: RentalInput) => `Rental_Agreement_${slug(i.tenantName)}`,
    summary: (i: RentalInput) => `${i.ownerName} → ${i.tenantName}`,
  }),
  mou: def({
    schema: mouZ,
    render: renderMouDocx,
    filename: (i: MouInput) => `MOU_${slug(i.projectTitle)}`,
    summary: (i: MouInput) => `${i.party1Short} & ${i.party2Short} — ${i.projectTitle}`,
  }),
  partnership: def({
    schema: partnershipZ,
    render: renderPartnershipDocx,
    filename: (i: PartnershipInput) => `${slug(i.partnershipName)}_Partnership_Deed`,
    summary: (i: PartnershipInput) => `${i.partnershipName} — ${i.partners.length} partners`,
  }),
  trust: def({
    schema: trustZ,
    render: renderTrustDocx,
    filename: (i: TrustInput) => `${slug(i.trustName)}_Trust_Deed`,
    summary: (i: TrustInput) => `${i.trustName} — ${i.parties.length} trustees`,
  }),
  llp: def({
    schema: llpZ,
    render: renderLlpDocx,
    filename: (i: LlpInput) => `${slug(i.llpName)}_Agreement`,
    summary: (i: LlpInput) => `${i.llpName} — ${i.partners.length} partners (${i.llpType})`,
  }),
  "director-report": def({
    schema: directorReportZ,
    render: renderDirectorReportDocx,
    filename: (i: DirectorReportInput) => `${slug(i.companyName)}_Directors_Report`,
    summary: (i: DirectorReportInput) => `${i.companyName} — FY ${i.financialYear}`,
  }),
};
