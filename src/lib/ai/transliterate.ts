// Name matching across scripts for the anonymizer dictionary (re-audit NEW-1c). A client's name is
// in the dictionary in Latin script ("Rajesh Kumar Sharma"); the same name typed in Devanagari
// ("राजेश कुमार शर्मा") or Kannada ("ರಾಜೇಶ್ ಕುಮಾರ್ ಶರ್ಮಾ") must be masked too.
//
// Generating THE Devanagari spelling of a Latin name is not deterministic (one Latin spelling has
// several Indic ones), so both sides are reduced to one phonetic key instead and compared there:
//
//   indicKey(word)   a Devanagari / Kannada word → Latin letters by a fixed table (consonant +
//                    inherent "a", vowel signs, virama, anusvara) → phoneticKey
//   phoneticKey(w)   lower case; aspirates folded (kh → k, sh → s, th → t …), w → v, z → j, q → k,
//                    ph → f, long vowels shortened (ee → i, oo → u), every "a" dropped (Hindi drops
//                    the inherent vowel inside and at the end of a word, so "Kamla" / कमला and
//                    "Sharma" / शर्मा meet), doubled letters collapsed, "m" before p / b → "n"
//
// "rajesh" and राजेश both become "rjes"; "kumar" and कुमार "kumr"; "sharma" and शर्मा "srm".
//
// Limits: only Devanagari (Hindi, Marathi, Sanskrit) and Kannada; other
// Indic scripts (Tamil, Telugu, Malayalam, Bengali, Gujarati, Gurmukhi) are not transliterated. The
// key is lossy on purpose, so a name only matches as a whole: a multi-word name needs every word to
// match in order, and a single word (a first name or surname alone) needs a key of four or more
// letters. Names the dictionary does not know are not found in Indic script at all (the free-text
// name extractor reads Latin script only). Pure: no I/O.

const DEVANAGARI_VOWELS: Readonly<Record<string, string>> = {
  अ: "a", आ: "aa", इ: "i", ई: "ii", उ: "u", ऊ: "uu", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऍ: "e", ऑ: "o",
};
const DEVANAGARI_SIGNS: Readonly<Record<string, string>> = {
  "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o",
};
const DEVANAGARI_CONSONANTS: Readonly<Record<string, string>> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n", ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n", प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh",
  ष: "sh", स: "s", ह: "h", ळ: "l", क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "d", ढ़: "dh", फ़: "f", य़: "y",
};
const KANNADA_VOWELS: Readonly<Record<string, string>> = {
  ಅ: "a", ಆ: "aa", ಇ: "i", ಈ: "ii", ಉ: "u", ಊ: "uu", ಋ: "ri", ಎ: "e", ಏ: "e", ಐ: "ai", ಒ: "o", ಓ: "o", ಔ: "au",
};
const KANNADA_SIGNS: Readonly<Record<string, string>> = {
  "ಾ": "aa", "ಿ": "i", "ೀ": "ii", "ು": "u", "ೂ": "uu", "ೃ": "ri", "ೆ": "e", "ೇ": "e", "ೈ": "ai", "ೊ": "o", "ೋ": "o", "ೌ": "au",
};
const KANNADA_CONSONANTS: Readonly<Record<string, string>> = {
  ಕ: "k", ಖ: "kh", ಗ: "g", ಘ: "gh", ಙ: "n", ಚ: "ch", ಛ: "chh", ಜ: "j", ಝ: "jh", ಞ: "n", ಟ: "t", ಠ: "th", ಡ: "d", ಢ: "dh", ಣ: "n",
  ತ: "t", ಥ: "th", ದ: "d", ಧ: "dh", ನ: "n", ಪ: "p", ಫ: "ph", ಬ: "b", ಭ: "bh", ಮ: "m", ಯ: "y", ರ: "r", ಱ: "r", ಲ: "l", ವ: "v",
  ಶ: "sh", ಷ: "sh", ಸ: "s", ಹ: "h", ಳ: "l", ೞ: "l",
};
const VIRAMA = new Set(["्", "್"]);
const NASAL = new Set(["ं", "ँ", "ಂ"]);
const VISARGA = new Set(["ः", "ಃ"]);
const NUKTA = new Set(["़", "಼"]);

