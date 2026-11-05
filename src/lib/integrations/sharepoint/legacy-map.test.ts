import { describe, it, expect } from "vitest";
import type { ClientDocType, Department } from "@prisma/client";
import {
  isAnnualService, legacyDocKind, legacyJobPath, legacyServiceToCl, mapLegacyClient, mapLegacyFolders, mappingToCsv, mappingToMarkdown,
  type LegacyClient,
} from "./legacy-map";
import { SEED_SERVICES } from "@/lib/clients/core";

describe("legacyServiceToCl", () => {
  it.each<[Department, string, string | null]>([
    ["TAX", "GST monthly/quarterly returns", "GST"],
    ["TAX", "GST registration", "GST"],
    ["TAX", "GST annual return", "GST"],
    ["TAX", "TDS returns", "TDS"],
    ["TAX", "ITR filing", "IncomeTax"],
    ["TAX", "Advance tax", "IncomeTax"],
    ["TAX", "Scrutiny/Notice reply", "IncomeTax"],
    ["TAX", "Appeals", "IncomeTax"],
    ["TAX", "Ingestion", "IncomeTax"], // "gst" inside a word does not count
    ["AUDIT", "Tax Audit", "Audit"],
    ["AUDIT", "GST Audit", "Audit"],
    ["ACCOUNTS", "Payroll", "Books"],
    ["ROC", "Annual filing (AOC-4/MGT-7)", "ROC"],
    ["TECH", "Tally setup", null],
    ["ADMIN", "Registrations (MSME, IEC, PF/ESI, Shop Act)", null],
    ["GENERAL", "Anything", null],
  ])("%s / %s → %s", (dept, name, want) => {
    expect(legacyServiceToCl(dept, name)).toBe(want);
  });

  it("maps every seeded audit/tax/accounts/ROC service", () => {
    for (const [dept, names] of SEED_SERVICES) {
      for (const n of names) {
        const got = legacyServiceToCl(dept, n);
        if (dept === "TECH" || dept === "ADMIN") expect(got).toBeNull();
        else expect(got).not.toBeNull();
      }
    }
  });
});

describe("legacyDocKind / isAnnualService", () => {
  it.each<[ClientDocType, string]>([
    ["PAN", "ClientDocs"],
    ["BANK", "ClientDocs"],
    ["SOURCE_DATA", "ClientDocs"],
    ["FILED_RETURN", "Final"],
    ["ACKNOWLEDGEMENT", "Final"],
    ["SIGN_OFF", "Final"],
    ["WORKING_PAPERS", "Working"],
    ["OTHER_JOB", "Working"],
  ])("%s → %s", (t, k) => {
    expect(legacyDocKind(t)).toBe(k);
  });

  it("annual vs periodic services", () => {
    expect(["Audit", "ROC", "IncomeTax", "Engagement"].every((s) => isAnnualService(s as never))).toBe(true);
    expect(["GST", "TDS", "Books"].some((s) => isAnnualService(s as never))).toBe(false);
  });
});

const client = (over: Partial<LegacyClient> = {}): LegacyClient => ({
  clientId: "c1",
  clientName: "Acme Pvt Ltd",
  folderName: "Acme Pvt Ltd",
  clientCode: "ACME01",
  onboardedOn: new Date("2026-03-31T20:00:00Z"), // 1 Apr 2026 IST → FY2026-27
  legacyFolderExists: true,
  jobs: [
    { jobId: "j1", fy: "2026-27", department: "TAX", serviceName: "GST monthly/quarterly returns" },
    { jobId: "j2", fy: "2025-26", department: "AUDIT", serviceName: "Statutory Audit" },
    { jobId: "j3", fy: "2026-27", department: "ADMIN", serviceName: "Registrations (MSME, IEC, PF/ESI, Shop Act)" },
    { jobId: "j4", fy: "26-27", department: "ROC", serviceName: "LLP filing" },
  ],
  ...over,
});

describe("legacyJobPath", () => {
  it("matches the storage.ts layout including name sanitising", () => {
    expect(legacyJobPath("Clients", "Acme", { fy: "2026-27", department: "ADMIN", serviceName: "PF/ESI" })).toBe("Clients/Acme/2026-27/Admin - Ops/PF-ESI");
  });
});

