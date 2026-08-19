import type { CertificateTemplate, FieldDef } from "./types";
import { formatI } from "./templates/format-i";
import { formatII } from "./templates/format-ii";
import { formatIII } from "./templates/format-iii";
import { formatIV } from "./templates/format-iv";
import { formatV } from "./templates/format-v";
import { formatVI } from "./templates/format-vi";
import { formatVII } from "./templates/format-vii";
import { formatVIII } from "./templates/format-viii";
import { formatIX } from "./templates/format-ix";
import { formatX } from "./templates/format-x";
import { formatXI } from "./templates/format-xi";
import { formatXII } from "./templates/format-xii";
import { auditReport } from "./templates/audit-report";
import { drafts } from "./templates/drafts";

// Entity identifiers required on EVERY certificate. Added centrally (not per-template) so
// the ask "PAN + GSTIN mandatory in all certificates" stays one edit. These are FIELDS
// only — never locked text — so they don't touch hashTemplate (locked-text hash) and are
// rendered outside the ICAI segments (see toDocx / preview). Format vi already collects
// the assessee's PAN in its wording; the extra entity PAN there is harmless.
const ENTITY_IDS: FieldDef[] = [
  { key: "entityPAN", label: "Entity PAN", type: "text", required: true },
  { key: "entityGSTIN", label: "Entity GSTIN", type: "text", required: true },
];
const withEntityIds = (t: CertificateTemplate): CertificateTemplate =>
  t.fields.some((f) => f.key === "entityPAN") ? t : { ...t, fields: [...t.fields, ...ENTITY_IDS] };

// The 12 ICAI formats. A template is offered to users only when enabled() — verifier
// passing + human sign-off. Drafts are hidden from the picker in production (§3.2).
export const registry: CertificateTemplate[] = [formatI, formatII, formatIII, formatIV, formatV, formatVI, formatVII, formatVIII, formatIX, formatX, formatXI, formatXII, auditReport, ...drafts].map(withEntityIds);

export const byId = (id: string): CertificateTemplate | undefined => registry.find((t) => t.id === id);

// enabled = human-signed AND not draft. In production the picker shows only these.
export const isEnabled = (t: CertificateTemplate): boolean => t.status === "enabled" && !!t.verifiedBy && !!t.verifiedAt;

export const pickerTemplates = (isProd: boolean): CertificateTemplate[] => (isProd ? registry.filter(isEnabled) : registry);
