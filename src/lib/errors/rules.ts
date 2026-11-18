// What a message a person can see must never contain (the owner's rule: "the error messages I get
// should directly tell me what the error is — no codes on the error messages"). Pure data plus one
// checker, shared by the repo-scan guard (tests/unit/plain-language-errors.test.ts, through
// scripts/lib/plain-messages.ts) and the runtime tests of every message table.
//
// A rule is a pattern that marks a code or internal word. The allowlist names the firm's own
// abbreviations (GSTIN, PAN, ARN, TDS, …) and form names (GSTR-3B, AOC-4, CL-12), which are plain
// words to a CA firm and are removed before the patterns run.

/** Upper-case words a person in a CA firm reads as ordinary words. */
export const ALLOWED_CAPS: readonly string[] = [
  // tax, company and identity numbers
  "GSTIN", "GST", "IGST", "CGST", "SGST", "PAN", "TAN", "ARN", "SRN", "TDS", "TCS", "ITR", "ITC", "RCM", "HSN", "SAC",
  "UDIN", "DSC", "DIN", "DPIN", "CIN", "LLPIN", "LLP", "HUF", "IEC", "MSME", "UAN", "ESI", "ESIC", "EPF", "EPFO", "PTRC",
  "PTEC", "IFSC", "UPI", "NEFT", "RTGS", "LUT", "FIRC", "TRACES", "AIS", "TIS", "SFT", "CBDT", "CBIC", "RBI", "FEMA",
  // regulators, bodies and places
  "ROC", "MCA", "ICAI", "DPDP", "IST", "OTP", "KYC", "NRI", "PIN",
  // audit and company law
  "CARO", "AGM", "EGM", "CSR", "MAT", "AMT", "KMP", "NBFC", "PPE", "XBRL", "LODR", "SEBI", "NCLT", "STP", "CFO", "CEO",
  // the firm's own words
  "SOP", "SOPs", "KRA", "KRAs", "MCQ", "MCQs", "CA", "CAs", "IT", "HR", "AI", "FY", "AY", "TB",
  // file kinds
  "PDF", "PDFs", "XLSX", "XLS", "CSV", "DOCX", "ZIP", "PNG", "JPG", "JPEG",
  // product names written in capitals
  "URL", "OK",
];

/** Form and checklist names: GSTR-3B, ITR-4, AOC-4, MGT-7, DIR-3 KYC, 26AS, Form 16, CL-12. */
export const ALLOWED_PATTERNS: readonly RegExp[] = [
  /\bCL-[A-Za-z0-9-]+/g,
  /\b(?:GSTR|ITR|AOC|MGT|DIR|DPT|ADT|INC|PAS|CMP|CHG|LLP|MSME|ITC|PMT|DRC|REG|RFD)-\d+[A-Z]?\b/g,
  /\b\d+[A-Z]{1,3}\b/g, // 26AS, 3CD, 24Q, 3B
  /\bM365\b/g,
  /\b[FA]Y\s?\d{4}(?:-\d{2,4})?\b/g, // FY2026-27, AY 2027-28
  /\b(?:II|III|IV|VI|VII|VIII|IX|XI|XII)\b/g, // Schedule III, Part II
  /\b[A-Z]{5}\d{4}[A-Z]\b/g, // a PAN shown as an example of the format (ABCDE1234F)
  /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, // a GSTIN example (29ABCDE1234F1Z5)
];

/** Words that are developer jargon to the people reading these messages. Whole words, any case. */
export const JARGON: readonly string[] = [
  "zod", "schema", "payload", "prisma", "token", "tokens", "csrf", "json", "null", "undefined", "NaN", "enum",
  "stack trace", "exception", "endpoint", "api", "http", "https", "uuid", "cuid", "regex", "multipart", "form-data",
  "content-length", "middleware", "env", "stdout", "stderr", "sha256", "hash", "mime", "cors", "upsert", "boolean",
  "webhook", "graph", "cron", "rate limited", "unauthorized", "unauthorised", "forbidden", "status code",
  "server error", "internal error", "db", "foreign key", "unique constraint", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
  "fetch failed", "failed to fetch", "id", "ids", "slug", "param", "params", "stack",
];

/** A whole message that is only a status phrase, not a sentence a person can act on. */
export const BARE_PHRASES: readonly string[] = [
  "unauthorized", "unauthorised", "forbidden", "not found", "not permitted", "no access", "invalid request",
  "invalid request body", "invalid body", "bad body", "bad request", "invalid json", "invalid id", "server error",
  "internal server error", "error", "failed", "conflict", "something went wrong", "network error", "unknown error",
  "admins only", "access denied", "permission denied", "invalid input", "missing fields", "invalid", "required",
];

export type MessageRule = { id: string; test: (text: string) => boolean; why: string };

