// Repo scan: no UTF-8 mojibake in src/. Mojibake is UTF-8 text that was read as Windows-1252 and
// saved again as UTF-8 — "₹" (E2 82 B9) becomes the three characters U+00E2 U+201A U+00B9, "—"
// becomes U+00E2 U+20AC U+201D, "×" becomes U+00C3 U+2014. It reached the Verify sheet of the tax
// workbook once (src/lib/agents/tax/data.ts, audit round 2); this test keeps it from coming back
// anywhere under src/ (tests included).
//
// The patterns (and the garbled samples of the self-test) are built from code points, so this file
// never contains — or matches — a mojibake sequence itself.
import { describe, expect, it } from "vitest";
import { loadFiles } from "../../scripts/lib/repo-files";

const ch = (...cps: number[]) => String.fromCodePoint(...cps);

/** Windows-1252 renderings of a UTF-8 continuation byte (0x80–0xBF): Latin-1 for 0xA0–0xBF, these for 0x80–0x9F. */
const CP1252_HIGH = [0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178];
const CONTINUATION = `[\\u0080-\\u00BF${CP1252_HIGH.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]`;

export const MOJIBAKE_RULES: [string, RegExp][] = [
  // U+00E2 U+201A …: a garbled U+20A0 currency sign — ₹ (the audit's case), €.
  ["mojibake:rupee-or-currency", new RegExp(ch(0xe2, 0x201a))],
  // U+00E2 U+20AC …: garbled U+2000 punctuation — ’ “ ” — – … (the audit's right quote and left quote).
  ["mojibake:punctuation", new RegExp(ch(0xe2, 0x20ac))],
  // U+00E2 then U+2020 / U+02C6 / U+2030: garbled arrows, maths and relations — → − ≤ ≥.
  ["mojibake:arrows-maths", new RegExp(`${ch(0xe2)}[${ch(0x2020, 0x02c6, 0x2030)}]`)],
  // U+00C3 then a continuation character: garbled Latin-1 letters — é × è ü. A lone U+00C3 before a
  // plain letter (a Portuguese name) is legitimate and is not flagged.
  ["mojibake:latin1-letter", new RegExp(`${ch(0xc3)}${CONTINUATION}`)],
  // U+00C2 then U+00A0–U+00BF: garbled Latin-1 symbols — no-break space, ·, ©, °, ½.
  ["mojibake:latin1-symbol", new RegExp(`${ch(0xc2)}[\\u00A0-\\u00BF]`)],
];

/** What a correct string turns into when its UTF-8 bytes are read as Windows-1252 (for the self-test). */
function garble(s: string): string {
  const back = new Map(CP1252_HIGH.map((c, i) => [c, [0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f][i]]));
  const toChar = new Map([...back].map(([c, b]) => [b, c]));
  return [...Buffer.from(s, "utf8")].map((b) => (b >= 0x80 && b <= 0x9f ? String.fromCodePoint(toChar.get(b) ?? b) : String.fromCodePoint(b))).join("");
}

export function mojibakeViolations(files: { path: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    f.content.split(/\r?\n/).forEach((line, i) => {
      for (const [rule, re] of MOJIBAKE_RULES) if (re.test(line)) out.push(`${f.path}:${i + 1}  ${rule}  ${line.trim().slice(0, 160)}`);
    });
  }
  return out;
}

const TEXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|txt|csv|ya?ml|svg)$/;

describe("no UTF-8 mojibake in src/", () => {
  it("self-test: every common sequence is caught, and the correct characters are not", () => {
    const samples = ["₹", "€", "’", "“", "”", "—", "–", "…", "→", "−", "≤", "≥", "×", "é", "è", "ü", "·", "©", "°", " "];
    for (const s of samples) {
      const bad = garble(s);
      expect(bad, s).not.toBe(s);
      expect(mojibakeViolations([{ path: "x.ts", content: `const label = "${bad}";` }]), `${s} → ${bad}`).toHaveLength(1);
      expect(mojibakeViolations([{ path: "x.ts", content: `const label = "${s}";` }]), s).toEqual([]);
    }
    // The sequences named in the audit: garbled ₹, the U+00C3 family, garbled ’ and “.
    expect(garble("₹")).toBe(ch(0xe2, 0x201a, 0xb9));
    expect(garble("’")).toBe(ch(0xe2, 0x20ac, 0x2122));
    expect(garble("“")).toBe(ch(0xe2, 0x20ac, 0x153));
    expect(garble("×")).toBe(ch(0xc3, 0x2014));
    // Legitimate text stays clean: a Portuguese name, an accented word, rupee amounts, a BOM-free file.
    expect(mojibakeViolations([{ path: "x.ts", content: `const n = "JO${ch(0xc3)}O"; // café, ₹1,00,000 — 5% → ≤ ₹5,00,000` }])).toEqual([]);
  });
  it("no text file under src/ contains mojibake", () => {
    const files = loadFiles((p) => p.startsWith("src/") && TEXT.test(p));
    expect(files.length).toBeGreaterThan(800);
    expect(mojibakeViolations(files)).toEqual([]);
  });
  it("the tax verify notes read ₹ (the Verify sheet), with no byte-order mark in the file", () => {
    const [data] = loadFiles((p) => p === "src/lib/agents/tax/data.ts");
    expect(data.content.charCodeAt(0)).not.toBe(0xfeff);
    expect(data.content).toContain("s.16(ia): ₹75,000 new regime, ₹50,000 old regime.");
  });
});
