// Prompt lock check (ADR-008 §8). Every model task declared in an agent's AgentScope must be in
// prompts.lock.json as <agent>.<task>@<version> with the hash of its current prompt, schema and
// tier hint. Editing a prompt / schema / tier hint without bumping the version fails; a bumped
// version fails until --update adds it.
//
//   npx tsx scripts/verify-prompts.ts            check (CI)
//   npx tsx scripts/verify-prompts.ts --update   add new <task>@<version> entries — run it together
//                                                with that agent's accuracy gate (npm run accuracy)
//   [--lock=<path>]                              another lock file (tests)
//
// --update never changes an existing entry and never removes one (old versions stay as history).
// Exit codes: 0 ok · 1 lock out of date / refused · 2 usage error or unreadable lock.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  PROMPT_LOCK_FILE,
  currentPrompts,
  emptyPromptLock,
  parsePromptLock,
  serializePromptLock,
  updatePromptLock,
  verifyPromptLock,
  type PromptLock,
} from "@/lib/agents/core/guardrails/prompt-lock";
import { AGENTS } from "@/lib/agents/registry";

function main(argv: string[]): number {
  let update = false;
  let lockPath = PROMPT_LOCK_FILE;
  for (const arg of argv) {
    if (arg === "--update") update = true;
    else if (arg.startsWith("--lock=")) lockPath = arg.slice("--lock=".length);
    else {
      console.error(`verify-prompts: unknown argument ${arg}`);
      return 2;
    }
  }
  let lock: PromptLock;
  try {
    lock = existsSync(lockPath) ? parsePromptLock(readFileSync(lockPath, "utf8")) : emptyPromptLock();
  } catch (e) {
    console.error(`verify-prompts: ${(e as Error).message}`);
    return 2;
  }
  const current = currentPrompts(AGENTS);

  if (update) {
    const r = updatePromptLock(lock, current);
    if (r.refused.length) {
      console.error(`verify-prompts: refused — these entries changed without a version bump (bump the task version):\n${r.refused.map((l) => `- ${l}`).join("\n")}`);
      return 1;
    }
    writeFileSync(lockPath, serializePromptLock(r.lock));
    console.log(`verify-prompts: ${lockPath} updated (${r.added.length} added${r.added.length ? `: ${r.added.join(", ")}` : ""}; ${current.length} task(s) in code).`);
    return 0;
  }

  const check = verifyPromptLock(lock, current);
  if (!check.ok) {
    console.error(`verify-prompts: ${check.problems.length} problem(s) in ${lockPath}:\n${check.problems.map((p) => `- ${p}`).join("\n")}`);
    return 1;
  }
  console.log(`verify-prompts: ${current.length} model task(s) match ${lockPath}.`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
