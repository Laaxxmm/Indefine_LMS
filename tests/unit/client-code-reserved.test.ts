// Security audit (web/paths): "CON" and "NUL" passed validateClientCode as syntactically valid codes,
// though Windows refuses them as folder / file names (OneDrive sync on the firm's PCs). Ported from
// the audit PoC (.audit-sec/web/paths.test.ts "Path A deliverablePath / validateClientCode"): every
// Windows reserved device name is now refused, everywhere a client code becomes a path.
import { describe, expect, it } from "vitest";
import { PathError, RESERVED_CLIENT_CODES, clSiteName, deliverablePath, isValidClientCode, validateClientCode } from "@/lib/integrations/sharepoint/paths";

const RESERVED = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];

describe("reserved Windows names are never client codes", () => {
  it.each(RESERVED)("%s is refused by validateClientCode, isValidClientCode, deliverablePath and clSiteName", (code) => {
    expect(RESERVED_CLIENT_CODES.has(code)).toBe(true);
    expect(() => validateClientCode(code)).toThrow(PathError);
    expect(() => validateClientCode(code)).toThrow(/reserved Windows name/);
    expect(isValidClientCode(code)).toBe(false);
    expect(() => deliverablePath(code, "FY2026-27", "GST", "2026-10", "Final")).toThrow(PathError);
    expect(() => clSiteName(code)).toThrow(PathError);
  });

  it("near misses stay valid codes", () => {
    for (const ok of ["CONS", "CON1", "NULL", "COM10", "LPT0", "COM0", "AUXL", "PRN2X", "ACME01"]) {
      expect(validateClientCode(ok), ok).toBe(ok);
      expect(isValidClientCode(ok), ok).toBe(true);
    }
    expect(RESERVED_CLIENT_CODES.size).toBe(22);
  });
});
