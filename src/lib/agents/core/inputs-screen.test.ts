// Upload limits on agent inputs (Phase 11): strict for staff uploads, warn-on-type for ClientDocs.
import { describe, expect, it, vi } from "vitest";
import type { UploadLogEntry, VirusScanner } from "@/lib/hardening/uploads";
import { InputRejectedError, screenedInputSource, staticInputSource } from "./inputs";
import type { InputFile, InputRequest } from "./runner";

const req = { agent: "roc", jobTaskId: "job-1", clientCode: "ACME01" } as unknown as InputRequest;
const file = (name: string, text: string, source: InputFile["source"] = "client-docs"): InputFile => ({ name, source, bytes: Buffer.from(text), contentType: undefined, path: `x/${name}` }) as InputFile;
const CSV = "ref,amount\nINV-1,100\n";

describe("screenedInputSource", () => {
  it("strict (staff uploads): an off-list type stops the run with a clear reason", async () => {
    const src = screenedInputSource(staticInputSource([file("register.csv", CSV, "upload" as InputFile["source"]), file("tool.exe", "MZ\x90")]), { typeMode: "strict", log: () => {} });
    await expect(src.gather(req)).rejects.toThrow(InputRejectedError);
    await expect(src.gather(req)).rejects.toThrow(/tool\.exe was refused: \.exe file type is not accepted/);
  });

  it("warn (ClientDocs): ROC's notes.txt passes, every file is logged once per gather, files come back unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = [file("register.csv", CSV), file("notes.txt", "AGM on 30 Sep 2026")];
    const out = await screenedInputSource(staticInputSource(files), { typeMode: "warn" }).gather(req);
    expect(out.map((f) => f.name)).toEqual(["register.csv", "notes.txt"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[upload\] ACME01 inputs screened: /);
    const entries = JSON.parse(line.replace(/^\[upload\] ACME01 inputs screened: /, "")) as UploadLogEntry[];
    expect(entries.map((e) => [e.ext, e.verdict, e.source])).toEqual([
      ["csv", "not-scanned", "client-docs"],
      ["txt", "not-scanned", "client-docs"],
    ]);
    expect(line).not.toContain("register"); // no file names in logs
  });

  it("an infected verdict stops the run even in warn mode; a clean scanner logs nothing", async () => {
    const infected: VirusScanner = { engine: "clamav", scan: async () => ({ status: "infected", engine: "clamav" }) };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(screenedInputSource(staticInputSource([file("register.csv", CSV)]), { typeMode: "warn", scanner: infected }).gather(req)).rejects.toThrow(/flagged this file/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();
    const clean: VirusScanner = { engine: "clamav", scan: async () => ({ status: "clean", engine: "clamav" }) };
    await screenedInputSource(staticInputSource([file("register.csv", CSV)]), { typeMode: "strict", scanner: clean }).gather(req);
    expect(warn).not.toHaveBeenCalled();
  });
});
