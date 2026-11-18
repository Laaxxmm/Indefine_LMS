// Shared plumbing for the Firm OS guard CLIs (scripts/verify-*.ts): list the repo's files the
// way git sees them (tracked + untracked-but-not-ignored), read them, print violations, exit.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatViolation, type SourceFile, type Violation } from "./guards";

const ROOT = join(__dirname, "..", "..");

function git(args: string[]): string[] {
  const out = execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

/** Repo-relative paths (forward slashes) of tracked files plus untracked files git does not ignore. */
export function listRepoFiles(): string[] {
  const all = new Set([...git(["ls-files", "-z"]), ...git(["ls-files", "-z", "--others", "--exclude-standard"])]);
  return [...all].filter((p) => {
    const abs = join(ROOT, p);
    return existsSync(abs) && statSync(abs).isFile(); // tracked-but-deleted files drop out
  });
}

/** Reads the files that pass `filter`; binary content (a NUL byte) is skipped. */
export function loadFiles(filter: (path: string) => boolean): SourceFile[] {
  const files: SourceFile[] = [];
  for (const path of listRepoFiles().filter(filter)) {
    const content = readFileSync(join(ROOT, path), "utf8");
    if (content.includes("\0")) continue;
    files.push({ path, content });
  }
  return files;
}

/** Prints each violation as `path:line  rule  snippet` and exits 1, or prints `ok` and exits 0. */
export function report(name: string, violations: Violation[], ok: string, notes: string[] = []): never {
  for (const n of notes) console.log(`${name}: note: ${n}`);
  if (violations.length) {
    for (const v of violations) console.log(formatViolation(v));
    console.error(`${name}: FAILED — ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`${name}: OK — ${ok}`);
  process.exit(0);
}
