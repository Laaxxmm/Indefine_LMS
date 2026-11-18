// OnboardingRun.error and the failed step's `error` stored the thrown message as it was (up to 500
// characters): the duplicate check's "Client already exists: <name>", a Microsoft 365 failure with the
// site path and the response body, a database error, a validator quoting a value. They now follow the
// AgentRun.error rule (core/run-errors.ts): known errors are a fixed classification; anything else is
// masked with the run's dictionary, or withheld whole when the detector still finds client data. The
// onboarding page shows a plain sentence for each (onboardingFailureMessage). Synthetic values only.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verhoeffCheckDigit } from "@/lib/ai/anonymizer";
import { ClientExistsError, ClientNameError } from "@/lib/clients/service";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import { isPlainMessage, onboardingFailureMessage } from "@/lib/errors";
import { BlockedError, ConflictError, GraphError, NotProvisionedError, UnsafeUrlError } from "@/lib/integrations/sharepoint/errors";
import { PathError } from "@/lib/integrations/sharepoint/paths";
import { TuriaBlockedError } from "@/lib/integrations/turia/errors";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { FakeTuriaRepo } from "../../../../tests/fakes/fake-turia-repo";
import { MemoryOnboardingStore } from "../../../../tests/fakes/fake-onboarding-store";
import { PEOPLE, completeSpec } from "./__fixtures__/synthetic";
import { buildPlan } from "./plan";
import { createCalendarPlanner } from "./planner";
import { ONBOARDING_ERROR_WITHHELD, onboardingErrorDictionary, storedOnboardingError } from "./run-errors";
import { createSaga, initialSteps, normalizeSteps, type SagaSharePoint } from "./saga";

const NOW = new Date("2026-11-05T10:00:00Z");
const AADHAAR = "23456789012" + verhoeffCheckDigit("23456789012");
const PAN = "ABCDE1234F";
const FALLBACK = "This step failed. Use Resume to try it again; if it fails again, tell IT.";
const shown = (stored: string) => onboardingFailureMessage(stored, { subject: "the onboarding", fallback: FALLBACK });

async function world(sharepoint?: Partial<SagaSharePoint>) {
  const store = new MemoryOnboardingStore(PEOPLE);
  const manual = new ManualBridge(new FakeTuriaRepo(), () => NOW);
  const spec = completeSpec({ legalName: "Zorvan Mandravel Traders Private Limited", contactName: "Ilsha Ostrakar" });
  const jobs = await createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "defaults" }) }).planJobs({
    entityType: spec.entityType, services: spec.services, fy: spec.fy, firstPeriod: spec.firstPeriod, gstStateCode: "29", qrmp: false,
  });
  const plan = buildPlan(spec, {
    jobs, existingLmsClient: null, turiaMode: "MANUAL", checks: [], confirmRequired: true, plannerSource: "defaults",
    people: { assignee: { id: "u-priya", name: "Priya Sharma" }, reviewer: { id: "u-ravi", name: "Ravi Kumar" } }, now: NOW,
  });
  const run = await store.create({ createdById: "u-partner", prompt: "Onboard Zorvan", spec });
  await store.update(run.id, { plan, status: "CONFIRMED", steps: initialSteps() });
  const sp: SagaSharePoint = {
    ensureClientSite: async (code) => ({ siteUrl: `https://tenant.sharepoint.com/sites/CL-${code}`, created: [] }),
    ensureFyTree: async (code) => ({ siteUrl: `https://tenant.sharepoint.com/sites/CL-${code}`, folders: 1, created: [] }),
    ...sharepoint,
  };
  const saga = createSaga({ store, turia: manual, sharepoint: sp, now: () => NOW });
  return { store, saga, runId: run.id };
}

const SECRETS = ["Zorvan", "Mandravel", "Ilsha", "Ostrakar", PAN, AADHAAR, "Priya", "Sharma", "Q2-ledger.xlsx", "Sheet Kharif"];
function expectClean(text: string | null | undefined) {
  for (const s of SECRETS) expect(text ?? "", `"${s}" in ${text}`).not.toContain(s);
}

