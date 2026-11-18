// Seeded generator of SYNTHETIC Indian identifiers for anonymizer tests. Every value is made
// up (random letters/digits with correct checksums); nothing here is real client data.
import { GST_STATE_CODES, gstinCheckChar, verhoeffCheckDigit } from "../anonymizer";
import type { DictionaryEntry } from "../types";

/** mulberry32: tiny deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  return { next, int, pick };
}
export type Rng = ReturnType<typeof rng>;

const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const D = "0123456789";
const AN = L + D;
const chars = (r: Rng, set: string, n: number) => Array.from({ length: n }, () => r.pick(set.split(""))).join("");

const pan = (r: Rng): string => chars(r, L, 3) + r.pick("PCHFATBLJG".split("")) + chars(r, L, 1) + chars(r, D, 4) + chars(r, L, 1);
const gstin = (r: Rng, p: string = pan(r)): string => {
  const first14 = r.pick([...GST_STATE_CODES]) + p + r.pick("123456789A".split("")) + "Z";
  return first14 + gstinCheckChar(first14);
};
const aadhaar = (r: Rng): string => {
  const first11 = String(r.int(2, 9)) + chars(r, D, 10);
  return first11 + verhoeffCheckDigit(first11);
};

export const gen = {
  pan,
  gstin,
  gstinBadChecksum(r: Rng): string {
    const g = gstin(r);
    const wrong = AN[(AN.indexOf(g[14]) + 1 + r.int(0, 30)) % 36];
    return g.slice(0, 14) + wrong;
  },
  aadhaar,
  aadhaarFormatted(r: Rng): string {
    const a = aadhaar(r);
    const sep = r.pick([" ", "-", ""]);
    return `${a.slice(0, 4)}${sep}${a.slice(4, 8)}${sep}${a.slice(8)}`;
  },
  tan: (r: Rng) => chars(r, L, 4) + chars(r, D, 5) + chars(r, L, 1),
  cin: (r: Rng) => r.pick(["U", "L"]) + chars(r, D, 5) + r.pick(["KA", "MH", "TN", "DL"]) + String(r.int(1980, 2025)) + r.pick(["PTC", "PLC", "OPC"]) + chars(r, D, 6),
  llpin: (r: Rng) => "AA" + chars(r, L, 1) + "-" + chars(r, D, 4),
  din: (r: Rng) => "0" + chars(r, D, 7),
  ifsc: (r: Rng) => chars(r, L, 4) + "0" + chars(r, AN, 6),
  account: (r: Rng) => String(r.int(1, 9)) + chars(r, D, r.int(8, 17)),
  phone(r: Rng) {
    const n = String(r.int(6, 9)) + chars(r, D, 9);
    return r.pick([n, `+91 ${n.slice(0, 5)} ${n.slice(5)}`, `+91-${n}`, `0${n}`, `${n.slice(0, 5)}-${n.slice(5)}`, `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`]);
  },
  email: (r: Rng) => `${r.pick(["asha", "vikram", "meera", "arjun", "kavya"])}.${chars(r, L, 3).toLowerCase()}${r.int(1, 99)}@example-firm.in`,
  dob(r: Rng) {
    const dd = String(r.int(1, 28)).padStart(2, "0");
    const mm = String(r.int(1, 12)).padStart(2, "0");
    const yyyy = String(r.int(1950, 2004));
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm) - 1];
    return r.pick([`${dd}/${mm}/${yyyy}`, `${dd}-${mm}-${yyyy}`, `${Number(dd)} ${mon} ${yyyy}`, `${yyyy}-${mm}-${dd}`]);
  },
  pinCode: (r: Rng) => String(r.int(1, 9)) + chars(r, D, 5),
};

const FIRST = ["Zorvan", "Ilsha", "Quorin", "Velmira", "Tavish", "Oyelle", "Brisan", "Kethra"];
const LAST = ["Mandravel", "Ostrakar", "Vunnapalli", "Zeltharam", "Quistarno", "Erravatti"];
const ORG_A = ["Zentrix", "Quorvale", "Ombrisk", "Velatora", "Krynth"];
const ORG_B = ["Traders", "Infotech", "Agencies", "Exports", "Advisors"];

export interface SyntheticCase {
  text: string;
  /** Raw PII values that must not survive masking. */
  secrets: string[];
  dictionary: DictionaryEntry[];
}

