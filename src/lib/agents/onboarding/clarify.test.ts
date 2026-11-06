import { describe, expect, it } from "vitest";
import { PEOPLE, completeSpec } from "./__fixtures__/synthetic";
import { MAX_QUESTIONS, SERVICE_OPTIONS, applyAnswers, clarify, parseInr } from "./clarify";
import { resolvePeople, resolvePerson } from "./people";
import {
  OnboardingSpec, mergeSpec, missingFields, normalizeFyInput, normalizePeriod, normalizePhone, requiredFields, serviceLineLabel,
  type PartialSpec,
} from "./spec";

const NOW = new Date("2026-11-05T10:00:00Z");
const fields = (spec: PartialSpec, ctx = {}) => clarify(spec, { people: PEOPLE, now: NOW, ...ctx }).map((q) => q.field);

describe("clarify", () => {
  it("asks nothing when the spec is complete", () => {
    expect(clarify(completeSpec(), { people: PEOPLE, now: NOW })).toEqual([]);
  });

  it("asks at most five questions, in the fixed priority order", () => {
    expect(fields({})).toEqual(["legalName", "entityType", "services", "clientCode", "fy"]);
    expect(MAX_QUESTIONS).toBe(5);
  });

  it("asks only the missing fields, next in priority order", () => {
    const spec: PartialSpec = { legalName: "Acme", entityType: "PVT_LTD", services: [{ service: "GST", frequency: "MONTHLY" }], clientCode: "ACME01", fy: "2026-27" };
    expect(fields(spec)).toEqual(["assigneeId", "reviewerId", "pan", "gstins", "cin"]);
    const rest: PartialSpec = { ...completeSpec(), cin: undefined, contactEmail: undefined, dscHolder: undefined };
    expect(fields(rest)).toEqual(["cin", "contactEmail", "dscHolder"]);
  });

  it("conditional fields follow the entity type and services", () => {
    const prop: PartialSpec = { ...completeSpec({ entityType: "PROPRIETORSHIP", services: [{ service: "IncomeTax", frequency: "ANNUAL" }] }) };
    prop.cin = undefined;
    prop.gstins = [];
    prop.firstPeriod = undefined;
    prop.dscHolder = undefined;
    prop.booksSoftware = undefined;
    expect(fields(prop)).toEqual([]); // no GSTIN, CIN, first period, DSC or books software needed
    expect(requiredFields({ booksSoftware: "Other" })).toContain("booksSoftwareOther");
    expect(requiredFields({ services: [{ service: "ROC", frequency: "ANNUAL" }] })).toContain("dscHolder");
  });

  it("re-asks invalid fields with the validator's message", () => {
    const qs = clarify(completeSpec(), { people: PEOPLE, now: NOW, invalid: { pan: "PAN is wrong", growthGoal: "ignored (not required)" } });
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ field: "pan", error: "PAN is wrong" });
  });

  it("offers people for assignee/reviewer, narrowed to candidates when a name is ambiguous", () => {
    const base: PartialSpec = { ...completeSpec(), assigneeId: undefined, assigneeName: "Priya", reviewerId: undefined, reviewerName: "Zubin" };
    const { spec, candidates } = resolvePeople(base, PEOPLE);
    const qs = clarify(spec, { people: PEOPLE, candidates, now: NOW });
    expect(qs.map((q) => q.field)).toEqual(["assigneeId", "reviewerId"]);
    expect(qs[0].options?.map((o) => o.value)).toEqual(["u-priya", "u-priyan"]);
    expect(qs[0].help).toBe('"Priya" matches 2 people. Pick one.');
    expect(qs[1].options).toHaveLength(PEOPLE.length);
    expect(qs[1].help).toMatch(/No active person named "Zubin"/);
    expect(clarify({ ...completeSpec(), assigneeId: undefined }, { now: NOW })[0]).toMatchObject({ field: "assigneeId", options: [] });
  });

  it("question shapes", () => {
    const qs = new Map(clarify({ entityType: "LLP", services: [{ service: "GST", frequency: "MONTHLY" }, { service: "Books", frequency: "MONTHLY" }] }, { now: NOW }).map((q) => [q.field, q]));
    expect(qs.get("legalName")?.kind).toBe("text");
    expect(qs.get("clientCode")?.placeholder).toBe("ACME01");
    expect(qs.get("fy")?.defaultValue).toBe("2026-27");
    const all = new Map(
      [
        ...clarify({ ...completeSpec({ entityType: "LLP" }), cin: undefined, firstPeriod: undefined, contactEmail: undefined, contactPhone: undefined, turnoverInr: undefined }, { now: NOW }),
        ...clarify({ ...completeSpec(), billing: undefined, dscHolder: undefined, booksSoftware: undefined, gstins: [], pan: undefined }, { now: NOW }),
        ...clarify({ ...completeSpec(), entityType: undefined, services: undefined }, { now: NOW }),
        ...clarify({ ...completeSpec(), booksSoftware: "Other" }, { now: NOW }),
      ].map((q) => [q.field, q]),
    );
    expect(all.get("cin")).toMatchObject({ label: "LLPIN", placeholder: "AAB-1234" });
    expect(all.get("firstPeriod")?.kind).toBe("month");
    expect(all.get("contactEmail")?.kind).toBe("email");
    expect(all.get("contactPhone")?.kind).toBe("tel");
    expect(all.get("turnoverInr")?.kind).toBe("text");
    expect(all.get("billing")?.kind).toBe("text");
    expect(all.get("dscHolder")?.kind).toBe("text");
    expect(all.get("booksSoftware")?.options?.map((o) => o.value)).toEqual(["Tally", "Zoho", "Other"]);
    expect(all.get("gstins")?.kind).toBe("gstins");
    expect(all.get("pan")?.placeholder).toBe("AAAAA9999A");
    expect(all.get("entityType")?.options).toHaveLength(9);
    expect(all.get("services")?.options).toEqual(SERVICE_OPTIONS);
    expect(all.get("booksSoftwareOther")?.kind).toBe("text");
    const company = clarify({ ...completeSpec(), cin: undefined }, { now: NOW });
    expect(company[0]).toMatchObject({ label: "CIN", placeholder: "U12345KA2020PTC123456" });
  });
});

