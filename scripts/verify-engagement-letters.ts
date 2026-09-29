import assert from "node:assert/strict";
import { defaultRecipients, fileName, fyOf } from "../src/lib/office-tools/engagement-letters";

assert.equal(fyOf("2026-04-01"), "26-27");
assert.equal(fyOf("2027-03-31"), "26-27");
assert.equal(fyOf("2099-12-01"), "99-00");
assert.equal(fyOf("01/04/2026"), null);
assert.equal(fileName("Brickbee Technologies Pvt Ltd", "26-27", "signed"), "EL_Brickbee_Technologies_Pvt_Ltd_FY26-27.pdf");
assert.equal(fileName("A/B: Traders", "26-27", "client"), "EL_A-B-_Traders_FY26-27_Client-signed.pdf");
assert.deepEqual(
  defaultRecipients({ email: "ceo@x.in", sigEmail: " Ravi@x.in ", extraSigs: [{ email: "CEO@x.in" }, { email: "bad" }] }),
  ["ceo@x.in", "Ravi@x.in"]
);
console.log("verify-engagement-letters: all checks passed");
