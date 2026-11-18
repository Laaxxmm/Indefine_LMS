import { describe, expect, it, vi } from "vitest";
import { PAN, badChecksum, completeSpec, gstinFor } from "./__fixtures__/synthetic";
import {
  gstStateCode, issuesByField, validateCin, validateClientCodeShape, validateFields, validateGstin, validatePan, validateSpec,
  type ValidationPorts,
} from "./validators";

describe("validatePan", () => {
  it("accepts a well-formed PAN of the right holder type", () => {
    expect(validatePan(PAN.company, "PVT_LTD")).toBeNull();
    expect(validatePan(PAN.individual, "PROPRIETORSHIP")).toBeNull();
    expect(validatePan(PAN.huf, "HUF")).toBeNull();
    expect(validatePan(PAN.firm, "PARTNERSHIP")).toBeNull();
    expect(validatePan(PAN.llp, "LLP")).toBeNull();
    expect(validatePan(PAN.trust, "TRUST_SOCIETY")).toBeNull();
    expect(validatePan(PAN.company, "OTHER")).toBeNull();
    expect(validatePan(PAN.company)).toBeNull();
  });
  it.each(["AAACA1234", "AAACA12345", "1AACA1234F", "AAACA1234f", "AAAC-1234F", ""])("rejects %j", (p) => {
    expect(validatePan(p)).toMatch(/10 characters/);
  });
  it("rejects a PAN of the wrong holder type", () => {
    expect(validatePan(PAN.individual, "PVT_LTD")).toMatch(/not a private limited PAN \(4th character is P, expected C\)/);
    expect(validatePan(PAN.company, "HUF")).toMatch(/expected H/);
  });
});

describe("validateGstin", () => {
  const good = gstinFor("29", PAN.company);
  it("accepts a valid GSTIN whose embedded PAN matches", () => {
    expect(validateGstin(good, PAN.company)).toEqual([]);
    expect(validateGstin(gstinFor("97", PAN.company), PAN.company)).toEqual([]);
    expect(validateGstin(good)).toEqual([]);
  });
  it("rejects a bad checksum and names the right character", () => {
    const bad = badChecksum(good);
    const issues = validateGstin(bad, PAN.company);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(`should be ${good[14]}`);
  });
  it("rejects an unknown state code", () => {
    const g = gstinFor("40", PAN.company);
    expect(validateGstin(g, PAN.company)).toEqual([`GSTIN ${g} starts with 40, which is not a GST state code`]);
    expect(validateGstin(gstinFor("00", PAN.company))[0]).toMatch(/not a GST state code/);
  });
  it("rejects a GSTIN that embeds a different PAN", () => {
    const other = gstinFor("29", PAN.company2);
    expect(validateGstin(other, PAN.company)).toEqual([`GSTIN ${other} belongs to PAN ${PAN.company2}, not ${PAN.company}`]);
  });
  it("rejects wrong length and shape", () => {
    expect(validateGstin("29AAACA1234F1Z", PAN.company)[0]).toMatch(/15 characters/);
    expect(validateGstin("29AAACA1234F1X5", PAN.company)[0]).toMatch(/not in the GSTIN format/);
    expect(validateGstin("29AAACA1234F0Z5", PAN.company)[0]).toMatch(/not in the GSTIN format/);
  });
  it("gives the state code", () => {
    expect(gstStateCode(good)).toBe("29");
    expect(gstStateCode("nope")).toBeNull();
  });
});

