// QuickXorHash against published test vectors (rclone's backend/onedrive/quickxorhash tests) and
// against a byte-by-byte port of Microsoft's reference loop on longer inputs (folding, wrap-around).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { quickXorHash } from "./quick-xor-hash";

const VECTORS: [string, string][] = [
  ["", "AAAAAAAAAAAAAAAAAAAAAAAAAAA="],
  ["Sg==", "SgAAAAAAAAAAAAAAAQAAAAAAAAA="],
  ["tbQ=", "taAFAAAAAAAAAAAAAgAAAAAAAAA="],
  ["0pZP", "0rDEEwAAAAAAAAAAAwAAAAAAAAA="],
  ["/aNzzCFPS/A=", "/RjFHJgRgicsAR4ACAAAAAAAAAA="],
  ["gQaybEqS/4UlDc8e4IJm", "gDCALNigBEn8oxAlZ8AzPAAOQZg="],
  ["2fuxhBJXtpWFe8dOfdGeHw==", "O9tHLAghgSvYohKFyMMxnNCHaHg="],
  ["T6LYJIfDh81JrAK309H2JMJTXis=", "zBTHrspn3mEcohlJdIUAbjGNaNg="],
  ["NbYXsp5/K6mR+NmHwExjvWeWDJFnXTKWVlzYHoesp2E=", "wjuAuWDiq04qDt1R8hHWDDcwVoQ="],
  ["Mb7EGva2rEE5fENDL85P+BsapHEEjv2/siVhKjvAQe02feExVOQSkfmuYzU/kTF1MaKjPmKF/w+cbvwfdWL8aQ==", "n1anP5NfvD4XDYWIeRPW3ZkPv1Y="],
  [
    "ikwCorI7PKWz17EI50jZCGbV9JU2E8bXVfxNMg5zdmqSZ2NlsQPp0kqYIPjzwTg1MBtfWPg53k0h0P2naJNEVgrqpoHTfV2b3pJ4m0zYPTJmUX4Bg/lOxcnCxAYKU29Y5F0U8Quz7ZXFBEweftXxJ7RS4r6N7BzJrPsLhY7hgck=",
    "imAoFvCWlDn4yVw3/oq1PDbbm6U=",
  ],
  [
    "qwGf2ESubE5jOUHHyc94ORczFYYbc2OmEzo+hBIyzJiNwAzC8PvJqtTzwkWkSslgHFGWQZR2BV5+uYTrYT7HVwRM40vqfj0dBgeDENyTenIOL1LHkjtDKoXEnQ0mXAHoJ8PjbNC93zi5TovVRXTNzfGEs5dpWVqxUzb5lc7dwkyvOluBw482mQ4xrzYyIY1t+//OrNi1ObGXuUw2jBQOFfJVj2Y6BOyYmfB1y36eBxi3zxeG5d5NYjm2GSh6e08QMAwu3zrINcqIzLOuNIiGXBtl7DjKt7b5wqi4oFiRpZsCyx2smhSrdrtK/CkdU6nDN+34vSR/M8rZpWQdBE7a8g==",
    "WYT9JY3JIo/pEBp+tIM6Gt2nyTM=",
  ],
];

/** Microsoft's reference HashCore/HashFinal loop, byte by byte (no folding). */
function reference(bytes: Uint8Array): string {
  const bits = new Uint8Array(160);
  for (let i = 0; i < bytes.length; i++) {
    const at = (i * 11) % 160;
    for (let b = 0; b < 8; b++) if ((bytes[i] >> b) & 1) bits[(at + b) % 160] ^= 1;
  }
  const out = new Uint8Array(20);
  for (let g = 0; g < 160; g++) if (bits[g]) out[g >> 3] |= 1 << (g & 7);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(bytes.length));
  for (let i = 0; i < 8; i++) out[12 + i] ^= len[i];
  return Buffer.from(out).toString("base64");
}

describe("quickXorHash", () => {
  it.each(VECTORS)("vector %#", (input, want) => {
    const bytes = Buffer.from(input, "base64");
    expect(quickXorHash(bytes)).toBe(want);
    expect(reference(bytes)).toBe(want);
  });

  it("matches the reference loop on longer inputs (folding past 160 bytes, wrap-around)", () => {
    for (const n of [159, 160, 161, 319, 320, 1000, 4096, 65_537]) {
      const bytes = Buffer.alloc(n);
      let seed = createHash("sha256").update(String(n)).digest();
      for (let i = 0; i < n; i += 32) {
        seed.copy(bytes, i, 0, Math.min(32, n - i));
        seed = createHash("sha256").update(seed).digest();
      }
      expect(quickXorHash(bytes)).toBe(reference(bytes));
    }
  });

  it("changes when content changes and is 20 bytes", () => {
    const a = quickXorHash(Buffer.from("final pack bytes"));
    expect(Buffer.from(a, "base64")).toHaveLength(20);
    expect(quickXorHash(Buffer.from("final pack byteZ"))).not.toBe(a);
  });
});