describe("applyAnswers", () => {
  it("normalises each kind of answer", () => {
    const { spec, errors } = applyAnswers(
      { legalName: "Acme" },
      {
        services: ["GST:QUARTERLY", "ROC:ANNUAL"],
        gstins: "29aaaca1234f1z5\n33AAACA1234F2Z1, 29AAACA1234F1Z5",
        turnoverInr: "2.5 Cr",
        pan: " aaaca 1234f ",
        clientCode: "acme01",
        cin: "u12345ka2020ptc123456",
        fy: "FY 2026/27",
        firstPeriod: "Q3",
        contactPhone: "+91 98765 43210",
        contactEmail: "Meera@Acme.TEST",
        entityType: "PVT_LTD",
        booksSoftware: "Zoho",
        assigneeId: "u-priya",
        billing: "Retainer",
        growthGoal: "EXPORT",
        unknownField: "x",
        dscHolder: "",
      },
    );
    expect(errors).toEqual({});
    expect(spec).toEqual({
      legalName: "Acme",
      services: [{ service: "GST", frequency: "QUARTERLY" }, { service: "ROC", frequency: "ANNUAL" }],
      gstins: ["29AAACA1234F1Z5", "33AAACA1234F2Z1"],
      turnoverInr: 25_000_000,
      pan: "AAACA1234F",
      clientCode: "ACME01",
      cin: "U12345KA2020PTC123456",
      fy: "2026-27",
      firstPeriod: "2026-10",
      contactPhone: "9876543210",
      contactEmail: "meera@acme.test",
      entityType: "PVT_LTD",
      booksSoftware: "Zoho",
      assigneeId: "u-priya",
      billing: "Retainer",
    });
  });

  it("reports what it cannot parse and keeps the rest", () => {
    const { spec, errors } = applyAnswers({}, { services: ["GST:WEEKLY"], turnoverInr: "lots", entityType: "COOP", booksSoftware: "Excel", legalName: ["Acme", "Ltd"] });
    expect(errors).toEqual({
      services: 'Unknown service "GST:WEEKLY"',
      turnoverInr: "Enter an amount, e.g. 2.5 Cr or 45,00,000",
      entityType: "Pick an entity type from the list",
      booksSoftware: "Pick Tally, Zoho or Other",
    });
    expect(spec).toEqual({ legalName: "Acme\nLtd" });
  });

  it("parseInr", () => {
    expect(parseInr("45,00,000")).toBe(4_500_000);
    expect(parseInr("₹40 lakh")).toBe(4_000_000);
    expect(parseInr("1.5 lacs")).toBe(150_000);
    expect(parseInr("2 crores")).toBe(20_000_000);
    expect(parseInr("800k")).toBe(800_000);
    expect(parseInr("Rs. 1000")).toBe(1000);
    expect(parseInr("about a crore")).toBeNaN();
  });
});

