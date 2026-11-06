// Every search provider applies the visibility rule of the entity's own page: staff never find an
// unassigned job, run, deliverable or draft; inactive people find nothing; drafts never expose a
// body; identifiers inside names are masked and cannot be matched by typing part of them.
import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { DRAFT_BODY, IDS, PEOPLE, searchWorld, type SearchWorld } from "../../../tests/fakes/search-world";
import type { ProviderContext, SearchProvider } from "./provider";
import { PROVIDERS } from "./providers";
import { clientsProvider } from "./providers/clients";
import { firmJobsProvider } from "./providers/firm-jobs";
import { runsProvider } from "./providers/runs";
import { deliverablesProvider } from "./providers/deliverables";
import { draftsProvider } from "./providers/drafts";
import { onboardingProvider } from "./providers/onboarding";
import { clientJobsProvider } from "./providers/client-jobs";
import { documentsProvider } from "./providers/documents";
import { queryTerms } from "./rank";
import { SEARCH_TYPES } from "./types";

let w: SearchWorld;
beforeEach(() => {
  w = searchWorld();
});

const ctx = (user: Session["user"], q: string, over: Partial<ProviderContext> = {}): ProviderContext => ({ db: w.db, user, q, terms: queryTerms(q), limit: 10, exactOnly: false, clPaths: false, ...over });
const find = async (p: SearchProvider, user: Session["user"], q: string, over: Partial<ProviderContext> = {}) => (await p.search(ctx(user, q, over))).hits;
const ids = async (p: SearchProvider, user: Session["user"], q: string) => (await find(p, user, q)).map((h) => h.id).sort();

describe("registry", () => {
  it("one provider per search type, in display order", () => {
    expect(PROVIDERS.map((p) => p.type)).toEqual([...SEARCH_TYPES]);
  });

  it("inactive people can use no provider", () => {
    for (const p of PROVIDERS) expect(p.canUse(PEOPLE.gone)).toBe(false);
    for (const p of PROVIDERS) expect(p.canUse(null)).toBe(false);
  });
});

describe("clients", () => {
  it("every active person finds clients by name, folder name or client code", async () => {
    for (const u of [PEOPLE.priya, PEOPLE.arun, PEOPLE.manager, PEOPLE.admin]) {
      expect(await ids(clientsProvider, u, "acme")).toEqual(["c-acme", "c-acmeold"]);
      expect(await ids(clientsProvider, u, "acme01")).toEqual(["c-acme"]);
    }
  });

  it("shows the code, entity and an inactive marker, and links to the client page", async () => {
    const [acme, old] = await find(clientsProvider, PEOPLE.priya, "acme");
    expect(acme.label).toBe("Acme Traders Private Limited");
    expect(acme.context).toBe("Client code ACME01 · Private limited · Chennai");
    expect(acme.href).toBe("/clients/c-acme");
    expect(old.context).toContain("No client code yet");
    expect(old.context).toContain("Inactive");
  });

  it("never matches PAN, GSTIN, phone or email by text", async () => {
    for (const q of [IDS.acmePan, "AAACA", IDS.acmePhone.slice(0, 6), "ravi.acct", IDS.acmeGstin.slice(0, 9)]) {
      expect(await ids(clientsProvider, PEOPLE.admin, q)).toEqual([]);
    }
  });

  it("exact-only mode matches the client code alone", async () => {
    expect((await find(clientsProvider, PEOPLE.priya, "ACME01", { exactOnly: true })).map((h) => h.id)).toEqual(["c-acme"]);
    expect(await find(clientsProvider, PEOPLE.priya, "ACME", { exactOnly: true })).toEqual([]);
  });
});

