// Re-audit NEW-1 (HIGH): names in free-text columns reached the cloud and the leak gate could not
// see them. The re-audit's PoCs (ai-gst-e2e-names, ai-anonymizer-round2) are ported here: a name in
// an item description or a ledger ("Consultancy by Yashwanth Gowda Patil for Oct", "Rent - Ravindra
// Hegde"), a Form 16 line, a YAML-ish / JSON description, a UPI or NEFT narration, and dictionary
// names written in file names, glued, camelCase, underscored, as the surname alone, in Devanagari or
// as an organisation's acronym. Each must now be masked; the leak gate reads names too; ordinary
// business text must come through unchanged. Synthetic values only; providers are spies.
import { describe, expect, it } from "vitest";
import { loadRouterConfig } from "@/lib/ai/config";
import { detectPii, mask } from "@/lib/ai/anonymizer";
import { fileNameText, freeTextNames, personNameSpans, personNames } from "@/lib/ai/names";
import { createRouter, leakGateKinds, withMessageNames, type ModelCallRepo, type ModelRequest } from "@/lib/ai/router";
import { indicKey, phoneticKey } from "@/lib/ai/transliterate";
import type { DictionaryEntry, ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";
import { DEFAULT_FIXTURES_ROOT, loadApprovedMistakes, loadFixtures, packWithMistakes, runFixtureOnce } from "@/lib/agents/core/accuracy-run";
import { recordingKey } from "@/lib/agents/core/recorded-router";
import { buildRunDictionary, inputFileNames, type JobContext } from "@/lib/agents/core/runner";
import { AGENTS } from "@/lib/agents/registry";

const NOW = new Date("2026-11-06T00:00:00Z");
const DICT: DictionaryEntry[] = [
  { value: "Rajesh Kumar Sharma", kind: "NAME" },
  { value: "Meera Iyer", kind: "NAME" },
  { value: "Acme Widgets Pvt Ltd", kind: "ORG" },
];

type Case = { name: string; text: string; secrets: string[]; dictionary?: DictionaryEntry[] };
/** The re-audit's round-2 name cases (PoC ai-anonymizer-round2.test.ts): every one leaked before this fix. */
const ROUND2: Case[] = [
  { name: "dictionary name in a snake_case file name", text: "attached Form16_RAJESH_KUMAR_SHARMA_FY2526.pdf", secrets: ["KUMAR_SHARMA", "RAJESH"], dictionary: DICT },
  { name: "dictionary name glued (no spaces)", text: "payee RAJESHKUMARSHARMA ref 1", secrets: ["RAJESHKUMARSHARMA"], dictionary: DICT },
  { name: "dictionary name with dots", text: "user rajesh.kumar.sharma logged", secrets: ["rajesh.kumar.sharma"], dictionary: DICT },
  { name: "dictionary name as a camelCase value", text: '{"employeeRef":"RajeshKumarSharma"}', secrets: ["RajeshKumarSharma"], dictionary: DICT },
  { name: "dictionary name permuted", text: "Sharma Rajesh Kumar signed", secrets: ["Sharma Rajesh Kumar"], dictionary: DICT },
  { name: "dictionary name as initials", text: "R K Sharma signed", secrets: ["R K Sharma"], dictionary: DICT },
  { name: "dictionary name: surname alone", text: "Ask Sharma to sign", secrets: ["Sharma"], dictionary: DICT },
  { name: "dictionary name split across table cells", text: "| Rajesh Kumar | Sharma | 500 |", secrets: ["Rajesh", "Kumar", "Sharma"], dictionary: DICT },
  { name: "dictionary name in Devanagari", text: "भुगतान राजेश कुमार शर्मा को", secrets: ["राजेश", "कुमार"], dictionary: DICT },
  { name: "dictionary name in Kannada", text: "ಪಾವತಿ ರಾಜೇಶ್ ಕುಮಾರ್ ಶರ್ಮಾ ಅವರಿಗೆ", secrets: ["ರಾಜೇಶ್", "ಕುಮಾರ್"], dictionary: DICT },
  { name: "dictionary organisation acronym", text: "paid to AWPL on 3rd", secrets: ["AWPL"], dictionary: DICT },
  { name: "dictionary name with a zero-width joiner", text: "Raj‍esh Kumar Sharma", secrets: ["Kumar Sharma"], dictionary: DICT },
  { name: "Form 16 'Name of Employee:' line, no dictionary", text: "Name of Employee: RAJESH KUMAR SHARMA\nPAN of Employee: ⟨x⟩", secrets: ["RAJESH", "KUMAR", "SHARMA"] },
  { name: "YAML-ish 'employee:' line, no dictionary", text: "employee: Rajesh Kumar Sharma\namount: 100", secrets: ["Rajesh", "Kumar", "Sharma"] },
  { name: "JSON description value, no dictionary", text: '{"description":"Salary to Rajesh Kumar Sharma for Oct"}', secrets: ["Rajesh", "Kumar", "Sharma"] },
  { name: "UPI narration payee", text: "UPI/P2A/327712345678/Rajesh Kumar Sharma/SBIN/paytm-1", secrets: ["Rajesh", "Kumar", "Sharma"] },
  { name: "single-word NEFT payee", text: "NEFT-RAJESH-SAL OCT", secrets: ["RAJESH"] },
  { name: "item description (GST PoC)", text: "Professional Fees,Consultancy by Yashwanth Gowda Patil for Oct,18", secrets: ["Yashwanth", "Gowda", "Patil"] },
  { name: "ledger name (GST PoC)", text: "Rent - Ravindra Hegde,Office rent Oct", secrets: ["Ravindra", "Hegde"] },
  { name: "honorific in a note", text: "We advised Mr. Kiran Kumar to hold ITC; Smt Lakshmi agreed", secrets: ["Kiran", "Kumar", "Lakshmi"] },
  { name: "a firm after M/s", text: "M/s Sunrise Steel filed late", secrets: ["Sunrise"] },
  { name: "a lower-case labelled name", text: "landlord: ravindra hegde", secrets: ["ravindra", "hegde"] },
];

describe("NEW-1: names in free text are masked (ported round-2 PoC)", () => {
  it.each(ROUND2.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const { masked } = mask(c.text, { dictionary: c.dictionary, now: NOW });
    for (const s of c.secrets) expect(masked, `${c.name}: "${s}" survived in ${masked}`).not.toContain(s);
    // And nothing the independent, name-aware leak gate would still call a leak.
    expect(detectPii(masked, { dictionary: c.dictionary, names: true })).toEqual([]);
  });

  it("the leak gate is name-aware: the same texts UNMASKED are refused", () => {
    for (const c of ROUND2.filter((x) => !x.dictionary)) {
      expect(detectPii(c.text, { names: true }), c.name).toEqual(expect.arrayContaining([expect.stringMatching(/^(NAME|ORG)$/)]));
    }
    // Dictionary forms the gate now recognises (separators, camelCase, glued, acronym, Devanagari).
    for (const t of ["Form16_RAJESH_KUMAR_SHARMA.pdf", "RajeshKumarSharma", "RAJESHKUMARSHARMA", "rajesh.kumar.sharma", "paid AWPL", "राजेश कुमार शर्मा"]) {
      expect(detectPii(t, { dictionary: DICT }).length, t).toBeGreaterThan(0);
    }
  });
});

