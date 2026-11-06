// Production wiring of the Turia pull: Prisma, Neo Centra's stored Turia sign-in and its Turia
// request function (only through the read-only client), and the onboarding planner's calendar.
import { packDueDates, type CalendarPack } from "@/lib/agents/core";
import { loadCalendarPack } from "@/lib/agents/onboarding/db";
import { turiaStatus } from "@/lib/neo-centra/turia";
import { prisma } from "@/lib/prisma";
import type { Frequency } from "./period";
import type { StatutoryDueFn } from "./plan";
import { createTuriaReader } from "./read-client";
import type { PullDeps } from "./sync";

/** Statutory due date of a job from a calendar pack, or null when the calendar cannot say. */
export function calendarDue(pack: CalendarPack): StatutoryDueFn {
  return (ruleId: string, fy: string, period: string, frequency: Frequency) => {
    if (!pack.rules.some((r) => r.id === ruleId)) return null;
    const r = packDueDates(pack, ruleId, { fy, period, qrmp: frequency === "QUARTERLY" && ruleId.startsWith("gstr-") });
    return r.ok ? r.statutoryDueAt : null;
  };
}

export function turiaPullDeps(): PullDeps {
  return {
    db: prisma,
    reader: createTuriaReader(),
    session: async () => {
      const s = await turiaStatus();
      return { present: s.present, updatedAt: s.updatedAt };
    },
    loadStatutoryDue: async () => calendarDue((await loadCalendarPack(prisma)).pack),
  };
}
