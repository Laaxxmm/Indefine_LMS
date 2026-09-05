import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isSealed, keyFromEnv, open, seal } from "../src/lib/secret-box";

const key = randomBytes(32);
const sealed = seal("accessToken=abc; other=1", key);
assert.equal(isSealed(sealed), true);
assert.equal(sealed.startsWith("enc:v1:"), true);
assert.equal(open(sealed, key), "accessToken=abc; other=1");
assert.notEqual(seal("same", key), seal("same", key), "fresh nonce every time");

// Legacy plaintext rows pass through untouched, with or without a key.
assert.equal(open("plain=cookie", key), "plain=cookie");
assert.equal(open("plain=cookie", null), "plain=cookie");
assert.equal(isSealed("plain=cookie"), false);

// Wrong key, tampering, or a missing key all fail loudly rather than returning garbage.
assert.throws(() => open(sealed, randomBytes(32)));
assert.throws(() => open(sealed.slice(0, -2) + "AA", key));
assert.throws(() => open(sealed, null), /no key/);

process.env.SB_TEST = randomBytes(32).toString("hex");
assert.equal(keyFromEnv("SB_TEST")?.length, 32);
process.env.SB_TEST = "short";
assert.throws(() => keyFromEnv("SB_TEST"), /64 hex/);
delete process.env.SB_TEST;
assert.equal(keyFromEnv("SB_TEST"), null);

console.log("verify-secret-box: all checks passed");