describe("Firm OS jobs", () => {
  it("staff find only jobs they prepare or review", async () => {
    expect(await ids(firmJobsProvider, PEOPLE.priya, "acme")).toEqual(["job-acme-gst"]);
    expect(await ids(firmJobsProvider, PEOPLE.ravi, "acme")).toEqual(["job-acme-gst"]);
    expect(await ids(firmJobsProvider, PEOPLE.arun, "acme")).toEqual(["job-acme-roc"]);
    // the unassigned job is invisible even by its exact id
    expect(await ids(firmJobsProvider, PEOPLE.priya, "job-acme-roc")).toEqual([]);
  });

  it("managers, partners and admins find all", async () => {
    for (const u of [PEOPLE.manager, PEOPLE.partner, PEOPLE.admin]) expect(await ids(firmJobsProvider, u, "acme")).toEqual(["job-acme-gst", "job-acme-roc"]);
  });

  it("inactive people find nothing even by id", async () => {
    expect(await ids(firmJobsProvider, PEOPLE.gone, "job-acme-gst")).toEqual([]);
  });

  it("matches title, service, period, FY, ack number and several words", async () => {
    expect(await ids(firmJobsProvider, PEOPLE.manager, "gstr")).toEqual(["job-acme-gst"]);
    expect(await ids(firmJobsProvider, PEOPLE.manager, "tds")).toEqual(["job-bsw-tds"]);
    expect(await ids(firmJobsProvider, PEOPLE.manager, "2026-10")).toEqual(["job-acme-gst"]);
    expect(await ids(firmJobsProvider, PEOPLE.manager, "ACK26Q0042")).toEqual(["job-bsw-tds"]);
    expect(await ids(firmJobsProvider, PEOPLE.manager, "acme gstr")).toEqual(["job-acme-gst"]);
  });

  it("opens the latest run, or the client page when no agent has run", async () => {
    const [gst] = await find(firmJobsProvider, PEOPLE.manager, "gstr");
    expect(gst.href).toBe("/agents/gst/runs/run-gst-2");
    expect(gst.label).toBe("GSTR-3B — Acme Traders Private Limited");
    expect(gst.context).toBe("ACME01 · GST · 2026-10 · FY 2026-27 · In review · internal due 17 Nov 2026");
    const [tds] = await find(firmJobsProvider, PEOPLE.manager, "tds");
    expect(tds.href).toBe("/clients/c-bharat");
    const [tdsCl] = await find(firmJobsProvider, PEOPLE.manager, "tds", { clPaths: true });
    expect(tdsCl.href).toBe("/clients/c-bharat#firm-os-jobs");
  });
});

describe("agent runs", () => {
  it("staff find runs of their jobs only; managers all", async () => {
    expect(await ids(runsProvider, PEOPLE.priya, "acme")).toEqual(["run-gst-1", "run-gst-2"]);
    expect(await ids(runsProvider, PEOPLE.arun, "acme")).toEqual(["run-roc-1"]);
    expect(await ids(runsProvider, PEOPLE.priya, "run-roc-1")).toEqual([]);
    expect(await ids(runsProvider, PEOPLE.partner, "acme")).toEqual(["run-gst-1", "run-gst-2", "run-roc-1"]);
    expect(await ids(runsProvider, PEOPLE.gone, "run-gst-1")).toEqual([]);
  });

  it("matches the agent key and links to the run review page", async () => {
    expect(await ids(runsProvider, PEOPLE.manager, "roc")).toEqual(["run-roc-1"]);
    const [run] = await find(runsProvider, PEOPLE.manager, "run-gst-2");
    expect(run.rank).toBe(0);
    expect(run.href).toBe("/agents/gst/runs/run-gst-2");
    expect(run.context).toBe("GST agent · attempt 2 · Pack ready · ACME01 · 2026-10 · started 04 Nov 2026");
  });
});

describe("deliverables", () => {
  it("are visible when their job is", async () => {
    expect(await ids(deliverablesProvider, PEOPLE.priya, "xlsx")).toEqual(["del-gst", "del-tds"]);
    expect(await ids(deliverablesProvider, PEOPLE.arun, "acme01")).toEqual(["del-roc"]);
    expect(await ids(deliverablesProvider, PEOPLE.priya, "AOC-4")).toEqual([]);
    expect(await ids(deliverablesProvider, PEOPLE.admin, "compliance")).toEqual(["del-gst", "del-roc", "del-tds"]);
    expect(await ids(deliverablesProvider, PEOPLE.gone, "xlsx")).toEqual([]);
  });

  it("matches the SharePoint path and links to the run that made the file, else the job's latest run", async () => {
    const [gst] = await find(deliverablesProvider, PEOPLE.manager, "GST/2026-10");
    expect(gst.id).toBe("del-gst");
    expect(gst.href).toBe("/agents/gst/runs/run-gst-2");
    expect(gst.context).toContain("Working file · version 2 · GSTR-3B for ACME01");
    const [roc] = await find(deliverablesProvider, PEOPLE.manager, "AOC-4 ACME01");
    expect(roc.href).toBe("/agents/roc/runs/run-roc-1");
  });

  it("masks a PAN inside a file name, and typing part of that PAN finds nothing", async () => {
    const [tds] = await find(deliverablesProvider, PEOPLE.priya, "TDS workings");
    expect(tds.label).toBe("XXXXXX678K TDS workings.xlsx");
    expect(JSON.stringify(tds)).not.toContain(IDS.bharatPan);
    expect(await ids(deliverablesProvider, PEOPLE.priya, "AAFFB")).toEqual([]);
    expect(await ids(deliverablesProvider, PEOPLE.priya, "AAFFB5678")).toEqual([]);
  });
});