export function syntheticCase(r: Rng, i: number): SyntheticCase {
  const person = `${r.pick(FIRST)} ${r.pick(LAST)}`;
  const org = `${r.pick(ORG_A)} ${r.pick(ORG_B)} ${r.pick(["Private Limited", "Pvt Ltd", "LLP"])}`;
  const pin = gen.pinCode(r);
  const address = `No. ${r.int(1, 300)}, ${r.int(1, 12)}th Cross, ${r.pick(["Velora", "Kestrel", "Ombar"])} Nagar, Bengaluru ${pin}`;
  const pan = gen.pan(r);
  const gstin = gen.gstin(r, pan);
  const v = {
    pan,
    gstin,
    gstinBad: gen.gstinBadChecksum(r),
    aadhaar: gen.aadhaarFormatted(r),
    tan: gen.tan(r),
    cin: gen.cin(r),
    llpin: gen.llpin(r),
    din: gen.din(r),
    ifsc: gen.ifsc(r),
    account: gen.account(r),
    phone: gen.phone(r),
    email: gen.email(r),
    dob: gen.dob(r),
    pin: gen.pinCode(r),
  };
  const amount = `₹${r.int(1, 99)},${String(r.int(10, 99))},${String(r.int(100, 999))}.00`;
  const templates: (() => [string, string[]])[] = [
    () => [`Client ${person} (PAN ${v.pan}, GSTIN ${v.gstin}) filed GSTR-3B; tax ${amount}. Phone ${v.phone}, mail ${v.email}.`, [person, v.pan, v.gstin, v.phone, v.email]],
    () => [`KYC for ${person}: Aadhaar ${v.aadhaar}, DOB ${v.dob}, residing at ${address}.`, [person, v.aadhaar, v.dob, address, pin]],
    () => [`${org} — CIN ${v.cin}, TAN ${v.tan}; director ${person} holds DIN ${v.din}.`, [org, v.cin, v.tan, person, v.din]],
    () => [`Refund to bank A/c No. ${v.account}, IFSC ${v.ifsc}, account holder ${org}.`, [v.account, v.ifsc, org]],
    () => [`Partner of ${org}, LLPIN ${v.llpin}, contact ${v.phone} or ${v.email}.`, [org, v.llpin, v.phone, v.email]],
    () => [`Counterparty GSTIN ${v.gstinBad} looks mistyped; supplier PAN ${v.pan.toLowerCase()} per invoice.`, [v.gstinBad, v.pan.toLowerCase()]],
    () => [`Send notice copy to ${person}, ${address}. Alt. address PIN code ${v.pin}.`, [person, address, pin, v.pin]],
    () => [`Date of birth: ${v.dob}. Mobile: ${v.phone}. UIDAI no ${v.aadhaar}. Same mobile again: ${v.phone}.`, [v.dob, v.phone, v.aadhaar]],
    () => [`${person.toUpperCase()} signed for ${org.toLowerCase()}; GSTIN ${v.gstin}; TDS TAN ${v.tan}.`, [person.toUpperCase(), org.toLowerCase(), v.gstin, v.tan]],
    () => [`Salary credited to account ${v.account} (${v.ifsc}); employee ${person}, PAN ${v.pan}, phone ${v.phone}.`, [v.account, v.ifsc, person, v.pan, v.phone]],
  ];
  const [text, secrets] = templates[i % templates.length]();
  return {
    text,
    secrets,
    dictionary: [
      { value: person, kind: "NAME" },
      { value: org, kind: "ORG" },
      { value: address, kind: "ADDRESS" },
    ],
  };
}
