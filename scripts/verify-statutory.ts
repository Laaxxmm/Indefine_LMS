// Live check of the server-side statutory collectors (no database). Run when a portal
// shows FAILED or an unexpected 0:  npx tsx scripts/verify-statutory.ts [from] [to]
import assert from "node:assert";
import { collectCloud, iso } from "@/lib/statutory/cloud";
import { istDay } from "@/lib/statutory/portals";

assert.equal(iso("24-Mar-2026"), "2026-03-24");
assert.equal(iso("03/04/2026", "MDY"), "2026-03-04");
assert.equal(iso("03/04/2026"), "2026-04-03");
assert.equal(iso("September 5, 2026"), "2026-09-05");

const [from = istDay(-6), to = istDay(0)] = process.argv.slice(2);
const t0 = Date.now();
collectCloud(from, to).then((rs) => {
  for (const r of rs) {
    console.log(`${r.ok ? "OK    " : "FAILED"} ${r.portal}: fetched ${r.fetched}, in range ${r.items.length}, undated ${r.undated} ${r.error ?? ""}`);
    for (const x of r.items.slice(0, 3)) console.log(`         ${x.upload_date ?? x.issue_date} | ${x.title.slice(0, 80)} | ${(x.text ?? "").slice(0, 60)}`);
  }
  console.log(`${from}..${to} in ${Math.round((Date.now() - t0) / 1000)}s`);
});
