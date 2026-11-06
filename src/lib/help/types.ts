// The shape of one page's help (src/lib/help/pages.ts is the registry; the Help panel in the
// headers shows the entry for the page you are on). Every string here is read by people in the
// firm, so it follows the plain-language rules (src/lib/errors/rules.ts), checked by
// tests/unit/help-registry.test.ts.
import type { JobTaskState } from "@prisma/client";

/** A word, label or status on the page, and what it means. */
export type HelpTerm =
  /** A word or label written the way the page writes it ("Mark filed", "Open question"). */
  | { term: string; meaning: string }
  /** A job state: the panel shows the same chip the page shows (IN_REVIEW …), then the meaning. */
  | { state: JobTaskState; meaning: string };

/** A common problem and the plain fix for it. */
export type HelpFix = { problem: string; fix: string };

export type HelpEntry = {
  /** The app route pattern, as the folder under src/app names it: "/agents/[agent]/runs/[id]". */
  route: string;
  /** Also covers every page under `route` that has no entry of its own (an LMS area). */
  section?: true;
  /** The page's name, as its header or title shows it. */
  title: string;
  /** What this page is for: one or two sentences. */
  purpose: string;
  /** How to use it: numbered steps. */
  steps: string[];
  /** What the words and statuses mean. */
  terms: HelpTerm[];
  /** If you're stuck: common problems with exact plain fixes. */
  stuck: HelpFix[];
  /** Who to ask. */
  ask: string;
};
