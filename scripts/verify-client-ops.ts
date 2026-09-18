import assert from "node:assert/strict";
import type { BillingCycle, SubscriptionKind } from "@prisma/client";
import { CERT_ALARM_DAYS, annualised, daysLeft, draftReminder, inr, statusOf } from "../src/lib/client-ops/core";

const NOW = new Date("2026-09-18T09:00:00.000Z");
const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Dates: the boundary between "expiring" and "active" is 30 days, and past dates are expired.
assert.equal(daysLeft(on("2026-09-18"), NOW), 0, "today is zero days out");
assert.equal(daysLeft(on("2026-09-09"), NOW), -9, "past dates are negative");
assert.equal(statusOf(on("2026-09-17"), NOW), "expired", "yesterday is expired");
assert.equal(statusOf(on("2026-10-18"), NOW), "expiring", "30 days out still counts as expiring");
assert.equal(statusOf(on("2026-10-19"), NOW), "active", "31 days out is active");

// A certificate is judged on its own tighter window, never on the billing one.
assert.ok(CERT_ALARM_DAYS < 30, "certificate alarm is tighter than the billing window");

// Monthly and yearly lines are only comparable once annualised.
const monthly = { cycle: "MONTHLY" as BillingCycle, chargeAmount: 3500 };
const yearly = { cycle: "YEARLY" as BillingCycle, chargeAmount: 3500 };
assert.equal(annualised(monthly), 42000, "monthly charge is twelve times a year");
assert.equal(annualised(yearly), 3500, "yearly charge is itself");

// Money is rupees, whole, Indian grouping.
assert.equal(inr(1500000), "₹15,00,000", "lakh grouping");
assert.equal(inr(null), "—", "missing cost reads as a dash, not zero");

const base = {
  id: "s1",
  client: { id: "c1", name: "Nandini Textiles", email: "accounts@nandinitextiles.in" },
  kind: "DOMAIN" as SubscriptionKind,
  provider: "GoDaddy",
  cycle: "YEARLY" as BillingCycle,
  chargeAmount: 2500,
  renewalLink: "https://pay.indefine.in/r/x",
};

// Overdue and upcoming reminders say different things, and both carry the amount and link.
const overdue = draftReminder({ ...base, expiresOn: on("2026-09-09") } as Parameters<typeof draftReminder>[0], NOW);
assert.match(overdue.subject, /^Overdue:/, "a lapsed service leads with Overdue");
assert.match(overdue.body, /expired on 09 Sept 2026/, "overdue body names the date it lapsed");

const upcoming = draftReminder({ ...base, expiresOn: on("2026-10-02") } as Parameters<typeof draftReminder>[0], NOW);
assert.match(upcoming.subject, /due in 14 days/, "upcoming subject counts the days");
assert.match(upcoming.body, /₹2,500 \(yearly\)/, "body states what the client owes");
assert.match(upcoming.body, /pay\.indefine\.in/, "body carries the renewal link");
assert.ok(!/password|api key/i.test(upcoming.body), "reminders never mention credentials");

console.log("verify-client-ops: all checks passed");
