import type { SopContent, SopScreen } from "./types";

// Screenshots under SOP steps. Pure: shared by the editor (browser) and the routes.

export const SCREEN_MAX_BYTES = 3 * 1024 * 1024;
export const SCREEN_MAX_WIDTH = 1600; // the editor shrinks a wider screenshot to this
export const SCREEN_MAX_HEIGHT = 2400;
export const SCREENS_PER_STEP = 10;
export const SCREENS_PER_SOP = 300;
export const CAPTION_MAX = 300;

type ImageInfo = { mime: "image/png" | "image/jpeg"; width: number; height: number };
const sized = (mime: ImageInfo["mime"], width: number, height: number): ImageInfo | null => (width > 0 && height > 0 ? { mime, width, height } : null);

// Type and pixel size read from the file's own header; null when it is not a PNG or JPEG.
export function imageSize(b: Uint8Array): ImageInfo | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => (b[i] * 2 ** 24) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 24 && png.every((v, i) => b[i] === v) && String.fromCharCode(...b.subarray(12, 16)) === "IHDR") return sized("image/png", u32(16), u32(20));
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) i += 1; // fill byte
    // SOF0–SOF15 hold the frame size (C4 DHT, C8 JPG and CC DAC share the range but are not frames)
    else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return sized("image/jpeg", u16(i + 7), u16(i + 5));
    else if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) i += 2; // markers with no length
    else i += 2 + u16(i + 2);
  }
  return null;
}

// Printed size in the Word file: fits a landscape page with its caption, never enlarged.
export function fitBox(width: number, height: number, maxW = 860, maxH = 470): { width: number; height: number } {
  const k = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const steps = (c: SopContent | undefined) => (c?.subProcesses ?? []).flatMap((p) => p.steps);

export function screenIds(c: SopContent): string[] {
  return [...new Set(steps(c).flatMap((s) => (s.screens ?? []).map((x) => x.imageId)))];
}

// The content with each step's screens replaced by `byStep` (a step left out has none).
export function applyScreens(c: SopContent, byStep: Record<string, SopScreen[]>): { content: SopContent } | { error: string } {
  const known = new Set(steps(c).map((s) => s.no));
  const unknown = Object.keys(byStep).filter((no) => !known.has(no));
  if (unknown.length) return { error: `Step ${unknown.join(", ")} is not in this SOP any more. Reload the page and add the screens again.` };
  const subProcesses = c.subProcesses?.map((p) => ({
    ...p,
    steps: p.steps.map((s) => ({ ...s, screens: byStep[s.no]?.length ? byStep[s.no] : undefined })),
  }));
  return { content: { ...c, subProcesses } };
}

// A new AI version keeps the last version's screens on steps with the same number. A step whose
// words changed, and a screen whose step is gone, become Points to Confirm.
export function carryScreens(prev: SopContent | undefined, next: SopContent): SopContent {
  const old = new Map(steps(prev).filter((s) => s.screens?.length).map((s) => [s.no, s]));
  if (!old.size || !next.subProcesses) return next;
  const check: string[] = [];
  const subProcesses = next.subProcesses.map((p) => ({
    ...p,
    steps: p.steps.map((s) => {
      const o = old.get(s.no);
      if (!o) return s;
      old.delete(s.no);
      if (o.action.trim() !== s.action.trim()) check.push(`${s.no}: this step was rewritten in this version. Check that its screen still matches it.`);
      return { ...s, screens: o.screens };
    }),
  }));
  if (old.size) check.push(`Screens for ${[...old.keys()].join(", ")} were left out because those steps are gone. Add them again under the right steps.`);
  return { ...next, subProcesses, openPoints: [...(next.openPoints ?? []), ...check] };
}
