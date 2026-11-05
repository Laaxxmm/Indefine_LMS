// Query classification: full identifiers are exact lookups, parts of identifiers are refused with a
// plain sentence, ordinary words (and FY / period / "26AS") stay text searches.
import { describe, expect, it } from "vitest";
import { GSTIN_RE, PAN_RE } from "@/lib/clients/core";
import { GSTIN_PATTERN, PAN_PATTERN, QUERY_MESSAGES, classifyQuery, isPartialGstin, isPartialPan, isSensitiveQuery, normaliseIdentifier, normaliseQuery } from "./query";

describe("patterns", () => {
  it("match the client master's PAN and GSTIN rules exactly", () => {
    expect(PAN_PATTERN.source).toBe(PAN_RE.source);
    expect(GSTIN_PATTERN.source).toBe(GSTIN_RE.source);
  });
});

describe("normaliseIdentifier", () => {
  it("PAN and GSTIN: upper case, spaces removed", () => {
    expect(normaliseIdentifier(" aaaca 1234f ")).toEqual({ kind: "pan", value: "AAACA1234F" });
    expect(normaliseIdentifier("33aaaca1234f1z5")).toEqual({ kind: "gstin", value: "33AAACA1234F1Z5" });
  });

  it("phone: the 10 digits, with +91 / 91 / 0 and separators dropped", () => {
    for (const p of ["9876543210", "98765 43210", "+91 98765-43210", "+919876543210", "919876543210", "09876543210", "(98765) 43210"]) {
      expect(normaliseIdentifier(p), p).toEqual({ kind: "phone", value: "9876543210" });
    }
    expect(normaliseIdentifier("+1 555 010 9999")).toBeNull();
  });

  it("email: lower case, must be complete", () => {
    expect(normaliseIdentifier("Ravi.Acct@Acme.Example")).toEqual({ kind: "email", value: "ravi.acct@acme.example" });
    for (const e of ["ravi@", "@acme.example", "ravi@acme", "ravi acct@acme.example"]) expect(normaliseIdentifier(e), e).toBeNull();
  });
});

describe("classifyQuery", () => {
  it("too short and too long are refused with a sentence", () => {
    expect(classifyQuery(" a ")).toEqual({ kind: "invalid", q: "a", message: "Type at least 2 characters to search." });
    expect(classifyQuery("x".repeat(101)).kind).toBe("invalid");
    expect(classifyQuery("x".repeat(101))).toMatchObject({ message: QUERY_MESSAGES.tooLong });
  });

  it("a prefix of a PAN is partial, never a search", () => {
    for (const q of ["AAACA1", "AAACA12", "aaaca123", "AAACA1234"]) expect(classifyQuery(q), q).toMatchObject({ kind: "partial", idKind: "pan", message: "Search by PAN needs the full 10-character PAN." });
    expect(isPartialPan("AAACA")).toBe(false); // five letters alone are a word
  });

  it("a prefix of a GSTIN (state code + PAN letters) is partial; '26AS' is a word", () => {
    expect(classifyQuery("33AAACA")).toMatchObject({ kind: "partial", idKind: "gstin", message: QUERY_MESSAGES.partial.gstin });
    expect(classifyQuery("33AAACA1234F1Z")).toMatchObject({ kind: "partial", idKind: "gstin" });
    expect(isPartialGstin("26AS")).toBe(false);
    expect(classifyQuery("26AS").kind).toBe("text");
  });

  it("part of a phone number or an email is partial; FY and period are text", () => {
    expect(classifyQuery("98765")).toMatchObject({ kind: "partial", idKind: "phone", message: "Search by phone needs the full 10-digit mobile number." });
    expect(classifyQuery("98765 432")).toMatchObject({ kind: "partial", idKind: "phone" });
    expect(classifyQuery("ravi@")).toMatchObject({ kind: "partial", idKind: "email" });
    expect(classifyQuery("@acme.example")).toMatchObject({ kind: "partial", idKind: "email" });
    expect(classifyQuery("2026-27").kind).toBe("text");
    expect(classifyQuery("2026-10").kind).toBe("text");
    expect(classifyQuery("2026").kind).toBe("text");
  });

  it("an Aadhaar number is refused: Firm OS does not keep them", () => {
    expect(classifyQuery("1234 5678 9012")).toMatchObject({ kind: "unsupported", message: QUERY_MESSAGES.aadhaar });
    expect(classifyQuery("234567890123")).toMatchObject({ kind: "unsupported" });
  });

  it("full identifiers are identifier searches; words are text", () => {
    expect(classifyQuery("AAACA1234F")).toMatchObject({ kind: "identifier", id: { kind: "pan", value: "AAACA1234F" } });
    expect(classifyQuery("Acme Traders")).toEqual({ kind: "text", q: "Acme Traders" });
    expect(classifyQuery("ACME01").kind).toBe("text");
    expect(classifyQuery("GSTR-3B").kind).toBe("text");
    expect(normaliseQuery("  Acme\t\tTraders ")).toBe("Acme Traders");
  });

  it("sensitive queries (never put in a URL) are identifiers, parts of them and Aadhaar", () => {
    expect(isSensitiveQuery("AAACA1234F")).toBe(true);
    expect(isSensitiveQuery("AAACA12")).toBe(true);
    expect(isSensitiveQuery("ravi@acme.example")).toBe(true);
    expect(isSensitiveQuery("1234 5678 9012")).toBe(true);
    expect(isSensitiveQuery("acme")).toBe(false);
    expect(isSensitiveQuery("2026-27")).toBe(false);
  });

  it("messages are plain sentences with no codes", () => {
    const all = [QUERY_MESSAGES.tooShort, QUERY_MESSAGES.tooLong, QUERY_MESSAGES.aadhaar, ...Object.values(QUERY_MESSAGES.partial)];
    for (const m of all) {
      expect(m).toMatch(/^[A-Z].*\.$/);
      expect(m).not.toMatch(/\b[45]\d\d\b|[A-Z]+_[A-Z]+|P\d{4}/);
    }
  });
});