/** Business text an Indian CA firm's registers are full of: none of it is a name. */
const BUSINESS = [
  "Professional Fees for Oct",
  "Office Rent - Oct 2026",
  "Input Tax Credit reversed under Rule 42",
  "MS Steel Rods 12mm",
  "Reverse Charge Mechanism on Legal Services",
  "Sundry Creditors and Sundry Debtors",
  "Trial Balance as on 31 March 2026",
  "Profit and Loss Account",
  "Tamil Nadu, Andhra Pradesh, Uttar Pradesh",
  "Purchase Ledger - Packing Material",
  "Bank Charges HDFC Bank",
  "Interest on Term Loan",
  "Salary and Wages for October",
  "Repairs and Maintenance - Plant and Machinery",
  "Tally Prime export, Zoho Books export",
  "GSTR-3B Outward Taxable Supplies",
  "Place of Supply: Karnataka",
  "Electricity Charges BESCOM",
  "Courier Charges and Postage",
  "Printing and Stationery",
  "Share Capital and Reserves",
  "Long Term Borrowings from Banks",
  "Related Party Transactions note",
  "Copper Wire 2.5 sq mm, HSN 7408",
  "Laptop Bag and Printer Cartridge",
  "Question: Is RCM applied?\nEvidence to cite: the ledger line",
  "<<<UNTRUSTED_DOCUMENTS>>>\nS1 | 2026-10-03 | 500.00\n<<<END_UNTRUSTED_DOCUMENTS>>>",
  "Onboard the client and Create the folder",
];