describe("comms drafts", () => {
  it("the draft page's rule: author, the job's assignee or reviewer, and managers see a job draft; nobody else", async () => {
    expect(await ids(draftsProvider, PEOPLE.priya, "acme")).toEqual(["draft-chase"]); // assignee of job-acme-gst
    expect(await ids(draftsProvider, PEOPLE.arun, "acme")).toEqual(["draft-roc"]); // assignee of job-acme-roc
    expect(await ids(draftsProvider, PEOPLE.arun, "bharat")).toEqual(["draft-bsw"]); // creator (and primary handler)
    expect(await ids(draftsProvider, PEOPLE.ravi, "acme")).toEqual(["draft-chase"]); // reviewer of job-acme-gst, as on the draft page
    expect(await ids(draftsProvider, PEOPLE.manager, "acme")).toEqual(["draft-chase", "draft-roc"]);
    expect(await ids(draftsProvider, PEOPLE.admin, "draft-bsw")).toEqual(["draft-bsw"]);
    expect(await ids(draftsProvider, PEOPLE.gone, "acme")).toEqual([]);
  });

  it("a job-less (client-level) draft: its author, the client's primary handler and managers; not people on another job of the client", async () => {
    w.seed("commsDraft", [
      { id: "draft-acme-client", firmClientId: "fc-acme", jobTaskId: null, kind: "status", language: "en", subject: "Year-end status for Acme", body: DRAFT_BODY, createdById: "u-manager", outlookDraftId: null, createdAt: new Date("2026-11-04T06:30:00Z") },
    ]);
    const { canViewCommsDraft } = await import("@/lib/rbac/policy");
    const draft = { createdById: "u-manager", job: null, client: { primaryHandlerId: "u-priya" } }; // c-acme's primary handler
    for (const [who, person] of Object.entries(PEOPLE)) {
      const found = (await ids(draftsProvider, person, "year-end")).includes("draft-acme-client");
      expect(found, who).toBe(canViewCommsDraft(person, draft));
    }
    expect(await ids(draftsProvider, PEOPLE.priya, "year-end")).toEqual(["draft-acme-client"]); // primary handler of Acme
    expect(await ids(draftsProvider, PEOPLE.arun, "year-end")).toEqual([]); // assignee of another Acme job: no
    expect(await ids(draftsProvider, PEOPLE.ravi, "year-end")).toEqual([]);
  });

  it("matches the subject, the client code and the kind; shows the subject only", async () => {
    expect(await ids(draftsProvider, PEOPLE.manager, "october")).toEqual(["draft-chase"]);
    expect(await ids(draftsProvider, PEOPLE.manager, "reminder")).toEqual(["draft-roc"]);
    const [chase] = await find(draftsProvider, PEOPLE.manager, "october");
    expect(chase.label).toBe("Documents needed for October GSTR-3B");
    expect(chase.context).toBe("Document request · English · ACME01 · drafted 03 Nov 2026 · Saved to Outlook drafts");
    expect(chase.href).toBe("/comms/draft-chase"); // the draft's own page
  });

  it("never reads, searches or returns the body", async () => {
    const hits = await find(draftsProvider, PEOPLE.manager, "acme");
    expect(JSON.stringify(hits)).not.toContain("SECRET-BODY-TEXT");
    expect(JSON.stringify(hits)).not.toContain(DRAFT_BODY.slice(0, 20));
    expect(await ids(draftsProvider, PEOPLE.manager, "purchase register")).toEqual([]);
    const draftCalls = w.calls.filter((c) => c.model === "commsDraft");
    expect(draftCalls.length).toBeGreaterThan(0);
    for (const c of draftCalls) {
      expect(c.args?.select).toBeDefined();
      expect(JSON.stringify(c.args)).not.toMatch(/"body"/);
    }
  });
});

