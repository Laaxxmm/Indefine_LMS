// A small, fully in-memory Firm OS world for agent framework tests: one client (ACME01) with a
// CL- site on the fake SharePoint, one Books JobTask, the echo SOP pack, a recorded router and
// the real runner / service wiring.
import type { Session } from "next-auth";
import { createMemoryDb, type MemoryDb } from "@/lib/agents/core/memory-db";
import { clientDocsInputSource } from "@/lib/agents/core/inputs";
import { createRecordedRouter, type RecordedResponses, type RecordedRouter } from "@/lib/agents/core/recorded-router";
import { ECHO_CHECKLIST, ECHO_EXTRACT_TASK, type EchoExtract } from "@/lib/agents/echo";
import { AGENTS } from "@/lib/agents/registry";
import type { AnyAgent, RunnerDeps } from "@/lib/agents/core/runner";
import { createDeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { createSharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { FakeSharePoint } from "./fake-sharepoint";

export const NOW = new Date("2026-11-05T06:30:00.000Z");
export const PERIOD_PATH = "FY2026-27/Books/2026-10";
export const WORKING = `${PERIOD_PATH}/Working`;
export const FINAL = `${PERIOD_PATH}/Final`;
export const CLIENT_DOCS = `${PERIOD_PATH}/ClientDocs`;
export const RELATED_TASK = "system.check:echo.related-party";

export const REGISTER_CSV = [
  "ref,party,date,amount",
  "INV-1,Acme Traders,2026-10-05,15000.00",
  "INV-2,Bright Supplies,2026-10-06,23456.50",
  "INV-3,City Logistics,2026-10-07,8999.99",
].join("\n");

export const CLEAN_EXTRACT: EchoExtract = {
  rows: [
    { ref: "INV-1", party: "Acme Traders", date: "2026-10-05", amountPaise: 1500000 },
    { ref: "INV-2", party: "Bright Supplies", date: "2026-10-06", amountPaise: 2345650 },
    { ref: "INV-3", party: "City Logistics", date: "2026-10-07", amountPaise: 899999 },
  ],
};

/** INV-1 twice (block), a ₹2,00,000.00 round amount (warn), a Saturday (info). */
export const GAP_EXTRACT: EchoExtract = {
  rows: [
    { ref: "INV-1", party: "Acme Traders", date: "2026-10-05", amountPaise: 1500000 },
    { ref: "INV-1", party: "Acme Traders", date: "2026-10-10", amountPaise: 20000000 },
  ],
};

export const PASS_VERDICT = { status: "pass", evidence: { quote: "Acme Traders", location: "register.csv row 2" } };

export const USERS = {
  priya: { id: "u-priya", level: "EXECUTIVE" }, // assignee (staff)
  ravi: { id: "u-ravi", level: "SENIOR_EXECUTIVE" }, // reviewer (staff)
  meera: { id: "u-meera", level: "MANAGER" },
  partner: { id: "u-partner", level: "PARTNER" },
  admin: { id: "u-admin", level: "EXECUTIVE", role: "ADMIN" as const },
  outsider: { id: "u-out", level: "EXECUTIVE" },
};

export function user(key: keyof typeof USERS, over: Partial<Session["user"]> = {}): Session["user"] {
  const u = USERS[key] as { id: string; level: string; role?: "ADMIN" };
  return { id: u.id, name: key, email: `${key}@indefine.test`, image: null, role: u.role ?? "EMPLOYEE", active: true, department: "ACCOUNTS", level: u.level, ...over };
}

/** Same shape as AgentServiceDeps (src/lib/agents/service.ts). */
export type AgentServiceDeps = RunnerDeps & { agents: Readonly<Record<string, AnyAgent>> };

export type World = {
  fake: FakeSharePoint;
  drive: NonNullable<ReturnType<FakeSharePoint["drive"]>>;
  db: MemoryDb;
  router: RecordedRouter;
  deps: AgentServiceDeps;
};

export function echoWorld(
  opts: { register?: string | null; responses?: RecordedResponses; jobState?: string; service?: string; provision?: boolean; pack?: boolean } = {},
): World {
  const fake = new FakeSharePoint();
  const site = fake.addSite("/sites/CL-ACME01");
  const drive = fake.addLibrary(site, "Compliance");
  if (opts.provision !== false) for (const k of ["Working", "Final", "ClientDocs"]) fake.addFolder(drive, `${PERIOD_PATH}/${k}`);
  if (opts.register !== null) fake.addFile(drive, `${CLIENT_DOCS}/register.csv`, opts.register ?? REGISTER_CSV, "text/csv");
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "graph-token", sleep: async () => {} });
  const store = createDeliverableStore(client);

  let tick = 0;
  const db = createMemoryDb({ now: () => new Date(NOW.getTime() + tick++ * 1000) });
  db.seed("client", [{ id: "c1", name: "Acme Pvt Ltd" }]);
  db.seed("firmClient", [{ id: "fc1", lmsClientId: "c1", clientCode: "ACME01" }]);
  db.seed("jobTask", [
    {
      id: "job-1",
      firmClientId: "fc1",
      service: opts.service ?? "Books",
      fy: "2026-27",
      period: "2026-10",
      title: "Echo register",
      state: opts.jobState ?? "ASSIGNED",
      assigneeId: USERS.priya.id,
      reviewerId: USERS.ravi.id,
    },
  ]);
  if (opts.pack !== false) db.seed("sopPack", [{ key: "echo", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Echo", checklist: ECHO_CHECKLIST }]);

  const router = createRecordedRouter(opts.responses ?? { [ECHO_EXTRACT_TASK]: CLEAN_EXTRACT, [RELATED_TASK]: PASS_VERDICT });
  let n = 0;
  const deps: AgentServiceDeps = {
    db,
    router,
    store,
    inputs: clientDocsInputSource(client, store),
    now: () => new Date(NOW.getTime() + tick++ * 1000),
    ids: () => `run-${++n}`,
    agents: AGENTS,
  };
  return { fake, drive, db, router, deps };
}

export const rows = (db: MemoryDb, model: string) => db.tables[model] as Record<string, unknown>[];