describe("NEW-1: false positives — business text comes through unchanged", () => {
  it(`${BUSINESS.length} business strings are not names`, () => {
    expect(BUSINESS.length).toBeGreaterThanOrEqual(22);
    for (const t of BUSINESS) {
      expect(personNameSpans(t), t).toEqual([]);
      expect(mask(t, { now: NOW }).masked, t).toBe(t);
      expect(detectPii(t, { names: true }), t).toEqual([]);
    }
  });
});

describe("NEW-1: the extractor", () => {
  it("rules: honorific, label, json, rail, sequence — with kinds", () => {
    const spans = (t: string) => personNameSpans(t).map((s) => `${s.reason}:${s.kind}:${t.slice(s.start, s.end)}`);
    expect(spans("Name of Employee: RAJESH KUMAR SHARMA")).toEqual(["label:NAME:RAJESH KUMAR SHARMA"]);
    expect(spans("Payee: Synthetic Client Pvt Ltd")).toEqual(["label:ORG:Synthetic Client Pvt Ltd"]);
    expect(spans('{"payee": "Ravi Kumar"}')).toEqual(["json:NAME:Ravi Kumar"]);
    expect(spans("Dr. Meera visited; DR Cash 500")).toEqual(["honorific:NAME:Meera"]);
    expect(spans("NEFT-N12345-ASHA RAO-HDFC0001234")).toEqual(["rail:NAME:ASHA RAO"]);
    expect(spans("Kumar Traders paid Kiran Kumar")).toEqual(["sequence:ORG:Kumar Traders", "sequence:NAME:Kiran Kumar"]);
    expect(spans("GSTR-3B. Example PAN")).toEqual([]); // a code glued to digits is never an initial
    expect(spans("KA BLR 560041")).toEqual([]);
  });

  it("file names, free-text harvests and the generic input-file pass feed the run dictionary", () => {
    expect(personNames(fileNameText("Form16_RAJESH_KUMAR_SHARMA_FY2526.pdf"))).toEqual([{ value: "RAJESH KUMAR SHARMA", kind: "NAME" }]);
    expect(freeTextNames(["Rent - Ravindra Hegde", null, "Office Rent"])).toEqual([{ value: "Ravindra Hegde", kind: "NAME" }]);
    const files = [{ name: "notes_Chandrika_Nambiar.txt", bytes: Buffer.from("Reviewer: Asha Rao\nLoan from Mr Kiran Rao") }];
    expect(inputFileNames(files).map((e) => e.value)).toEqual(["Chandrika Nambiar", "Asha Rao", "Kiran Rao"]);
  });

  it("the router adds names from every client message (not the system prompt) to the request's dictionary", () => {
    const d = withMessageNames([{ value: "Acme", kind: "ORG" }], [
      { role: "system", content: "You are the Firm OS Books agent" },
      { role: "user", content: "S1 | Rent - Ravindra Hegde | 500" },
    ]);
    expect(d?.map((e) => e.value)).toEqual(["Ravindra Hegde", "Acme"]);
  });

  it("transliteration keys meet across scripts (documented limits: Devanagari and Kannada only)", () => {
    expect(indicKey("राजेश")).toBe(phoneticKey("Rajesh"));
    expect(indicKey("कुमार")).toBe(phoneticKey("Kumar"));
    expect(indicKey("शर्मा")).toBe(phoneticKey("Sharma"));
    expect(indicKey("कमला")).toBe(phoneticKey("Kamla"));
    expect(indicKey("ರಾಜೇಶ್")).toBe(phoneticKey("Rajesh"));
    expect(indicKey("ಕುಮಾರ್")).toBe(phoneticKey("Kumar"));
    expect(indicKey("भुगतान")).not.toBe(phoneticKey("Rajesh"));
  });
});

