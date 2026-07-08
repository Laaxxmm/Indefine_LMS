"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function VideoPlayer({
  videoId,
  initialPosition,
  initialPercent,
  unlockAtPercent,
}: {
  videoId: string;
  initialPosition: number;
  initialPercent: number;
  unlockAtPercent: number;
}) {
  const router = useRouter();
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(initialPercent);
  const [speed, setSpeed] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSent = useRef(0);
  // Once we cross the quiz-unlock threshold we re-render the server page so the
  // quiz activates without a manual refresh. Guard so it only happens once.
  const unlockRefreshed = useRef(initialPercent >= unlockAtPercent);

  const SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/video/${videoId}/stream`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.url) setSrc(d.url);
        else setError(d.error ?? "Could not load video");
      })
      .catch(() => !cancelled && setError("Network error loading video"));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Resume to last position once metadata loads
  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const onLoaded = () => {
      if (initialPosition > 0 && initialPosition < (v.duration || Infinity) - 5) {
        v.currentTime = initialPosition;
      }
    };
    v.addEventListener("loadedmetadata", onLoaded);
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [src, initialPosition]);

  // Apply playback speed — and re-apply after a (re)load, since the browser
  // resets playbackRate to 1 whenever the media source changes.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = speed;
    const apply = () => {
      v.playbackRate = speed;
    };
    v.addEventListener("loadeddata", apply);
    return () => v.removeEventListener("loadeddata", apply);
  }, [speed, src]);

  // Heartbeat: every 10s of playback push progress to server.
  //
  // Deliberately a plain fetch, NOT navigator.sendBeacon. sendBeacon is
  // fire-and-forget with zero visibility into failures, and some corporate
  // proxies / endpoint-security / ad-blocking software silently drop beacon
  // requests (they use the same API real analytics trackers do). A normal
  // fetch is indistinguishable from any other request the office network
  // already allows, and failures are at least catchable/loggable.
  //
  // Important: fetch() only REJECTS on a network-level failure (DNS, CORS,
  // connection refused). An HTTP error response (401/404/500) resolves
  // normally with res.ok === false — so we must check that explicitly, or
  // a rejected/blocked request looks identical to a successful one.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    function sendProgress(payload: { lastPosition: number; percent: number; completed: boolean }) {
      fetch(`/api/video/${videoId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true, // best-effort delivery even if the tab is closing/navigating
      })
        .then(async (res) => {
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.warn(`Video progress save failed (HTTP ${res.status}): ${detail}`);
            setSaveError(`Progress isn't saving (server error ${res.status}). Tell your admin.`);
            return;
          }
          setSaveError(null);
        })
        .catch((e) => {
          console.warn("Video progress network error:", e);
          setSaveError("Progress isn't saving — request never reached the server. Try a different network.");
        });
    }

    const onTimeUpdate = () => {
      if (!v.duration) return;
      const pct = Math.min(100, (v.currentTime / v.duration) * 100);
      setPercent(pct); // smooth on-screen progress bar

      // Live quiz unlock: the instant we cross the threshold, persist it and
      // re-render the server page so the quiz activates — no manual refresh.
      // router.refresh() preserves client state, so the video keeps playing.
      if (!unlockRefreshed.current && pct >= unlockAtPercent) {
        unlockRefreshed.current = true;
        fetch(`/api/video/${videoId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lastPosition: Math.floor(v.currentTime),
            percent: pct,
            completed: pct >= 95,
          }),
          keepalive: true,
        }).finally(() => router.refresh());
      }

      // Throttled network heartbeat (every 10s).
      const now = Date.now();
      if (now - lastSent.current < 10_000) return;
      lastSent.current = now;
      sendProgress({
        lastPosition: Math.floor(v.currentTime),
        percent: pct,
        completed: pct >= 95,
      });
    };
    const onEnded = () => {
      sendProgress({ lastPosition: Math.floor(v.currentTime), percent: 100, completed: true });
      setPercent(100);
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("ended", onEnded);
    };
    // `src` is required here: on the first render `src` is still null, so no
    // <video> element exists yet and `ref.current` is null — this effect
    // bailed out via the `if (!v) return` above and never attached anything.
    // Without `src` in the deps, it never re-ran once the element mounted,
    // so the listeners were silently never attached, for every video, ever.
  }, [videoId, src, unlockAtPercent, router]);

  if (error) {
    return (
      <div className="aspect-video rounded-xl bg-muted border border-border flex items-center justify-center text-ink-mute">
        {error}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="aspect-video rounded-xl bg-muted border border-border animate-pulse" />
    );
  }

  return (
    <div>
      <video
        ref={ref}
        src={src}
        controls
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        onContextMenu={(e) => e.preventDefault()}
        className="w-full rounded-xl bg-black"
      />
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink-mute mr-1">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`text-xs px-2.5 py-1 rounded-md border transition tabular-nums ${
              speed === s
                ? "bg-brand-500 border-brand-500 text-white"
                : "bg-muted border-border text-ink-soft hover:bg-border"
            }`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="mt-3 h-1.5 bg-muted rounded">
        <div
          className="h-1.5 bg-brand-500 rounded transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-ink-mute mt-1">{Math.round(percent)}% watched</p>
      {saveError && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">
          ⚠ {saveError}
        </p>
      )}
    </div>
  );
}
