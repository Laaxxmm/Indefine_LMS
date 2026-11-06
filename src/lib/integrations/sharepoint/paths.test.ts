import { describe, it, expect } from "vitest";
import {
  CL_SITE_PREFIX, DEFAULT_TENANT_HOST, KINDS, PathError, QUARTERS, SERVICES,
  clSiteName, clSitePath, clSiteUrl, defaultPeriods, deliverablePath, fyLabel, fyStartYear, hubSiteUrl,
  isDeliverableKind, isServiceFolder, isValidClientCode, isValidPeriod, normalizeFy, parsePeriod, periodFor,
  periodInFy, periodLabel, servicePath, validateClientCode, validateKind, validateService,
  type Frequency, type PeriodInput, type ServiceFolder, type DeliverableKind,
} from "./paths";

describe("client code", () => {
  it.each(["ACM", "ACME", "ACME01", "SRCA2026", "ABCDEFGHIJ", "123", "A1B2C3"])("accepts %s", (code) => {
    expect(isValidClientCode(code)).toBe(true);
    expect(validateClientCode(code)).toBe(code);
  });

  it.each([
    ["acme", /uppercase/],
    ["Acme01", /uppercase/],
    ["AC", /3–10/],
    ["", /3–10/],
    ["ABCDEFGHIJK", /3–10/],
    ["ACME-01", /A–Z and 0–9/],
    ["AC ME", /A–Z and 0–9/],
    ["ACME_1", /A–Z and 0–9/],
    ["ACMÉ", /A–Z and 0–9/],
    ["AC/ME", /A–Z and 0–9/],
  ])("rejects %j", (code, msg) => {
    expect(isValidClientCode(code)).toBe(false);
    expect(() => validateClientCode(code)).toThrow(PathError);
    expect(() => validateClientCode(code)).toThrow(msg);
  });

  it("rejects non-strings", () => {
    expect(isValidClientCode(123)).toBe(false);
    expect(isValidClientCode(null)).toBe(false);
    expect(() => validateClientCode(undefined)).toThrow(/must be a string/);
  });

  it("PathError carries its name", () => {
    try {
      validateClientCode("x");
    } catch (e) {
      expect((e as Error).name).toBe("PathError");
    }
  });
});

describe("fyLabel (IST boundary)", () => {
  it("31 Mar 23:59:59 IST is the previous FY", () => {
    expect(fyLabel(new Date("2026-03-31T23:59:59+05:30"))).toBe("FY2025-26");
    expect(fyLabel(new Date("2026-03-31T18:29:59.999Z"))).toBe("FY2025-26");
  });

  it("1 Apr 00:00 IST starts the new FY", () => {
    expect(fyLabel(new Date("2026-04-01T00:00:00+05:30"))).toBe("FY2026-27");
  });

  it("a UTC instant that is still 31 Mar in UTC but already 1 Apr in IST is the new FY", () => {
    const d = new Date("2026-03-31T20:00:00Z"); // 1 Apr 01:30 IST
    expect(d.getUTCDate()).toBe(31);
    expect(fyLabel(d)).toBe("FY2026-27");
  });

  it("1 Apr in UTC late evening is still the new FY; 31 Mar 18:30Z exactly is the new FY", () => {
    expect(fyLabel(new Date("2026-03-31T18:30:00Z"))).toBe("FY2026-27");
    expect(fyLabel(new Date("2026-04-01T23:00:00Z"))).toBe("FY2026-27");
  });

  it("handles century rollover and mid-year dates", () => {
    expect(fyLabel(new Date("2099-06-01T00:00:00Z"))).toBe("FY2099-00");
    expect(fyLabel(new Date("2026-11-05T10:00:00+05:30"))).toBe("FY2026-27");
    expect(fyLabel(new Date("2027-01-15T10:00:00+05:30"))).toBe("FY2026-27");
  });

  it("rejects invalid dates", () => {
    expect(() => fyLabel(new Date("nope"))).toThrow(PathError);
    expect(() => fyLabel("2026-27" as unknown as Date)).toThrow(PathError);
  });
});

describe("normalizeFy / fyStartYear", () => {
  it("accepts bare, prefixed and Date forms", () => {
    expect(normalizeFy("2026-27")).toBe("FY2026-27");
    expect(normalizeFy("FY2026-27")).toBe("FY2026-27");
    expect(normalizeFy(new Date("2026-04-01T00:00:00+05:30"))).toBe("FY2026-27");
    expect(fyStartYear("FY2026-27")).toBe(2026);
    expect(fyStartYear("2099-00")).toBe(2099);
  });

  it.each(["2026-28", "FY26-27", "fy2026-27", "FY 2026-27", "2026", ""])("rejects %j", (fy) => {
    expect(() => normalizeFy(fy)).toThrow(PathError);
  });
});