describe("validateCin (CIN / LLPIN)", () => {
  it("accepts valid CINs for the entity type", () => {
    expect(validateCin("U12345KA2020PTC123456", "PVT_LTD")).toBeNull();
    expect(validateCin("U12345KA2020OPC123456", "PVT_LTD")).toBeNull();
    expect(validateCin("L27100KA1990PLC012345", "PUBLIC_LTD")).toBeNull();
    expect(validateCin("L27100KA1990PLC012345")).toBeNull();
  });
  it("rejects malformed CINs, impossible years and the wrong company class", () => {
    expect(validateCin("U12345KA2020PTC12345", "PVT_LTD")).toMatch(/21 characters/);
    expect(validateCin("X12345KA2020PTC123456", "PVT_LTD")).toMatch(/21 characters/);
    expect(validateCin("U12345KA2020XYZ123456", "PVT_LTD")).toMatch(/21 characters/);
    expect(validateCin("U12345KA1700PTC123456", "PVT_LTD")).toMatch(/incorporation year/);
    expect(validateCin("L27100KA1990PLC012345", "PVT_LTD")).toMatch(/not a private company CIN/);
    expect(validateCin("U12345KA2020PTC123456", "PUBLIC_LTD")).toMatch(/not a public company CIN/);
  });
  it("checks LLPIN for LLPs", () => {
    expect(validateCin("AAB-1234", "LLP")).toBeNull();
    expect(validateCin("AAB1234", "LLP")).toMatch(/LLPIN/);
    expect(validateCin("U12345KA2020PTC123456", "LLP")).toMatch(/LLPIN/);
  });
});

describe("validateClientCodeShape", () => {
  it.each([["ACME01", null], ["ABC", null], ["ABCDEFGHIJ", null]])("%s ok", (c, r) => expect(validateClientCodeShape(c)).toBe(r));
  it.each(["AB", "ABCDEFGHIJK"])("%s wrong length", (c) => expect(validateClientCodeShape(c)).toMatch(/3–10/));
  it.each(["acme", "AC-ME", "AC ME"])("%s wrong characters", (c) => expect(validateClientCodeShape(c)).toMatch(/A–Z and 0–9/));
});

describe("validateFields", () => {
  it("passes a complete valid spec", () => {
    expect(validateFields(completeSpec())).toEqual([]);
  });
  it("reports every field-level problem", () => {
    const fields = validateFields({
      ...completeSpec(),
      clientCode: "ac",
      pan: "BAD",
      gstins: ["29AAACA1234F1Z"],
      cin: "nope",
      fy: "2026-28",
      services: [{ service: "TDS", frequency: "MONTHLY" }],
      firstPeriod: "2027-05",
      contactEmail: "x@",
      contactPhone: "123",
      turnoverInr: -1,
      reviewerId: "u-priya",
    }).map((i) => i.field);
    // firstPeriod is not judged against an invalid FY
    expect(fields).toEqual(["clientCode", "pan", "gstins", "cin", "fy", "services", "contactEmail", "contactPhone", "turnoverInr", "reviewerId"]);
  });
  it("flags a first period outside the FY and a malformed one", () => {
    expect(validateFields({ fy: "2026-27", firstPeriod: "2026-03" })[0].message).toMatch(/outside FY 2026-27/);
    expect(validateFields({ firstPeriod: "Nov" })[0].message).toMatch(/must be a month/);
    expect(validateFields({ fy: "2026-27", firstPeriod: "2027-03" })).toEqual([]);
  });
  it("a proprietorship has no CIN", () => {
    expect(validateFields({ entityType: "PROPRIETORSHIP", cin: "U12345KA2020PTC123456" }).map((i) => i.message)).toContain("A proprietorship has no CIN/LLPIN");
  });
  it("checks GSTINs against the PAN only when the PAN itself is well formed", () => {
    const g = gstinFor("29", PAN.company2);
    expect(validateFields({ pan: "BAD", gstins: [g] }).filter((i) => i.field === "gstins")).toEqual([]);
  });
});

function ports(o: Partial<ValidationPorts> = {}): ValidationPorts {
  return {
    findFirmClientByCode: vi.fn().mockResolvedValue(null),
    findLmsClient: vi.fn().mockResolvedValue(null),
    findActiveUser: vi.fn(async (id: string) => (id.startsWith("u-") ? { id, name: id } : null)),
    turia: { findClientByCode: vi.fn().mockResolvedValue({ status: "unknown", reason: "manual", checklistItem: "Search Turia for ACME01" }) },
    ...o,
  };
}

