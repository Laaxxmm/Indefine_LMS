// The /onboard client panel renders each screen of a real run: questions, plan preview,
// saga progress with the Turia checklist. Views come from the real service over fakes.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderHtml } from "./harness";

vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { DEFAULT_CALENDAR } = await import("@/lib/agents/core");
const { ManualBridge } = await import("@/lib/integrations/turia/manual-bridge");
const { createCalendarPlanner } = await import("@/lib/agents/onboarding/planner");
const { createSaga } = await import("@/lib/agents/onboarding/saga");
const { createOnboardingService } = await import("@/lib/agents/onboarding/service");
const { completeSpec, PEOPLE } = await import("@/lib/agents/onboarding/__fixtures__/synthetic");
const { FakeTuriaRepo } = await import("../../fakes/fake-turia-repo");
const { MemoryOnboardingStore } = await import("../../fakes/fake-onboarding-store");
const { OnboardPanel } = await import("@/app/onboard/OnboardPanel");

const NOW = new Date("2026-11-05T10:00:00Z");

function service(sp?: { ensureClientSite: () => Promise<never> }) {
  const store = new MemoryOnboardingStore(PEOPLE);
  const repo = new FakeTuriaRepo();
  const manual = new ManualBridge(repo, () => NOW);
  const spec = completeSpec();
  const sharepoint = sp ?? { ensureClientSite: async (c: string) => ({ siteUrl: `https://srcaassociate.sharepoint.com/sites/CL-${c}`, created: [] }), ensureFyTree: async () => ({ siteUrl: "s", folders: 1, created: [] }) };
  const svc = createOnboardingService({
    runs: store,
    router: { run: async () => ({ status: "ok", output: { legalName: spec.legalName, entityType: "PVT_LTD", services: spec.services, assigneeName: "Priya Sharma", reviewerName: "Ravi" }, needsPartnerReview: false, attempts: 1, provider: "claude", model: "m", confidence: 1, escalated: false, anonymized: true, tokensIn: 1, tokensOut: 1, costInr: 0 }) as never },
    people: async () => PEOPLE,
    ports: { findFirmClientByCode: async () => null, findLmsClient: async () => null, findActiveUser: async (id) => PEOPLE.find((p) => p.id === id) ?? null, turia: manual },
    planner: createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "Statutory calendar: defaults" }) }),
    saga: createSaga({ store, turia: manual, sharepoint: sharepoint as never, now: () => NOW }),
    turiaMode: "MANUAL",
    confirmRequired: true,
    manual,
    listTuriaSyncs: async (fc) => repo.rows.filter((r) => r.firmClientId === fc),
    getTuriaSync: (id) => repo.get(id),
    setTuriaClientRef: async () => {},
    audit: async () => {},
    now: () => NOW,
  });
  return { svc, spec };
}

const render = (initial: unknown) => renderHtml(createElement(OnboardPanel, { initial: initial as never }));

describe("OnboardPanel screens", () => {
  it("questions: at most five labelled fields, what was understood, one primary action", async () => {
    const { svc } = service();
    const v = await svc.start("Onboard Acme", "u");
    const html = await render(v);
    expect(html).toContain("Understood so far");
    expect(html).toContain("Priya Sharma");
    expect((html.match(/for="q-/g) ?? []).length).toBe(5); // clientCode, fy, pan, gstins, cin
    expect(html).toContain('for="q-clientCode"');
    expect((html.match(/>Continue</g) ?? []).length).toBe(1);
  });

  it("plan preview lists what will be created, dates as DD MMM YYYY, and a single Create", async () => {
    const { svc, spec } = service();
    const v0 = await svc.start("x", "u");
    await svc.answer(v0.id, { answers: { clientCode: spec.clientCode, pan: spec.pan, gstins: spec.gstins[0], cin: spec.cin!, fy: spec.fy, firstPeriod: spec.firstPeriod!, contactName: spec.contactName, contactEmail: spec.contactEmail, contactPhone: spec.contactPhone, turnoverInr: "2.5 Cr", billing: spec.billing, dscHolder: spec.dscHolder!, booksSoftware: "Tally" } });
    const v = await svc.plan(v0.id, "u");
    const html = await render(v);
    expect(html).toContain("What will be created");
    expect(html).toContain("https://srcaassociate.sharepoint.com/sites/CL-ACME01");
    expect(html).toContain("11 Dec 2026"); // GSTR-1 for Nov 2026
    expect(html).toMatch(/AGM/); // AOC-4 / MGT-7 / ADT-1 dates wait for the AGM date
    expect((html.match(/>Create</g) ?? []).length).toBe(1);
    // Create is irreversible: the consequence is spelled out next to it and tied to the button.
    expect(html).toContain("Create starts all of the above now");
    expect(html).toContain("nothing is deleted");
    expect(html).toContain('aria-describedby="create-consequence"');

    const done = await svc.create(v0.id, "u");
    const after = await render(done);
    expect(after).toContain("Onboarded");
    // The summary links go where each created thing lives, named after it.
    expect(after).toMatch(/href="\/clients\/[^"]+"[^>]*>[^<]*in Clients</);
    expect(after).toContain("CL-ACME01 SharePoint site");
    expect(after).toContain('href="/agents"');
    expect(after).toContain('rel="noopener noreferrer"');
    expect(after).toContain("Waiting on you");
    expect(after).toContain("Done in Turia");
    expect(after).toContain('aria-label="Copy PAN"');
    expect(after).toContain("Turia client ref");
    expect(after).not.toMatch(/submit to portal/i);
  });

  it("a blocked step shows the exact human action and a Retry", async () => {
    const { BlockedError } = await import("@/lib/integrations/sharepoint/errors");
    const { svc, spec } = service({ ensureClientSite: async () => { throw new BlockedError("Upload the PnP certificate"); } });
    const v0 = await svc.start("x", "u");
    await svc.answer(v0.id, { answers: { clientCode: spec.clientCode, pan: spec.pan, gstins: spec.gstins[0], cin: spec.cin!, fy: spec.fy, firstPeriod: spec.firstPeriod!, contactName: spec.contactName, contactEmail: spec.contactEmail, contactPhone: spec.contactPhone, turnoverInr: "2.5 Cr", billing: spec.billing, dscHolder: spec.dscHolder!, booksSoftware: "Tally" } });
    await svc.plan(v0.id, "u");
    const html = await render(await svc.create(v0.id, "u"));
    expect(html).toContain("Blocked");
    expect(html).toContain("Upload the PnP certificate");
    expect(html).toContain(">Retry<");
  });
});
