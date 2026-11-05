// QuickXorHash — the content hash OneDrive for Business and SharePoint document libraries report
// in driveItem.file.hashes.quickXorHash (Microsoft Graph). Computed here from bytes we upload or
// download, so the close gate can tell whether a file in SharePoint is still the one we hashed
// without downloading it again (content-registry.ts).
//
// Algorithm (Microsoft's reference implementation): a 160-bit register; byte i is XORed in at bit
// position (11·i) mod 160, wrapping around the register; finally the 64-bit little-endian content
// length is XORed into the last 8 bytes; base64 of the 20 bytes. Bytes 160 apart land on the same
// position, so the input is folded first (one XOR per byte), then the 160 folded bytes are placed.
//
// Not a cryptographic hash: anyone can build two files with the same quickXorHash. It is used only
// together with SharePoint's own content tag (cTag) and the size, never alone, and never in place
// of the SHA-256 we computed from the bytes ourselves.
const WIDTH_BITS = 160;
const SHIFT = 11;

export function quickXorHash(bytes: Uint8Array): string {
  const fold = new Uint8Array(WIDTH_BITS);
  for (let i = 0; i < bytes.length; i++) fold[i % WIDTH_BITS] ^= bytes[i];
  const out = new Uint8Array(WIDTH_BITS / 8);
  for (let i = 0; i < WIDTH_BITS && i < bytes.length; i++) {
    const v = fold[i];
    if (!v) continue;
    const at = (i * SHIFT) % WIDTH_BITS;
    for (let b = 0; b < 8; b++) {
      if (!((v >> b) & 1)) continue;
      const g = (at + b) % WIDTH_BITS;
      out[g >> 3] ^= 1 << (g & 7);
    }
  }
  let len = BigInt(bytes.length);
  for (let i = 0; i < 8; i++) {
    out[WIDTH_BITS / 8 - 8 + i] ^= Number(len & BigInt(0xff));
    len >>= BigInt(8);
  }
  return Buffer.from(out).toString("base64");
}
