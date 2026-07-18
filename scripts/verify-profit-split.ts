// Run: npx tsx scripts/verify-profit-split.ts
import assert from "node:assert";
import { profitPercents } from "../src/lib/neo-centra/split";

// No assigned partners → no shares.
assert.deepEqual(profitPercents([], null), {});
assert.deepEqual(profitPercents([], { a: 100 }), {});

// One partner → 100%.
assert.deepEqual(profitPercents(["a"], null), { a: 100 });

// Two partners, no saved split → equal.
assert.deepEqual(profitPercents(["a", "b"], null), { a: 50, b: 50 });

// Saved split that covers everyone → used verbatim.
assert.deepEqual(profitPercents(["a", "b"], { a: 40, b: 60 }), { a: 40, b: 60 });

// Saved split missing a currently-assigned partner → stale, falls back to equal.
assert.deepEqual(profitPercents(["a", "b", "c"], { a: 40, b: 60 }), { a: 100 / 3, b: 100 / 3, c: 100 / 3 });

// Saved covers all assigned even if it carries an extra (removed) partner → used.
assert.deepEqual(profitPercents(["a", "b"], { a: 30, b: 70, c: 0 }), { a: 30, b: 70 });

console.log("profit-split ok");