describe("periodLabel", () => {
  it("formats monthly, quarterly and annual", () => {
    expect(periodLabel({ frequency: "monthly", year: 2026, month: 10 })).toBe("2026-10");
    expect(periodLabel({ frequency: "monthly", year: 2027, month: 1 })).toBe("2027-01");
    expect(periodLabel({ frequency: "quarterly", quarter: 2 })).toBe("Q2");
    expect(periodLabel({ frequency: "quarterly", quarter: 4 })).toBe("Q4");
    expect(periodLabel({ frequency: "annual" })).toBe("Annual");
  });

  it.each<[PeriodInput, RegExp]>([
    [{ frequency: "monthly", year: 2026, month: 0 }, /Month/],
    [{ frequency: "monthly", year: 2026, month: 13 }, /Month/],
    [{ frequency: "monthly", year: 2026, month: 1.5 }, /Month/],
    [{ frequency: "monthly", year: 26, month: 4 }, /Year/],
    [{ frequency: "monthly", year: 20260, month: 4 }, /Year/],
    [{ frequency: "monthly", year: Number.NaN, month: 4 }, /Year/],
    [{ frequency: "quarterly", quarter: 0 }, /Quarter/],
    [{ frequency: "quarterly", quarter: 5 }, /Quarter/],
    [{ frequency: "quarterly", quarter: 2.5 }, /Quarter/],
  ])("rejects %j", (input, msg) => {
    expect(() => periodLabel(input)).toThrow(msg);
  });

  it("rejects unknown frequency", () => {
    expect(() => periodLabel({ frequency: "weekly" } as unknown as PeriodInput)).toThrow(/isn't one Firm OS knows/);
  });
});

describe("periodFor (IST)", () => {
  it("monthly uses the IST month", () => {
    expect(periodFor("monthly", new Date("2026-10-31T19:00:00Z"))).toBe("2026-11"); // 1 Nov 00:30 IST
    expect(periodFor("monthly", new Date("2026-10-15T10:00:00Z"))).toBe("2026-10");
  });

  it.each([
    ["2026-04-01T00:00:00+05:30", "Q1"],
    ["2026-06-30T23:59:00+05:30", "Q1"],
    ["2026-07-01T00:00:00+05:30", "Q2"],
    ["2026-09-30T12:00:00+05:30", "Q2"],
    ["2026-10-01T00:00:00+05:30", "Q3"],
    ["2026-12-31T23:00:00+05:30", "Q3"],
    ["2027-01-01T00:00:00+05:30", "Q4"],
    ["2027-03-31T23:59:59+05:30", "Q4"],
    ["2026-03-31T20:00:00Z", "Q1"], // 1 Apr IST
  ])("quarterly %s → %s", (iso, q) => {
    expect(periodFor("quarterly", new Date(iso))).toBe(q);
  });

  it("annual", () => {
    expect(periodFor("annual", new Date())).toBe("Annual");
  });

  it("rejects bad input", () => {
    expect(() => periodFor("monthly", new Date("x"))).toThrow(PathError);
    expect(() => periodFor("monthly", "2026-10" as unknown as Date)).toThrow(PathError);
    expect(() => periodFor("weekly" as Frequency, new Date())).toThrow(/isn't one Firm OS knows/);
  });
});

describe("isValidPeriod / parsePeriod / periodInFy", () => {
  it.each(["2026-10", "2027-03", "Q1", "Q4", "Annual"])("valid %s", (p) => {
    expect(isValidPeriod(p)).toBe(true);
    expect(parsePeriod(p)).toBe(p);
  });

  it.each(["2026-13", "2026-00", "2026-1", "26-10", "Q0", "Q5", "q2", "annual", "ANNUAL", "", "H1", 202610, null])(
    "invalid %j",
    (p) => {
      expect(isValidPeriod(p)).toBe(false);
      expect(() => parsePeriod(p)).toThrow(PathError);
    },
  );

  it("monthly periods must sit inside the FY", () => {
    expect(periodInFy("2026-04", "FY2026-27")).toBe(true);
    expect(periodInFy("2027-03", "FY2026-27")).toBe(true);
    expect(periodInFy("2026-03", "FY2026-27")).toBe(false);
    expect(periodInFy("2027-04", "FY2026-27")).toBe(false);
    expect(periodInFy("Q3", "FY2026-27")).toBe(true);
    expect(periodInFy("Annual", "2026-27")).toBe(true);
  });
});

describe("defaultPeriods", () => {
  it("GST and Books get Apr..Mar", () => {
    const months = defaultPeriods("GST", "FY2026-27");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-04");
    expect(months[8]).toBe("2026-12");
    expect(months[9]).toBe("2027-01");
    expect(months[11]).toBe("2027-03");
    expect(defaultPeriods("Books", "2026-27")).toEqual(months);
  });

  it("TDS quarterly, others annual", () => {
    expect(defaultPeriods("TDS", "FY2026-27")).toEqual([...QUARTERS]);
    for (const s of ["ROC", "IncomeTax", "Audit", "Engagement"] as ServiceFolder[]) expect(defaultPeriods(s, "FY2026-27")).toEqual(["Annual"]);
  });
});

describe("guards", () => {
  it("service and kind", () => {
    for (const s of SERVICES) expect(validateService(s)).toBe(s);
    for (const k of KINDS) expect(validateKind(k)).toBe(k);
    expect(isServiceFolder("gst")).toBe(false);
    expect(isDeliverableKind("final")).toBe(false);
    expect(() => validateService("Income Tax")).toThrow(/must be one of/);
    expect(() => validateKind("Draft")).toThrow(/must be one of/);
  });
});

describe("site URLs", () => {
  it("builds CL site name, path and URL", () => {
    expect(CL_SITE_PREFIX).toBe("CL-");
    expect(clSiteName("ACME")).toBe("CL-ACME");
    expect(clSitePath("ACME")).toBe("/sites/CL-ACME");
    expect(clSiteUrl("ACME")).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME");
    expect(clSiteUrl("ACME", "contoso.sharepoint.com")).toBe("https://contoso.sharepoint.com/sites/CL-ACME");
    expect(hubSiteUrl()).toBe(`https://${DEFAULT_TENANT_HOST}/sites/Indefine-Compliance`);
    expect(hubSiteUrl("contoso.sharepoint.com")).toBe("https://contoso.sharepoint.com/sites/Indefine-Compliance");
  });

  it("rejects invalid codes in URLs", () => {
    expect(() => clSiteUrl("acme")).toThrow(PathError);
    expect(() => clSiteName("A")).toThrow(PathError);
  });
});

describe("servicePath", () => {
  it("points at the service folder", () => {
    const p = servicePath("ACME01", "2026-27", "GST");
    expect(p.path).toBe("FY2026-27/GST");
    expect(p.webUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST");
    expect(p.serverRelativeUrl).toBe("/sites/CL-ACME01/Compliance/FY2026-27/GST");
    expect(servicePath("ACME01", new Date("2026-03-31T20:00:00Z"), "Audit", "x.sharepoint.com").webUrl).toBe(
      "https://x.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/Audit",
    );
  });
});

describe("deliverablePath", () => {
  it("builds the full path for a monthly GST final", () => {
    const p = deliverablePath("ACME01", "FY2026-27", "GST", "2026-10", "Final");
    expect(p).toEqual({
      code: "ACME01",
      fy: "FY2026-27",
      service: "GST",
      period: "2026-10",
      kind: "Final",
      siteUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01",
      library: "Compliance",
      segments: ["FY2026-27", "GST", "2026-10", "Final"],
      path: "FY2026-27/GST/2026-10/Final",
      serverRelativeUrl: "/sites/CL-ACME01/Compliance/FY2026-27/GST/2026-10/Final",
      webUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST/2026-10/Final",
    });
  });

  it("accepts PeriodInput and a Date FY", () => {
    const d = new Date("2026-03-31T18:30:00Z"); // 1 Apr 2026 00:00 IST
    expect(deliverablePath("ACME", d, "TDS", { frequency: "quarterly", quarter: 2 }, "Working").path).toBe("FY2026-27/TDS/Q2/Working");
    expect(deliverablePath("ACME", d, "ROC", { frequency: "annual" }, "ClientDocs").path).toBe("FY2026-27/ROC/Annual/ClientDocs");
    expect(deliverablePath("ACME", "2026-27", "Books", { frequency: "monthly", year: 2027, month: 3 }, "Final", "t.sharepoint.com").webUrl).toBe(
      "https://t.sharepoint.com/sites/CL-ACME/Compliance/FY2026-27/Books/2027-03/Final",
    );
  });

  it("the day before 1 Apr IST lands in the previous FY", () => {
    const d = new Date("2026-03-31T18:29:59Z"); // 31 Mar 23:59:59 IST
    expect(deliverablePath("ACME", d, "GST", "2026-03", "Final").fy).toBe("FY2025-26");
    expect(() => deliverablePath("ACME", d, "GST", "2026-04", "Final")).toThrow(/outside FY2025-26/);
  });

  it.each<[string, string, string, string, string, RegExp]>([
    ["acme", "FY2026-27", "GST", "2026-10", "Final", /uppercase/],
    ["AC", "FY2026-27", "GST", "2026-10", "Final", /3–10/],
    ["ACME!", "FY2026-27", "GST", "2026-10", "Final", /A–Z/],
    ["ACME", "FY2026-28", "GST", "2026-10", "Final", /FY/],
    ["ACME", "FY2026-27", "VAT", "2026-10", "Final", /Service/],
    ["ACME", "FY2026-27", "GST", "2026-13", "Final", /Period/],
    ["ACME", "FY2026-27", "GST", "Q5", "Final", /Period/],
    ["ACME", "FY2026-27", "GST", "2027-04", "Final", /outside/],
    ["ACME", "FY2026-27", "GST", "2026-10", "Draft", /Kind/],
  ])("rejects %s %s %s %s %s", (code, fy, svc, per, kind, msg) => {
    expect(() => deliverablePath(code, fy, svc as ServiceFolder, per as never, kind as DeliverableKind)).toThrow(msg);
  });
});
