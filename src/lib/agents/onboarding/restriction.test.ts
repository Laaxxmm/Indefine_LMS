// Onboarding's DPDP restriction lookup: which identifiers a sentence / spec names, and whether any
// of them is an existing LMS client whose AI processing is restricted (or lifted again).
import { describe, expect, it } from "vitest";
import { isOnboardingAiRestricted, subjectIdentifiers, type OnboardingRestrictionDb } from "./restriction";
import { errorResponse } from "./http";
import { ONBOARDING_AI_RESTRICTED, OnboardingError } from "./service";

type Ev = { action: string; entity: string; entityId: string; meta: unknown; createdAt: Date };

function db(events: Ev[]): OnboardingRestrictionDb & { asked: string[] } {
  const asked: string[] = [];
  const clients = [
    { id: "c-meena", pan: "ABCPM1234Q", gstin: "29ABCPM1234Q1Z5" },
    { id: "c-acme", pan: "AAACA1234B", gstin: null },
  ];
  const firmClients = [{ id: "fc-meena", lmsClientId: "c-meena", clientCode: "MEENA1" }];
  return {
    asked,
    auditEvent: {
      findMany: async ({ where }) => events.filter((e) => e.action === where.action && e.entity === where.entity && e.entityId === where.entityId) as never,
    },
    firmClient: {
      findMany: async ({ where }) => {
        asked.push("firmClient");
        return firmClients.filter((f) => where.OR.some((o) => ("id" in o ? o.id.in.includes(f.id) : o.clientCode.in.includes(f.clientCode)))).map((f) => ({ lmsClientId: f.lmsClientId }));
      },
    },
    client: {
      findMany: async ({ where }) => {
        asked.push("client");
        return clients.filter((c) => where.OR.some((o) => ("pan" in o ? o.pan.in.includes(c.pan) : !!c.gstin && o.gstin.in.includes(c.gstin)))).map((c) => ({ id: c.id }));
      },
    },
  };
}

const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 6, m));
const restrict = (entityId: string, m = 0): Ev => ({ action: "restrict-processing", entity: "Client", entityId, meta: { restrictions: ["ai-processing", "comms-drafts", "marketing"], privacyRequestId: "pr-1" }, createdAt: at(m) });
const lift = (entityId: string, m = 5): Ev => ({ action: "lift-restriction", entity: "Client", entityId, meta: { restrictions: ["ai-processing", "comms-drafts", "marketing"], privacyRequestId: "pr-1", reason: "Written consent received" }, createdAt: at(m) });

describe("subjectIdentifiers", () => {
  it("reads exact PANs and GSTINs (and the PAN inside a GSTIN) from the sentence, plus the spec's PAN, GSTINs and client code", () => {
    expect(subjectIdentifiers({ text: "Onboard Meena Stores, pan abcpm1234q, GSTIN 29ABCPM1234Q1Z5; not ABCPM1234 or XABCPM1234QX" })).toEqual({
      firmClientIds: [],
      pans: ["ABCPM1234Q"],
      gstins: ["29ABCPM1234Q1Z5"],
      clientCodes: [],
    });
    expect(subjectIdentifiers({ firmClientId: "fc-1", spec: { pan: " aaaca1234b ", gstins: ["bad", "33AAACA1234B1Z5"], clientCode: "acme01" } })).toEqual({
      firmClientIds: ["fc-1"],
      pans: ["AAACA1234B"],
      gstins: ["33AAACA1234B1Z5"],
      clientCodes: ["ACME01"],
    });
    expect(subjectIdentifiers({})).toEqual({ firmClientIds: [], pans: [], gstins: [], clientCodes: [] });
  });
});

describe("isOnboardingAiRestricted", () => {
  it("finds the client by PAN, GSTIN, client code or the run's Firm OS client; a lifted restriction no longer applies", async () => {
    const d = db([restrict("c-meena")]);
    expect(await isOnboardingAiRestricted(d, { text: "PAN ABCPM1234Q" })).toBe(true);
    expect(await isOnboardingAiRestricted(d, { text: "GSTIN 29ABCPM1234Q1Z5" })).toBe(true);
    expect(await isOnboardingAiRestricted(d, { spec: { clientCode: "MEENA1" } })).toBe(true);
    expect(await isOnboardingAiRestricted(d, { firmClientId: "fc-meena" })).toBe(true);
    expect(await isOnboardingAiRestricted(d, { text: "PAN AAACA1234B" })).toBe(false); // another client, not restricted
    expect(await isOnboardingAiRestricted(db([restrict("c-meena"), lift("c-meena")]), { text: "PAN ABCPM1234Q" })).toBe(false);
  });

  it("the /onboard routes answer a refused extraction with 409 and the plain sentence", async () => {
    const r = errorResponse(new OnboardingError("restricted", ONBOARDING_AI_RESTRICTED));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "This client has restricted AI processing. Prepare this by hand or ask a partner to lift the restriction." });
  });

  it("a sentence with no identifier asks the database nothing", async () => {
    const d = db([restrict("c-meena")]);
    expect(await isOnboardingAiRestricted(d, { text: "Onboard a new proprietorship, GST monthly" })).toBe(false);
    expect(d.asked).toEqual([]);
  });
});