describe("OnboardingRun.error never stores client data from a thrown message", () => {
  it("PoC: the duplicate check names the existing client → stored as a fixed classification, the page shows a plain sentence", async () => {
    const w = await world();
    w.store.failOnce("createOrLinkClient", new ClientExistsError("c-1", "Zorvan Mandravel Traders Private Limited"));
    const run = await w.saga.execute(w.runId, "u-partner");
    expect(run.status).toBe("FAILED");
    expectClean(run.error);
    expect(run.error).toBe("LMS client record failed: LMS client: a client with the same name, folder name or PAN already exists");
    const step = normalizeSteps(run.steps).find((s) => s.key === "lmsClient")!;
    expectClean(step.error);
    expect(shown(step.error!)).toBe("A client with this name, folder name or PAN already exists. Search for it instead of adding it again.");
  });

  it("PoC: a Microsoft 365 failure with the file path and the response body → status and method only", async () => {
    const w = await world({
      ensureClientSite: async () => {
        throw new GraphError(404, "GET", "https://graph.microsoft.com/v1.0/sites/x/drive/root:/Zorvan Mandravel/Q2-ledger.xlsx", `{"error":"Sheet Kharif of Zorvan Mandravel, PAN ${PAN}"}`);
      },
    });
    const run = await w.saga.execute(w.runId, "u-partner");
    expectClean(run.error);
    const step = normalizeSteps(run.steps).find((s) => s.key === "sharepoint")!;
    expect(step.error).toBe("Microsoft 365: GET request failed: 404");
    expect(isPlainMessage(shown(step.error!))).toBe(true);
    expect(shown(step.error!)).toMatch(/no longer in SharePoint/);
  });

  it("anything else is masked with the run's dictionary (the client, the contact, the people) and identifiers", async () => {
    const w = await world({
      ensureClientSite: async () => {
        throw new Error(`Ilsha Ostrakar of Zorvan Mandravel Traders sent Aadhaar ${AADHAAR} and PAN ${PAN}; Priya Sharma to check`);
      },
    });
    const run = await w.saga.execute(w.runId, "u-partner");
    expectClean(run.error);
    const step = normalizeSteps(run.steps).find((s) => s.key === "sharepoint")!;
    expectClean(step.error);
    expect(step.error).toMatch(/⟨NAME_\d⟩ of ⟨ORG_\d⟩.* sent Aadhaar ⟨AADHAAR_1⟩ and PAN ⟨PAN_1⟩/);
    expect(run.error).toBe(`SharePoint site and FY folders failed: ${step.error}`);
  });

  it("a person who left: the stored error and the page name no one", async () => {
    const w = await world();
    w.store.people = w.store.people.filter((p) => p.id !== "u-priya");
    const run = await w.saga.execute(w.runId, "u-partner");
    const step = normalizeSteps(run.steps).find((s) => s.key === "assignment")!;
    expect(step.error).toBe("The assignee is no longer an active user. Pick someone else and build the plan again.");
    expectClean(run.error);
    expect(shown(step.error!)).toBe(step.error);
  });

  it("known classes store a fixed classification without names, paths or values; each shows a plain sentence", () => {
    const dict = onboardingErrorDictionary(completeSpec({ legalName: "Zorvan Mandravel Traders Private Limited", contactName: "Ilsha Ostrakar" }), null);
    const prisma = Object.assign(new Error(`Unique constraint failed on the fields: (\`pan\`) value ${PAN}`), { code: "P2002", name: "PrismaClientKnownRequestError" });
    const cases: [unknown, string, RegExp][] = [
      [new BlockedError("Grant consent for Zorvan"), "BLOCKED: waiting for the setup step recorded as the step's action", /Microsoft 365/],
      [new TuriaBlockedError("Ask Turia for Zorvan"), "BLOCKED (Turia): waiting for the setup step recorded as the step's action", /Microsoft 365/],
      [new GraphError(409, "PUT", "https://x/Zorvan/Q2-ledger.xlsx", "Zorvan"), "Microsoft 365: PUT request failed: 409", /already in the folder/],
      [new UnsafeUrlError("evil.example", "Zorvan's file"), "Microsoft 365: a request to an address outside the firm's tenant was refused", /^This step failed/],
      [new NotProvisionedError("CL-ZORVAN for Zorvan Mandravel does not exist yet"), "SharePoint: the client's site or library is not ready yet", /^This step failed/],
      [new ConflictError("/sites/CL-X/Zorvan/Q2-ledger.xlsx"), "SharePoint: a file already exists where one was to be created", /never overwrites/],
      [new PathError("Zorvan Mandravel/Q2-ledger.xlsx is outside the contract"), "SharePoint: a folder or file name was outside the folder contract", /^This step failed/],
      [new ClientNameError("Zorvan is reserved"), "LMS client: the client name cannot be used as a folder name", /^This step failed/],
      [prisma, "database: P2002", /already exists/],
      [Object.assign(new Error(`cannot reach db for ${PAN}`), { name: "PrismaClientInitializationError" }), "database: unavailable", /records could not be reached/],
      [Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }), "Turia: timed out", /Turia could not be reached/],
      [new Error(`fetch failed for Zorvan (ECONNREFUSED)`), "Turia: could not be reached", /Turia could not be reached/],
    ];
    for (const [err, expected, sentence] of cases) {
      const stored = storedOnboardingError(err, dict, "turia");
      expect(stored, String(err)).toBe(expected);
      expectClean(stored);
      expect(isPlainMessage(shown(stored)), shown(stored)).toBe(true);
      expect(shown(stored), stored).toMatch(sentence);
    }
    expect(storedOnboardingError(new Error("socket hang up"), dict, "sharepoint")).toBe("Microsoft 365: could not be reached");
    expect(shown("Microsoft 365: could not be reached")).toMatch(/Microsoft 365 .* could not be reached/);
    expect(storedOnboardingError(new Error("socket hang up"), dict, "jobs")).toBe("network: could not be reached");
    expect(shown("network: could not be reached")).toBe(FALLBACK);
    expect(storedOnboardingError(new Error("socket hang up"), dict)).toBe("network: could not be reached");
    expect(storedOnboardingError(Object.assign(new Error("aborted"), { name: "AbortError" }), dict)).toBe("A request: timed out");
    expect(storedOnboardingError(new GraphError(500, "", "x", "y"), dict)).toBe("Microsoft 365: A request failed: 500");
    expect(shown("Microsoft 365: timed out")).toMatch(/took too long/);
  });

  it("validation errors keep paths and codes only, never the value received", () => {
    const r = z.object({ entityType: z.enum(["PVT_LTD", "LLP"]) }).safeParse({ entityType: `Zorvan Mandravel ${PAN}` });
    expect(r.success).toBe(false);
    if (r.success) return;
    const stored = storedOnboardingError(r.error);
    expect(stored).toBe("Details not valid: entityType: must be one of PVT_LTD, LLP");
    expectClean(stored);
  });

  it("a thrown string and an empty message are masked too", () => {
    expect(storedOnboardingError(`PAN ${PAN} for the client`)).toBe("PAN ⟨PAN_1⟩ for the client");
    expect(storedOnboardingError(42)).toBe("42");
  });

  it("the withheld sentence is plain and the page shows it as it is", () => {
    expect(isPlainMessage(ONBOARDING_ERROR_WITHHELD)).toBe(true);
    expect(shown(ONBOARDING_ERROR_WITHHELD)).toBe(ONBOARDING_ERROR_WITHHELD);
    expect(ONBOARDING_ERROR_WITHHELD).not.toMatch(/⟨/);
  });

  it("the run dictionary holds the client's names, the contact and both people, and tolerates a partial spec", () => {
    const d = onboardingErrorDictionary(
      { legalName: "Zorvan Mandravel", entityType: "INDIVIDUAL", contactName: "Ilsha Ostrakar", assigneeName: "Priya Sharma" },
      { people: { assignee: { id: "a", name: "Priya Sharma" }, reviewer: { id: "r", name: "Ravi Kumar" } } },
    );
    const values = d.map((e) => e.value);
    for (const v of ["Zorvan Mandravel", "Zorvan", "Mandravel", "Ilsha Ostrakar", "Priya Sharma", "Ravi Kumar", "Kumar"]) expect(values).toContain(v);
    expect(onboardingErrorDictionary(null, null)).toEqual([]);
    expect(onboardingErrorDictionary({ legalName: 7, assigneeName: "Al" }, undefined)).toEqual([]);
  });
});
