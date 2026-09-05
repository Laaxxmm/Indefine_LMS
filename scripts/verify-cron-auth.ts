import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cronUnauthorized } from "../src/lib/cron-auth";

const req = (init?: { auth?: string; url?: string }) =>
  new NextRequest(init?.url ?? "https://lms.example/api/cron/work", { headers: init?.auth ? { authorization: init.auth } : {} });

process.env.CRON_SECRET = "s3cret";
assert.equal(cronUnauthorized(req({ auth: "Bearer s3cret" })), null, "matching bearer passes");
assert.equal(cronUnauthorized(req({ auth: "bearer s3cret" })), null, "scheme is case-insensitive");
assert.equal(cronUnauthorized(req({ auth: "Bearer wrong" }))?.status, 401, "wrong secret refused");
assert.equal(cronUnauthorized(req({ auth: "Bearer s3cre" }))?.status, 401, "shorter secret refused");
assert.equal(cronUnauthorized(req())?.status, 401, "missing header refused");
assert.equal(cronUnauthorized(req({ url: "https://lms.example/api/cron/work?key=s3cret" }))?.status, 401, "query-string secret no longer accepted");

process.env.CRON_SECRET = "";
assert.equal(cronUnauthorized(req({ auth: "Bearer " }))?.status, 401, "unset secret refuses everything");

console.log("verify-cron-auth: all checks passed");
