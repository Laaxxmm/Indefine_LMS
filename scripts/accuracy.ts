// Accuracy harness CLI (Phase 4 task 6). Runs every agent that has fixtures (or --agent=<key>)
// over fixtures/accuracy/<agent>/ with mocked I/O, prints the markdown scoreboard and exits
// non-zero when any agent is below the thresholds in ACCURACY_THRESHOLDS.
//
//   npx tsx scripts/accuracy.ts [--agent=echo] [--fixtures=fixtures/accuracy] [--runs=3]
//                               [--write-progress --out=<file>] [--provider=<id>]
//
// --write-progress --out=<file> puts the block into <file>: it replaces a previous scoreboard
// block or the body of a "## Accuracy scoreboard" section and leaves the rest of the file alone.
// --provider is reserved for Phase 2b (live local / Claude runs); today only the recorded
// fixtures are used and any other value exits 2.
// Exit codes: 0 all pass · 1 below threshold · 2 usage error / blocked.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { failureDetails, scoreboardMarkdown, upsertScoreboard, type AgentScore } from "@/lib/agents/core/accuracy";
import { DEFAULT_FIXTURES_ROOT, agentsWithFixtures, runAgentAccuracy } from "@/lib/agents/core/accuracy-run";
import { AGENTS, getAgent } from "@/lib/agents/registry";

type Args = { agent?: string; fixtures: string; runs?: number; writeProgress: boolean; out?: string; provider?: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { fixtures: DEFAULT_FIXTURES_ROOT, writeProgress: false };
  for (const arg of argv) {
    const [k, v] = arg.replace(/^--/, "").split("=", 2);
    if (k === "agent") a.agent = v;
    else if (k === "fixtures") a.fixtures = v;
    else if (k === "runs") a.runs = Number(v);
    else if (k === "write-progress") a.writeProgress = true;
    else if (k === "out") a.out = v;
    else if (k === "provider") a.provider = v;
    else throw new Error(`unknown argument ${arg}`);
  }
  return a;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`accuracy: ${(e as Error).message}`);
    return 2;
  }
  if (args.provider && args.provider !== "recorded") {
    console.error(`accuracy: --provider=${args.provider} is reserved for Phase 2b (live provider runs); only recorded fixtures run today.`);
    return 2;
  }
  if (args.writeProgress && !args.out) {
    console.error("accuracy: --write-progress needs --out=<file>");
    return 2;
  }
  if (args.runs !== undefined && (!Number.isInteger(args.runs) || args.runs < 1)) {
    console.error("accuracy: --runs must be a positive integer");
    return 2;
  }

  const keys = args.agent ? [args.agent] : agentsWithFixtures(args.fixtures);
  if (!keys.length) {
    console.error(`accuracy: no fixtures under ${args.fixtures}`);
    return 2;
  }
  const scores: AgentScore[] = [];
  for (const key of keys) {
    const def = getAgent(key, AGENTS);
    if (!def) {
      console.error(`accuracy: unknown agent "${key}" (known: ${Object.keys(AGENTS).join(", ")})`);
      return 2;
    }
    scores.push(await runAgentAccuracy(def, { root: args.fixtures, runs: args.runs }));
  }

  const block = scoreboardMarkdown(scores, new Date());
  console.log(block);
  for (const s of scores.filter((x) => !x.pass)) {
    console.log(`\n${s.agent} (${s.fixtureSet}) is below threshold:`);
    for (const line of failureDetails(s)) console.log(line);
  }
  if (args.writeProgress && args.out) {
    const existing = existsSync(args.out) ? readFileSync(args.out, "utf8") : null;
    writeFileSync(args.out, upsertScoreboard(existing, block));
    console.log(`\naccuracy: scoreboard written to ${args.out}`);
  }
  return scores.every((s) => s.pass) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`accuracy: ${(e as Error).stack ?? String(e)}`);
    process.exit(2);
  },
);