// ---------------------------------------------------------------- end to end (ported ai-gst-e2e-names PoC)

const cfg = loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" });
const repo = (): ModelCallRepo => ({ record: async () => {}, costInrSince: async () => 0, costInrForRun: async () => 0 });
function spy(answer: (r: ProviderRequest) => unknown) {
  const calls: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      return { output: answer(req) as T, model: req.model, tokensIn: 1, tokensOut: 1, latencyMs: 1 };
    },
  };
  return { provider, calls };
}
const off = (id: "grok" | "local"): ModelProvider => ({ id, isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) });

describe("NEW-1 end to end: the real GST agent through the real router", () => {
  it("a name only in an item description or a purchase ledger never reaches the provider; no call is refused", async () => {
    const NAMES = { inDescription: "Yashwanth Gowda Patil", inLedger: "Ravindra Hegde" };
    const def = AGENTS.gst;
    const pack = packWithMistakes(def, loadApprovedMistakes(DEFAULT_FIXTURES_ROOT, def.key));
    const fx = structuredClone(loadFixtures(DEFAULT_FIXTURES_ROOT, def.key).find((f) => f.id === "01-clean-tally-csv")!);
    for (const f of fx.inputFiles) f.bytes = Buffer.from(f.bytes); // structuredClone turns Buffers into Uint8Arrays
    const pr = fx.inputFiles.find((f) => f.name.includes("purchase"))!;
    const text = Buffer.from(pr.bytes).toString("utf8").trimEnd();
    const extra = [
      `12-10-2026,Sunrise Steel,Purchase,PUR-0901,SS/1099,12-10-2026,29AAGCS6101U1ZN,29-Karnataka,Professional Fees,Consultancy by ${NAMES.inDescription} for Oct,18,25000.00,,2250.00,2250.00,,29500.00,No`,
      `14-10-2026,Sunrise Steel,Purchase,PUR-0902,SS/1100,14-10-2026,29AAGCS6101U1ZN,29-Karnataka,Rent - ${NAMES.inLedger},Office rent Oct,18,30000.00,,2700.00,2700.00,,35400.00,No`,
    ].join("\n");
    pr.bytes = Buffer.from(`${text}\n${extra}\n`, "utf8");
    const payloads: ProviderRequest[] = [];
    const refused: string[] = [];
    const router = {
      async run<T>(req: ModelRequest<T>) {
        const answer = () => {
          const k = recordingKey(req);
          const out = Object.prototype.hasOwnProperty.call(fx.recorded, k) ? fx.recorded[k] : fx.recorded[req.task];
          return { output: structuredClone(out), confidence: 1 };
        };
        const claude = spy(answer);
        const r = createRouter({ providers: { claude: claude.provider, grok: off("grok"), local: off("local") }, repo: repo(), config: cfg });
        try {
          const res = await r.run(req);
          if (res.status === "queued") refused.push(String(req.task));
          return res;
        } finally {
          payloads.push(...claude.calls);
        }
      },
    };
    await runFixtureOnce(def, fx, pack, router);
    const parsed = def.inputSchema.safeParse(fx.inputFiles);
    expect(parsed.success).toBe(true);
    const job: JobContext = { jobTaskId: "fixture-job", title: def.title, service: def.service, fy: "2026-27", period: "2026-10", clientCode: "ACCURACY", clientName: "Fixture", assigneeId: null, reviewerId: null };
    const dict = await buildRunDictionary(def, parsed.success ? parsed.data : null, fx.inputFiles, job, undefined);
    const sent = payloads.map((p) => [p.system, ...p.messages.map((m) => m.content)].join("\n")).join("\n");
    expect(payloads.length).toBeGreaterThan(0);
    expect(refused).toEqual([]);
    for (const v of Object.values(NAMES)) {
      expect(dict.entries.some((e) => e.value.toLowerCase() === v.toLowerCase()), `${v} in the run dictionary`).toBe(true);
      for (const word of v.split(" ")) expect(sent, `${word} reached the provider`).not.toContain(word);
    }
    // The payloads that went out are clean by the name-aware gate's own reading.
    for (const p of payloads) expect(leakGateKinds(p, dict.entries)).toEqual([]);
  }, 120_000);
});