/** A regex character-class range of two code points ("x-y"). */
const range = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;

/** A Devanagari or Kannada letter (incl. vowel signs and marks)? U+0900–U+097F, U+0C80–U+0CFF. */
export const INDIC_LETTER = new RegExp(`[${range(0x0900, 0x097f)}${range(0x0c80, 0x0cff)}]`);
/** Runs of Devanagari or Kannada letters (one word each). */
export const INDIC_WORD = new RegExp(`[${range(0x0900, 0x0963)}${range(0x0971, 0x097f)}${range(0x0c80, 0x0ce3)}${range(0x0cf1, 0x0cff)}]+`, "g");

/** Latin letters for one Devanagari / Kannada word, by the tables above (schwa kept; phoneticKey drops it). */
export function indicToLatin(word: string): string {
  let out = "";
  let pendingA = false;
  for (const ch of word) {
    const cons = DEVANAGARI_CONSONANTS[ch] ?? KANNADA_CONSONANTS[ch];
    if (cons !== undefined) {
      if (pendingA) out += "a";
      out += cons;
      pendingA = true;
      continue;
    }
    const sign = DEVANAGARI_SIGNS[ch] ?? KANNADA_SIGNS[ch];
    if (sign !== undefined) {
      out += sign;
      pendingA = false;
      continue;
    }
    if (VIRAMA.has(ch)) {
      pendingA = false;
      continue;
    }
    if (NUKTA.has(ch)) continue;
    if (pendingA) {
      out += "a";
      pendingA = false;
    }
    const vowel = DEVANAGARI_VOWELS[ch] ?? KANNADA_VOWELS[ch];
    if (vowel !== undefined) out += vowel;
    else if (NASAL.has(ch)) out += "n";
    else if (VISARGA.has(ch)) out += "h";
  }
  if (pendingA) out += "a";
  return out;
}

const ASPIRATES = new Set("bcdgjklpst");

/** The lossy phonetic key both scripts are compared in (see the header). One pass per step, no regular expressions (it runs per word). */
export function phoneticKey(latin: string): string {
  const s = latin.toLowerCase();
  // 1. letters only; aspirates, ph, w, z, q, x, ck folded
  let a = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c < "a" || c > "z") continue;
    const n = s[i + 1];
    if (c === "p" && n === "h") {
      a += "f";
      i++;
    } else if (n === "h" && ASPIRATES.has(c)) {
      a += c;
      i++;
    } else if (c === "c" && n === "k") {
      a += "k";
      i++;
    } else a += c === "w" ? "v" : c === "z" ? "j" : c === "q" ? "k" : c === "x" ? "ks" : c;
  }
  // 2. long vowels shortened, every "a" dropped, m before p / b → n
  let b = "";
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    const n = a[i + 1];
    if (c === "a") continue;
    if ((c === "e" && (n === "e" || n === "y")) || (c === "i" && n === "i")) {
      b += "i";
      i++;
    } else if ((c === "o" && n === "o") || (c === "u" && n === "u")) {
      b += "u";
      i++;
    } else b += c === "m" && (n === "p" || n === "b") ? "n" : c;
  }
  // 3. doubled letters collapsed
  let out = "";
  for (let i = 0; i < b.length; i++) if (b[i] !== out[out.length - 1]) out += b[i];
  return out;
}

const keyMemo = new Map<string, string>();

/** phoneticKey of a Devanagari / Kannada word (memoised: running text repeats its words). */
export function indicKey(word: string): string {
  let k = keyMemo.get(word);
  if (k === undefined) {
    k = phoneticKey(indicToLatin(word));
    if (keyMemo.size >= 20_000) keyMemo.clear();
    keyMemo.set(word, k);
  }
  return k;
}
