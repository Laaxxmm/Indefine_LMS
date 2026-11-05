// Shared bits for client panels: a fetch wrapper that returns { ok, error, data }, and the
// Tailwind class strings every module's buttons, cards, fields, type and layout use. Plain module,
// no "use client" needed. Import from "@/components/ui" instead of restyling per module.
// The scales and the reasons behind each value: docs/design/firm-os-ui.md. The React pieces built
// on these strings (PageHeader, Card, Alert, DataTable, Button, …) are in src/components/firm-os.
export type CallResult = { ok: boolean; error: string | null; data: Record<string, unknown> };

export async function call(url: string, body?: unknown, method = "POST"): Promise<CallResult> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, error: res.ok ? null : String(data.error ?? "Something went wrong"), data };
}

/** Joins class names, skipping empty ones (no stray spaces in the rendered class attribute). */
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

// ------------------------------------------------------------------ focus

/** Visible keyboard focus for every interactive element (links, buttons, fields, summaries). */
export const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

// ------------------------------------------------------------------ layout (8pt grid)
// Tailwind steps are 4 px: 2 = 8, 4 = 16, 6 = 24, 8 = 32. Between regions only multiples of 8;
// inside a dense control (a chip, a button, a table cell) 4 px steps are allowed.

/** Content max width (1280); forms 640. */
export const contentWidth = "max-w-[1280px]";
export const formWidth = "max-w-[640px]";
/** Side gutter of every page and header: 16 on a phone, 32 from 640 px up. */
export const pageGutter = "px-4 sm:px-8";
/** The bleed that undoes pageGutter, for a bar that spans the content edge to edge. */
export const pageBleed = "-mx-4 sm:-mx-8";
/** The <main> of a Firm OS page: centred, gutters, 32 above and below. */
export const pageMain = `${contentWidth} mx-auto ${pageGutter} py-8`;
/** Page header block → content (24); section → section (32); card → card in a column (24). */
export const headerGap = "mb-6";
export const sectionGap = "mb-8";
export const stack = "space-y-6";

// ------------------------------------------------------------------ type
// One scale: 11 (eyebrow, section title, chip, table head) · 12 (label, hint, caption) ·
// 13 (body, buttons) · 15 (lead) · 20 (card title) · 28/32 (page title) · 28 (figure). Numbers in tables, figures,
// dates and durations use tabular numerals.

export const eyebrow = "text-[11px] leading-4 font-extrabold tracking-[0.14em] uppercase text-ink-mute";
export const pageTitle = "font-display font-extrabold text-[28px] leading-8 sm:text-[32px] sm:leading-10 tracking-[-0.02em] text-ink";
export const lead = "text-[15px] leading-6 text-ink-mute max-w-2xl";
/** A heading inside a card that names its subject (the client in the onboarding plan). */
export const cardTitle = "font-display font-bold text-xl leading-7";
/** Section title (the shared h2). ink-mute: ink-faint's old #b7b5c6 was 2:1 on white, below AA. */
export const h2 = "text-[11px] leading-4 font-extrabold tracking-[0.12em] text-ink-mute uppercase mb-4";
export const sectionTitle = h2;
export const body = "text-[13px] leading-5";
export const labelText = "text-[12px] leading-4 font-bold text-ink-soft";
export const hintText = "text-[12px] leading-4 text-ink-mute";
export const caption = "text-[12px] leading-4 text-ink-mute";
export const numeric = "tabular-nums";
/** A key figure (totals, counts, durations) in a tile. */
export const figure = "font-display text-[28px] leading-8 font-extrabold tabular-nums";
/** Inline text link. */
export const linkText = `font-semibold text-brand-600 hover:text-brand-700 hover:underline rounded ${focusRing}`;

// ------------------------------------------------------------------ buttons
// One shape: rounded-lg, 13 px bold, 32 px tall (20 line + 2 × 5 padding + 2 × 1 border; every variant has a
// border so a ghost button and the primary beside it are the same height); btnSm makes it 24 px for rows and
// cards. One primary (filled) button per screen; the rest are ghost or a tone. Focus ring built in.

export const btn = `inline-flex items-center justify-center gap-2 px-3 py-[5px] rounded-lg text-[13px] leading-5 font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`;
export const btnPrimary = `${btn} border border-brand-500 bg-brand-500 hover:border-brand-600 hover:bg-brand-600 text-white`;
export const btnGhost = `${btn} border border-border bg-card text-ink-soft hover:bg-muted hover:text-ink`;
export const btnSuccess = `${btn} border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`;
export const btnWarn = `${btn} border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`;
export const btnDanger = `${btn} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`;
/** Compact variant for buttons that sit inside a card or a table row. Prefix with the colour class. */
export const btnSm = "!px-2.5 !py-px !text-[12px] !rounded-md";

/** One colour per verb, so Finish is green and Obsolete is red on every screen. */
export function workActionClass(action: "activate" | "pause" | "finish" | "obsolete" | "reopen" | "continue"): string {
  switch (action) {
    case "activate":
    case "continue":
      return btnPrimary;
    case "finish":
      return btnSuccess;
    case "pause":
      return btnWarn;
    case "obsolete":
      return btnDanger;
    default:
      return btnGhost;
  }
}

/** "Lakshmanan Annamalai" → "Lakshmanan". Cards and chips have no room for a full name. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "—";
}

// ------------------------------------------------------------------ surfaces, fields, messages

/** Card: padding 24. */
export const card = "rounded-2xl bg-card border border-border shadow-lift p-6";
/** Text field / select / textarea, the shared focus ring. Inputs and selects are 40 px tall (h-10: native date and
 *  select boxes ignore line height); a textarea keeps its rows. */
export const field = `rounded-lg border border-border bg-page/60 px-3 py-[9px] [&:not(textarea)]:h-10 text-[13px] leading-5 w-full ${focusRing}`;
/** Field-level or action-level error text. rose-700 is 6.3:1 on white (red-600 was 4.4:1 on the page tint). */
export const errorText = "text-[13px] leading-5 text-rose-700";

/** Chip: 24 px tall (16 line + 2 × 4), uppercase 11 px. Pair with a tone from chipTone. */
export const chip = "inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] leading-4 font-bold uppercase tracking-wide whitespace-nowrap";
/** -50 fill, -200 border, -800 text: every pair is at least 4.5:1 (docs/design/firm-os-ui.md). */
export const chipTone = {
  neutral: "border-border bg-muted text-ink-soft",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  brand: "border-brand-200 bg-brand-50 text-brand-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  /** Muted gold, used sparingly (DESIGN: "needs partner"). */
  partner: "border-amber-300 bg-amber-100 text-amber-900",
  done: "border-ink-soft bg-ink text-white",
} as const;
export type ChipTone = keyof typeof chipTone;

// ------------------------------------------------------------------ tables (rows 44 px)

/** `relative` keeps sr-only cells inside the scroll box (otherwise they widen the page on a phone). */
export const tableWrap = "relative overflow-x-auto rounded-2xl bg-card border border-border shadow-lift";
export const table = "w-full text-[13px] leading-5";
export const thead = "text-[11px] leading-4 uppercase tracking-wide text-ink-mute text-left";
/** Header and body cells: 16 side padding, 6 vertical, so a row with a 32 px button or a chip is 44. */
export const th = "px-4 py-1.5 h-11 font-bold";
export const td = "px-4 py-1.5";
export const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;
export const tr = "border-t border-border hover:bg-muted/40 h-11";
