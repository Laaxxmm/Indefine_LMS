// Tab inside a modal dialog (the Help panel): pure, so the rule is unit-tested without a browser.

/**
 * Which control Tab should move to, or null to let the browser move focus as usual.
 * `at`: the index of the focused control among the dialog's `count` controls, or -1 when focus sits
 * on the dialog itself (after a click on its text). Tab past the last goes to the first, Shift+Tab
 * before the first goes to the last, so focus never leaves the dialog.
 */
export function trapTab(at: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (at < 0) return shift ? count - 1 : 0;
  if (shift && at === 0) return count - 1;
  if (!shift && at === count - 1) return 0;
  return null;
}
