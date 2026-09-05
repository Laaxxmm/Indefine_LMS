// Shared bits for client panels: a fetch wrapper that returns { ok, error, data }, and the
// Tailwind class strings every module's buttons, cards and fields use. Plain module, no
// "use client" needed. Import from "@/components/ui" instead of restyling per module.
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

export const btn = "px-3 py-1.5 rounded-lg text-[12.5px] font-bold transition disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-brand-500 hover:bg-brand-600 text-white`;
export const btnGhost = `${btn} border border-border text-ink-mute hover:bg-muted hover:text-ink`;
export const card = "rounded-2xl bg-card border border-border shadow-lift p-5";
export const h2 = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3";
export const field = "rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px] w-full";
export const errorText = "text-[12.5px] text-red-600";