describe("spec helpers", () => {
  it("OnboardingSpec accepts a complete spec and rejects a missing conditional field", () => {
    expect(OnboardingSpec.safeParse(completeSpec()).success).toBe(true);
    const r = OnboardingSpec.safeParse({ ...completeSpec(), gstins: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ["gstins"], message: "GSTIN(s) is required" });
  });

  it("missingFields", () => {
    expect(missingFields(completeSpec())).toEqual([]);
    expect(missingFields({ ...completeSpec(), legalName: "  ", turnoverInr: Number.NaN })).toEqual(["legalName", "turnoverInr"]);
  });

  it("normalizers", () => {
    expect(normalizePhone("098450 12345")).toBe("9845012345");
    expect(normalizePhone("919845012345")).toBe("9845012345");
    expect(normalizePhone(" 12 ")).toBe("12");
    expect(normalizeFyInput("2026-2027")).toBe("2026-27");
    expect(normalizeFyInput("FY27")).toBe("FY27");
    expect(normalizePeriod("2026-1")).toBe("2026-01");
    expect(normalizePeriod("November 2026")).toBe("2026-11");
    expect(normalizePeriod("Smarch 2026")).toBe("Smarch 2026");
    expect(normalizePeriod("Q1", "2026-27")).toBe("2026-04");
    expect(normalizePeriod("Q2", "2026-27")).toBe("2026-07");
    expect(normalizePeriod("Q4", "2026-27")).toBe("2027-01");
    expect(normalizePeriod("Q1")).toBe("Q1");
    expect(serviceLineLabel({ service: "GST", frequency: "QUARTERLY" })).toBe("GST (quarterly, QRMP)");
    expect(serviceLineLabel({ service: "IncomeTax", frequency: "ANNUAL" })).toBe("Income tax (annual)");
  });

  it("mergeSpec: present values win; a changed name clears its resolved id", () => {
    const base: PartialSpec = { legalName: "A", assigneeId: "u-priya", assigneeName: "Priya Sharma", reviewerId: "u-ravi", reviewerName: "Ravi Kumar" };
    expect(mergeSpec(base, { legalName: " ", assigneeName: "Anita", reviewerName: "Ravi Kumar" })).toEqual({
      legalName: "A", assigneeId: undefined, assigneeName: "Anita", reviewerId: "u-ravi", reviewerName: "Ravi Kumar",
    });
    expect(mergeSpec(base, { reviewerName: "Meena" }).reviewerId).toBeUndefined();
    expect(mergeSpec(base, { assigneeName: "Anita", assigneeId: "u-anita" }).assigneeId).toBe("u-anita");
  });
});

describe("people", () => {
  it("resolvePerson tiers: full name, first name, any part, prefix", () => {
    expect(resolvePerson("ravi kumar", PEOPLE).id).toBe("u-ravi");
    expect(resolvePerson("Karthik", PEOPLE).id).toBe("u-karthik");
    expect(resolvePerson("Iyer", PEOPLE).id).toBe("u-karthik");
    expect(resolvePerson("Mee", PEOPLE).id).toBe("u-meena");
    expect(resolvePerson("Priya", PEOPLE)).toMatchObject({ id: null });
    expect(resolvePerson("", PEOPLE)).toEqual({ id: null, candidates: [] });
    expect(resolvePerson("Zed", PEOPLE)).toEqual({ id: null, candidates: [] });
  });

  it("resolvePeople keeps a known id, drops an inactive one", () => {
    expect(resolvePeople({ assigneeId: "u-anita" }, PEOPLE).spec).toMatchObject({ assigneeId: "u-anita", assigneeName: "Anita Desai" });
    expect(resolvePeople({ assigneeId: "u-gone" }, PEOPLE).spec.assigneeId).toBeUndefined();
  });
});