describe("onboarding runs", () => {
  it("only people who may open /onboard find them", async () => {
    expect(onboardingProvider.canUse(PEOPLE.priya)).toBe(false);
    expect(onboardingProvider.canUse(PEOPLE.manager)).toBe(true);
    expect(onboardingProvider.canUse(PEOPLE.partner)).toBe(true);
    expect(onboardingProvider.canUse(PEOPLE.admin)).toBe(true);
  });

  it("match the legal name or client code in the spec; never the prompt", async () => {
    expect(await ids(onboardingProvider, PEOPLE.manager, "zenith")).toEqual(["ob-zen"]);
    expect(await ids(onboardingProvider, PEOPLE.manager, "ZEN01")).toEqual(["ob-zen"]);
    expect(await ids(onboardingProvider, PEOPLE.manager, "kavya")).toEqual([]);
    const [zen] = await find(onboardingProvider, PEOPLE.manager, "zenith");
    expect(zen.href).toBe("/onboard?run=ob-zen");
    expect(zen.context).toBe("Onboarded · client code ZEN01 · started 25 Oct 2026");
    expect(JSON.stringify(zen)).not.toContain(IDS.zenPan);
  });
});

describe("client jobs and documents", () => {
  it("every active person finds them; the link is the client page; no file URL is returned", async () => {
    expect(await ids(clientJobsProvider, PEOPLE.arun, "itr")).toEqual(["lj-acme-itr"]);
    expect(await ids(clientJobsProvider, PEOPLE.arun, "2025-26")).toEqual(["lj-bsw-audit"]);
    const [itr] = await find(clientJobsProvider, PEOPLE.arun, "itr");
    expect(itr).toMatchObject({ label: "ITR filing · FY 2026-27", href: "/clients/c-acme" });
    expect(itr.context).toBe("Acme Traders Private Limited · ACME01 · In progress · due 31 Dec 2026");
    expect(JSON.stringify(itr)).not.toContain(IDS.acmePan); // notes are not read

    const docs = await find(documentsProvider, PEOPLE.arun, "statement");
    expect(docs.map((d) => d.id)).toEqual(["doc-acme-bank"]);
    expect(docs[0].href).toBe("/clients/c-acme");
    expect(JSON.stringify(docs)).not.toContain("sharepoint.example");
    expect(await ids(documentsProvider, PEOPLE.arun, "trial balance")).toEqual(["doc-bsw-tb"]);
    expect(await ids(clientJobsProvider, PEOPLE.gone, "itr")).toEqual([]);
  });

  it("a KYC file named after a PAN is found by its type, shown masked, never by the PAN's letters", async () => {
    const [pan] = await find(documentsProvider, PEOPLE.priya, "pan");
    expect(pan.id).toBe("doc-acme-pan");
    expect(pan.label).toBe("XXXXXX234F.pdf");
    expect(pan.context).toBe("PAN · Acme Traders Private Limited · Client KYC · uploaded 01 Oct 2026");
    expect(await ids(documentsProvider, PEOPLE.priya, "AAACA")).toEqual([]);
  });
});

describe("links", () => {
  it("every hit links to a page pattern that exists", async () => {
    const PAGES = [/^\/clients\/[^/#?]+(#firm-os-jobs)?$/, /^\/agents\/[^/]+\/runs\/[^/]+$/, /^\/onboard\?run=[^&]+$/, /^\/comms\/[^/#?]+$/];
    for (const p of PROVIDERS) {
      for (const q of ["acme", "zenith", "bharat", "xlsx", "pan"]) {
        for (const h of await find(p, PEOPLE.admin, q)) expect(PAGES.some((re) => re.test(h.href)), `${p.type} ${h.href}`).toBe(true);
      }
    }
  });
});
