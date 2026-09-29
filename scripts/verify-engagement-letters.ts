import assert from "node:assert/strict";
import { defaultRecipients, emailTemplate, fileName, fyOf } from "../src/lib/office-tools/engagement-letters";
import { can } from "../src/lib/office-tools/engagement-letter-flow";

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
assert.equal(fileName("Acme", "26-27", "draft"), "EL_Acme_FY26-27_Draft.pdf");
assert.match(emailTemplate({ client: "Acme", sigTitle: "Mr.", sigName: "Ravi Kumar" }, "26-27", "Me", "draft").text, /^Dear Mr\. Ravi Kumar,/);
assert.match(emailTemplate({ client: "Acme" }, "26-27", "Me", "draft").subject, /approval/);

// Signing is locked until the client approves the draft.
assert.equal(can("uploadSigned", "DRAFT"), false);
assert.equal(can("uploadSigned", "SENT_FOR_APPROVAL"), false);
assert.equal(can("uploadSigned", "APPROVED"), true);
assert.equal(can("approve", "DRAFT"), false);
assert.equal(can("approve", "SENT_FOR_APPROVAL"), true);
assert.equal(can("sendDraft", "DRAFT"), false);
assert.equal(can("sendSigned", "APPROVED"), false);
assert.equal(can("uploadClient", "SENT"), true);

console.log("verify-engagement-letters: all checks passed");