const word = (w: string) => new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![\\w-])`, "i");
const JARGON_RES = JARGON.map((w) => [w, w === "NaN" ? /\bNaN\b/ : w === "id" || w === "ids" ? new RegExp(`(?<![\\w-])${w}(?![\\w-])`) : word(w)] as const);
const CAPS = new Set(ALLOWED_CAPS);

/** File names ("company.json", "sales register.xlsx"), extensions (".json"), web addresses and placeholders: names, not words. */
function withoutNames(text: string): string {
  return text
    .replace(/\{x\}/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .replace(/[\w.-]*\.(?:json|csv|xlsx|xls|xlsm|pdf|docx|doc|txt|zip|png|jpe?g)\b/gi, " ");
}

/** The message with allowlisted form names and abbreviations removed, and placeholders kept as {x}. */
function scrub(text: string): string {
  let t = text;
  for (const re of ALLOWED_PATTERNS) t = t.replace(re, " ");
  return t;
}

export const MESSAGE_RULES: readonly MessageRule[] = [
  {
    id: "http-status",
    why: "an HTTP status number",
    test: (t) =>
      /\b(?:HTTP|status|error|code)\s*:?\s*[1-5]\d{2}\b/i.test(t) ||
      /\b[1-5]\d{2}\s+(?:Bad Request|Unauthori[sz]ed|Forbidden|Not Found|Conflict|Payload|Too Many|Internal|Bad Gateway|Service Unavailable|Gateway Timeout|Unprocessable)/i.test(t) ||
      /\(\s*[45]\d{2}\s*\)/.test(t) ||
      /^\s*[45]\d{2}\b/.test(t) ||
      /\b[45]\d{2}\s*[:—–]/.test(t) ||
      /\b[45]xx\b/i.test(t),
  },
  {
    id: "constant-code",
    why: "an ALL_CAPS constant or code",
    test: (t) => {
      const s = scrub(t);
      if (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(s)) return true;
      for (const m of s.matchAll(/\b[A-Z][A-Z0-9]{2,}s?\b/g)) if (!CAPS.has(m[0]) && !CAPS.has(m[0].replace(/s$/, ""))) return true;
      return false;
    },
  },
  { id: "prisma-code", why: "a database error code", test: (t) => /\bP\d{4}\b/.test(t) },
  {
    id: "error-prefix",
    why: "an 'Error:' prefix or an exception class name",
    test: (t) => /\b\w*Error:/.test(t) || /^\s*(?:Error|Exception|Fatal)\b/i.test(t) || /\b[A-Z][A-Za-z]+(?:Error|Exception)\b/.test(t),
  },
  {
    id: "stack-frame",
    why: "a stack frame or source location",
    test: (t) => /\bat\s+[\w$.<>]+\s+\(/.test(t) || /\.(?:ts|tsx|js|mjs|cjs):\d+/.test(t) || /node:internal/.test(t),
  },
  {
    id: "jargon",
    why: "developer jargon",
    test: (t) => {
      return JARGON_RES.some(([, re]) => re.test(withoutNames(t)));
    },
  },
  {
    id: "raw-identifier",
    why: "a variable or field name (camelCase or snake_case)",
    test: (t) => {
      const s = withoutNames(t).replace(/\b[\w.-]+@[\w.-]+\b/g, " ");
      return /(?<![\w.])[a-z]+[A-Z][A-Za-z0-9]*\b/.test(s.replace(/\b(?:iPhone|iPad|iOS|macOS|eSign|eKYC|eWay|eInvoice|ePAN|iCloud|greytHR|eFiling)\b/g, " ")) || /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(s);
    },
  },
  {
    id: "bare-phrase",
    why: "a bare status phrase instead of a sentence that says what to do",
    test: (t) => BARE_PHRASES.includes(t.trim().replace(/[.!]+$/, "").toLowerCase()),
  },
  {
    id: "unknown-internal",
    why: "an internal 'Unknown <thing>' message",
    test: (t) => /^\s*Unknown\s+\w+/.test(t) || /\bUnknown (?:agent|tool|service|handler|state|kind|scope|action|field|entity|format|file kind)\b/i.test(t),
  },
  {
    id: "developer-required",
    why: "a developer-worded 'x required' message",
    test: (t) => /^\s*[\w/.-]+ (?:is )?required\.?\s*$/i.test(t) || /\bmust be [a-z]+(?:, [a-z]+)* or [a-z]+$/.test(t),
  },
  // "sales.xlsx!Sheet1" (a workbook location) is not punctuation.
  { id: "exclamation", why: "an exclamation mark", test: (t) => /!(?=\s|$|["')])/.test(t) },
];

/** Every rule the text breaks, as "rule-id (why)". An empty list means the message is clean. */
export function messageProblems(text: string): string[] {
  return MESSAGE_RULES.filter((r) => r.test(text)).map((r) => `${r.id} (${r.why})`);
}

/** True when nothing in the text looks like a code, a stack trace or developer jargon. */
export function isPlainMessage(text: string): boolean {
  return messageProblems(text).length === 0;
}
