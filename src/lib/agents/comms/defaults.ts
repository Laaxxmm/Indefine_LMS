// Production wiring for the comms routes and pages: Prisma, the env-configured ModelRouter, the
// Outlook draft adapter and the person's delegated mail token. Tests replace this module.
import { run } from "@/lib/ai/router";
import { getUserGraphToken } from "@/lib/graph";
import { MAIL_SCOPES } from "@/lib/graph-scopes";
import { createOutlookDraft, findOutlookDraft } from "@/lib/integrations/outlook/drafts";
import { prisma } from "@/lib/prisma";
import type { CommsRouter } from "./drafting";
import type { CommsDb, OutlookPort } from "./service";

export type CommsDeps = {
  db: CommsDb;
  router: CommsRouter;
  now: () => Date;
  outlook: OutlookPort;
  /** Delegated token with MAIL_SCOPES (Mail.ReadWrite), or null when the person has not connected their mailbox. */
  mailToken: (userId: string) => Promise<string | null>;
};

export function commsDeps(): CommsDeps {
  return {
    db: prisma as unknown as CommsDb,
    router: { run },
    now: () => new Date(),
    outlook: { create: (t, i) => createOutlookDraft(t, i), find: (t, id) => findOutlookDraft(t, id) },
    mailToken: (userId) => getUserGraphToken(userId, MAIL_SCOPES),
  };
}