describe("validateSpec (with lookups)", () => {
  it("valid spec: no errors; the ManualBridge lookup becomes a checklist item", async () => {
    const r = await validateSpec(completeSpec(), ports());
    expect(r).toEqual({ errors: [], checks: ["Search Turia for ACME01"], existingLmsClient: null });
  });

  it("client code already used by another FirmClient", async () => {
    const r = await validateSpec(completeSpec(), ports({ findFirmClientByCode: vi.fn().mockResolvedValue({ lmsClientId: "c-9", legalName: "Other Co" }) }));
    expect(r.errors).toEqual([{ field: "clientCode", message: "Client code ACME01 is already used by Other Co" }]);
  });

  it("client code found in Turia", async () => {
    const r = await validateSpec(completeSpec(), ports({ turia: { findClientByCode: vi.fn().mockResolvedValue({ status: "found", turiaRef: "T-1" }) } }));
    expect(r.errors[0].message).toMatch(/already exists in Turia \(T-1\)/);
  });

  it("not found in Turia: no check needed", async () => {
    const r = await validateSpec(completeSpec(), ports({ turia: { findClientByCode: vi.fn().mockResolvedValue({ status: "not-found" }) } }));
    expect(r).toMatchObject({ errors: [], checks: [] });
  });

  it("a Turia lookup error (blocked bridge) becomes a manual check, not a failure", async () => {
    const r = await validateSpec(completeSpec(), ports({ turia: { findClientByCode: vi.fn().mockRejectedValue(new Error("blocked")) } }));
    expect(r.checks).toEqual(["Check Turia by hand for client code ACME01."]);
  });

  it("existing LMS client is linked, not duplicated; already onboarded under another code is an error", async () => {
    const link = await validateSpec(completeSpec(), ports({ findLmsClient: vi.fn().mockResolvedValue({ id: "c-1", name: "Acme Widgets Private Limited", clientCode: null }) }));
    expect(link.existingLmsClient).toEqual({ id: "c-1", name: "Acme Widgets Private Limited", clientCode: null });
    expect(link.errors).toEqual([]);
    const sameCode = await validateSpec(
      completeSpec(),
      ports({
        findLmsClient: vi.fn().mockResolvedValue({ id: "c-1", name: "Acme", clientCode: "ACME01" }),
        findFirmClientByCode: vi.fn().mockResolvedValue({ lmsClientId: "c-1", legalName: "Acme" }),
      }),
    );
    expect(sameCode.errors).toEqual([]);
    const dup = await validateSpec(completeSpec(), ports({ findLmsClient: vi.fn().mockResolvedValue({ id: "c-1", name: "Acme", clientCode: "ACMEX" }) }));
    expect(dup.errors[0]).toEqual({ field: "legalName", message: "Acme is already onboarded to Firm OS as ACMEX" });
  });

  it("assignee and reviewer must be active LMS users", async () => {
    const r = await validateSpec(completeSpec({ assigneeId: "gone", reviewerId: "gone2" }), ports());
    expect(r.errors.map((e) => e.field)).toEqual(["assigneeId", "reviewerId"]);
  });

  it("skips lookups for invalid or missing values", async () => {
    const p = ports();
    await validateSpec({ clientCode: "ac", pan: "BAD" }, p);
    expect(p.findFirmClientByCode).not.toHaveBeenCalled();
    expect(p.findLmsClient).not.toHaveBeenCalled();
    await validateSpec({}, p);
    expect(p.turia.findClientByCode).not.toHaveBeenCalled();
  });

  it("issuesByField keeps the first message per field", () => {
    expect(issuesByField([{ field: "pan", message: "a" }, { field: "pan", message: "b" }, { field: "cin", message: "c" }])).toEqual({ pan: "a", cin: "c" });
  });
});
