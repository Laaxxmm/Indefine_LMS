// Seeding the default GST SopPack (key "gst", version 1.0.0). The runner refuses to run without
// an active pack ("NO_SOP_PACK"), so a fresh database needs this row once. Create-only and
// idempotent: an existing gst 1.0.0 row (or any later version) is left untouched — packs are
// versioned, never edited in place; changes go through the mistake loop or a new version.
//
// How to seed (one-off, against the target DATABASE_URL, by a person with DB access):
//
//   npx tsx -e "import { PrismaClient } from '@prisma/client'; import { seedGstSopPack } from './src/lib/agents/gst/seed'; const db = new PrismaClient(); seedGstSopPack(db, { createdById: null }).then((r) => { console.log(r); return db.\$disconnect(); });"
//
// Before go-live a CA partner reviews every `params.verify` note in the pack (see config.ts →
// GST_VERIFY_NOTES) and records approval (approvedById) — do not activate an unreviewed pack.
import type { PrismaClient } from "@prisma/client";
import { GST_CHECKLIST, GST_KEY } from "./rules";

export const GST_SOP_PACK_TITLE = "GST Prep (GSTR-1 / GSTR-3B draft pack)";

/** The SopPack row for prisma.sopPack.create (calendar stays with the onboarding calendar pack). */
export function gstSopPackSeed(opts: { createdById?: string | null; approvedById?: string | null } = {}) {
  const [major, minor, patch] = GST_CHECKLIST.version.split(".").map(Number);
  return {
    key: GST_KEY,
    version: GST_CHECKLIST.version,
    major,
    minor,
    patch,
    title: GST_SOP_PACK_TITLE,
    checklist: JSON.parse(JSON.stringify(GST_CHECKLIST)),
    active: true,
    createdById: opts.createdById ?? null,
    approvedById: opts.approvedById ?? null,
    changeNote: "Default GST Prep checklist v1.0.0 (Phase 5). Partner to verify every params.verify note before use.",
  };
}

type SeedDb = { sopPack: Pick<PrismaClient["sopPack"], "findFirst" | "create"> };

export async function seedGstSopPack(db: SeedDb, opts: { createdById?: string | null; approvedById?: string | null } = {}): Promise<{ created: boolean; version: string }> {
  const existing = await db.sopPack.findFirst({ where: { key: GST_KEY }, orderBy: [{ major: "desc" }, { minor: "desc" }, { patch: "desc" }], select: { version: true } });
  if (existing) return { created: false, version: existing.version };
  const row = gstSopPackSeed(opts);
  await db.sopPack.create({ data: row });
  return { created: true, version: row.version };
}
