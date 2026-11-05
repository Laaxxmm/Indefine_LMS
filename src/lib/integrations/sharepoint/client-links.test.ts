import { describe, it, expect } from "vitest";
import { clientSiteLink, jobFolderLink } from "./client-links";
import { isClPathsEnabled } from "./flags";

describe("isClPathsEnabled", () => {
  it("is off by default and for anything but an explicit on value", () => {
    expect(isClPathsEnabled({})).toBe(false);
    for (const v of ["", "0", "false", "off", "no", "enabled", " "]) expect(isClPathsEnabled({ FIRM_OS_CL_PATHS: v })).toBe(false);
  });
  it("accepts 1/true/on/yes in any case", () => {
    for (const v of ["1", "true", "TRUE", " on ", "Yes"]) expect(isClPathsEnabled({ FIRM_OS_CL_PATHS: v })).toBe(true);
  });
  it("reads process.env by default", () => {
    expect(typeof isClPathsEnabled()).toBe("boolean");
  });
});

describe("clientSiteLink", () => {
  it("links to the CL site only when the flag is on and the code is valid", () => {
    expect(clientSiteLink({ clPaths: true, clientCode: "ACME01" })).toEqual({ label: "CL-ACME01", href: "https://srcaassociate.sharepoint.com/sites/CL-ACME01" });
    expect(clientSiteLink({ clPaths: true, clientCode: "ACME01", host: "t.sharepoint.com" })?.href).toBe("https://t.sharepoint.com/sites/CL-ACME01");
    expect(clientSiteLink({ clPaths: false, clientCode: "ACME01" })).toBeNull();
    expect(clientSiteLink({ clPaths: true, clientCode: null })).toBeNull();
    expect(clientSiteLink({ clPaths: true, clientCode: undefined })).toBeNull();
    expect(clientSiteLink({ clPaths: true, clientCode: "acme" })).toBeNull(); // bad code: fall back, never crash the page
  });
});

describe("jobFolderLink", () => {
  const base = { clPaths: true, clientCode: "ACME01", fy: "2026-27", department: "TAX" as const, serviceName: "GST monthly/quarterly returns" };
  it("resolves the service folder through paths.ts", () => {
    expect(jobFolderLink(base)).toEqual({ label: "FY2026-27/GST", href: "https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST" });
    expect(jobFolderLink({ ...base, department: "AUDIT", serviceName: "Tax Audit", fy: "2025-26" })?.href).toBe(
      "https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2025-26/Audit",
    );
  });
  it("returns null for legacy cases", () => {
    expect(jobFolderLink({ ...base, clPaths: false })).toBeNull();
    expect(jobFolderLink({ ...base, clientCode: null })).toBeNull();
    expect(jobFolderLink({ ...base, fy: "2026-28" })).toBeNull();
    expect(jobFolderLink({ ...base, department: "TECH", serviceName: "Tally setup" })).toBeNull();
  });
});
