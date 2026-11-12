"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, EyeOff, ImagePlus, Loader2, Square, Undo2, X } from "lucide-react";
import type { SopScreen } from "@/lib/sop/types";
import { userMessage } from "@/lib/errors";
import { CAPTION_MAX, SCREEN_MAX_HEIGHT, SCREEN_MAX_WIDTH } from "@/lib/sop/screens";

type Mark = { kind: "hide" | "highlight"; x: number; y: number; w: number; h: number }; // canvas pixels
type Point = { x: number; y: number };

const input = "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition";
const PNG_LIMIT = 1.5 * 1024 * 1024; // a busier screen goes up as JPEG instead

const box = (a: Point, b: Point, kind: Mark["kind"]): Mark => ({ kind, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
function paint(ctx: CanvasRenderingContext2D, m: Mark, width: number) {
  if (m.kind === "hide") {
    ctx.fillStyle = "#000";
    ctx.fillRect(m.x, m.y, m.w, m.h);
  } else {
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = Math.max(3, Math.round(width / 400));
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  }
}
const toBlob = (cv: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error("The picture could not be saved. Try again."))), type, quality));

// Paste or pick a screenshot, mark it up, upload it. Marks are drawn into the pixels before
// upload, so a hidden area is black in the stored picture and the original never leaves the browser.
export function MarkupDialog({ sopId, stepNo, onAdded, onClose }: { sopId: string; stepNo: string; onAdded: (s: SopScreen) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<Point | null>(null);
  const [picture, setPicture] = useState<{ bitmap: ImageBitmap; w: number; h: number } | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [tool, setTool] = useState<Mark["kind"]>("hide");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (file: Blob | null) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("That is not a picture. Copy a screenshot, then press Ctrl+V here.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const k = Math.min(1, SCREEN_MAX_WIDTH / bitmap.width, SCREEN_MAX_HEIGHT / bitmap.height);
      setPicture({ bitmap, w: Math.round(bitmap.width * k), h: Math.round(bitmap.height * k) });
      setMarks([]);
      setError(null);
    } catch {
      setError("That picture could not be opened. Take the screenshot again.");
    }
  }, []);

  // Ctrl+V anywhere in the dialog; Escape closes it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (!item) return; // text pasted into the caption stays text
      e.preventDefault();
      void load(item.getAsFile());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [load, onClose, busy]);

  // A decoded picture holds up to ~15 MB; free it when it is replaced or the dialog closes.
  useEffect(() => () => picture?.bitmap.close(), [picture]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !picture) return;
    ctx.drawImage(picture.bitmap, 0, 0, picture.w, picture.h);
    for (const m of draft ? [...marks, draft] : marks) paint(ctx, m, picture.w);
  }, [picture, marks, draft]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (picture?.w ?? 0)) / r.width, y: ((e.clientY - r.top) * (picture?.h ?? 0)) / r.height };
  };

  async function add() {
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy(true);
    setError(null);
    try {
      let blob = await toBlob(cv, "image/png");
      let name = "screen.png";
      if (blob.size > PNG_LIMIT) {
        blob = await toBlob(cv, "image/jpeg", 0.9);
        name = "screen.jpg";
      }
      const form = new FormData();
      form.append("file", new File([blob], name, { type: blob.type }));
      const res = await fetch(`/api/tools/sop-builder/sops/${sopId}/images`, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error || "The screen could not be uploaded. Try again.");
        setBusy(false);
        return;
      }
      onAdded({ imageId: data.id, caption: caption.trim() });
    } catch (e) {
      setError(userMessage(e));
      setBusy(false);
    }
  }

  const toolClass = (on: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold transition ${on ? "border-brand-400 bg-brand-50 text-brand-700" : "border-border bg-card text-ink-soft hover:bg-muted"}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="markup-title">
      <div className="w-full max-w-5xl rounded-2xl bg-card border border-border shadow-pop p-5 my-6">
        <div className="flex items-center justify-between mb-3">
          <h2 id="markup-title" className="text-[16px] font-bold text-ink">Add a screen to step {stepNo}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded-lg hover:bg-muted text-ink-mute">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!picture ? (
          <div
            className="rounded-xl border-2 border-dashed border-border p-10 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void load(e.dataTransfer.files[0] ?? null);
            }}
          >
            <ImagePlus className="w-8 h-8 mx-auto text-ink-faint mb-2" />
            <p className="text-[15px] font-bold text-ink">Press Ctrl+V to paste the screenshot</p>
            <p className="text-[13px] text-ink-mute mt-1">
              Or drop a picture here, or{" "}
              <label className="font-bold text-brand-700 hover:underline cursor-pointer">
                choose a file
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => void load(e.target.files?.[0] ?? null)} />
              </label>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2" role="toolbar" aria-label="Mark-up tools">
              <button onClick={() => setTool("hide")} aria-pressed={tool === "hide"} className={toolClass(tool === "hide")}>
                <EyeOff className="w-4 h-4" /> Hide
              </button>
              <button onClick={() => setTool("highlight")} aria-pressed={tool === "highlight"} className={toolClass(tool === "highlight")}>
                <Square className="w-4 h-4" /> Highlight
              </button>
              <button onClick={() => setMarks((m) => m.slice(0, -1))} disabled={!marks.length || busy} className={toolClass(false)}>
                <Undo2 className="w-4 h-4" /> Undo
              </button>
              <button onClick={() => setPicture(null)} disabled={busy} className={toolClass(false)}>
                Use another picture
              </button>
            </div>
            <p className="text-[12px] text-ink-mute mb-2">
              Drag on the picture. <strong>Hide</strong> covers the area in solid black, and the black is part of the saved picture. <strong>Highlight</strong> draws a red box around what to click.
            </p>
            <canvas
              ref={canvasRef}
              width={picture.w}
              height={picture.h}
              aria-label="The screenshot. Drag to hide or highlight an area."
              className="w-full h-auto rounded-lg border border-border cursor-crosshair touch-none"
              onPointerDown={(e) => {
                if (busy) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = at(e);
              }}
              onPointerMove={(e) => {
                if (start.current) setDraft(box(start.current, at(e), tool));
              }}
              onPointerUp={() => {
                if (draft && draft.w > 4 && draft.h > 4) setMarks((m) => [...m, draft]);
                start.current = null;
                setDraft(null);
              }}
              onPointerCancel={() => {
                start.current = null;
                setDraft(null);
              }}
            />
            <label htmlFor="screen-caption" className="block text-[13px] font-bold text-ink mt-3 mb-1">
              Caption <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input id="screen-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={CAPTION_MAX} placeholder="What this screen shows, e.g. Bank Reconciliation screen" className={input} />
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-rose-600 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold text-ink-soft hover:bg-muted transition">
            Cancel
          </button>
          <button onClick={add} disabled={!picture || busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Add screen
          </button>
        </div>
      </div>
    </div>
  );
}