describe("mapLegacyClient", () => {
  it("maps KYC, periodic and annual jobs; flags unmapped and invalid FY", () => {
    const rows = mapLegacyClient(client(), { legacyRoot: "Clients" });
    expect(rows.map((r) => [r.legacyPath, r.target, r.status])).toEqual([
      ["Clients/Acme Pvt Ltd/KYC", "CL-ACME01/Compliance/FY2026-27/Engagement/Annual/ClientDocs", "MAPPED"],
      ["Clients/Acme Pvt Ltd/2026-27/Tax/GST monthly-quarterly returns", "CL-ACME01/Compliance/FY2026-27/GST/{Period}/{Working|Final|ClientDocs}", "MAPPED"],
      ["Clients/Acme Pvt Ltd/2025-26/Audit/Statutory Audit", "CL-ACME01/Compliance/FY2025-26/Audit/Annual/{Working|Final|ClientDocs}", "MAPPED"],
      ["Clients/Acme Pvt Ltd/2026-27/Admin - Ops/Registrations (MSME, IEC, PF-ESI, Shop Act)", "", "UNMAPPED"],
      ["Clients/Acme Pvt Ltd/26-27/ROC/LLP filing", "", "INVALID_FY"],
    ]);
    expect(rows[0].targetUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/Engagement/Annual/ClientDocs");
    expect(rows[1].targetUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST");
    expect(rows[2].targetUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2025-26/Audit/Annual");
    expect(rows.every((r) => r.client === "Acme Pvt Ltd" && r.clientCode === "ACME01")).toBe(true);
    expect(rows[0].note).toBe("KYC → onboarding FY Engagement");
  });

  it("onboarding on 31 Mar IST puts KYC in the previous FY", () => {
    const rows = mapLegacyClient(client({ onboardedOn: new Date("2026-03-31T18:29:59Z"), jobs: [] }), { legacyRoot: "Clients", host: "x.sharepoint.com" });
    expect(rows[0].target).toBe("CL-ACME01/Compliance/FY2025-26/Engagement/Annual/ClientDocs");
    expect(rows[0].targetUrl.startsWith("https://x.sharepoint.com/")).toBe(true);
  });

  it("clients without a valid code stay legacy", () => {
    expect(mapLegacyClient(client({ clientCode: null }), { legacyRoot: "Clients" })).toEqual([
      { client: "Acme Pvt Ltd", clientCode: "", legacyPath: "Clients/Acme Pvt Ltd", target: "", targetUrl: "", status: "NO_CODE", note: "set FirmClient.clientCode to map this client" },
    ]);
    const bad = mapLegacyClient(client({ clientCode: "acme", legacyFolderExists: false }), { legacyRoot: "Clients" });
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ status: "INVALID_CODE", clientCode: "acme" });
    expect(bad[0].note).toBe('"acme" breaks the code rule (A–Z0–9, 3–10); legacy folder not found on SharePoint');
  });

  it("notes a missing legacy folder", () => {
    const rows = mapLegacyClient(client({ legacyFolderExists: false, jobs: [] }), { legacyRoot: "Clients" });
    expect(rows[0].note).toBe("KYC → onboarding FY Engagement; legacy folder not found on SharePoint");
    expect(mapLegacyClient(client({ legacyFolderExists: null, jobs: [] }), { legacyRoot: "Clients" })[0].note).toBe("KYC → onboarding FY Engagement");
  });
});

describe("report formats", () => {
  const rows = mapLegacyFolders([client(), client({ clientName: 'Beta, "B" | Co', clientCode: null })], { legacyRoot: "Clients" });

  it("markdown has a DRY RUN banner, counts and escaped cells", () => {
    const md = mappingToMarkdown(rows, { generatedAt: "Thu, 05 Nov 2026" });
    expect(md.split("\n")[0]).toBe("## Legacy → Path A mapping (DRY RUN — nothing was moved) — Thu, 05 Nov 2026");
    expect(md).toContain("MAPPED 3 · NO_CODE 1 · INVALID_CODE 0 · UNMAPPED 1 · INVALID_FY 1");
    expect(md).toContain("| Client | Code | Legacy path | Proposed Path A target | Status | Note |");
    expect(md).toContain('Beta, "B" \\| Co');
    expect(md).toContain("{Working\\|Final\\|ClientDocs}");
  });

  it("CSV quotes commas and quotes", () => {
    const csv = mappingToCsv(rows);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("client,clientCode,legacyPath,target,targetUrl,status,note");
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines.at(-1)).toMatch(/^"Beta, ""B"" \| Co",,Clients\/Acme Pvt Ltd,,,NO_CODE,/);
  });
});
