"use client";

import { useEffect, useRef, useState } from "react";

export default function VideoPlayer({
  videoId,
  initialPosition,
  initialPercent,
}: {
  videoId: string;
  initialPosition: number;
  initialPercent: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(initialPercent);
  const [speed, setSpeed] = useState(1);
  const lastSent = useRef(0);

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

  // Heartbeat: every 10s of playback push progress to server
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTimeUpdate = () => {
      if (!v.duration) return;
      const now = Date.now();
      if (now - lastSent.current < 10_000) return;
      lastSent.current = now;
      const pct = Math.min(100, (v.currentTime / v.duration) * 100);
      setPercent(pct);
      navigator.sendBeacon?.(
        `/api/video/${videoId}/progress`,
        new Blob(
          [
            JSON.stringify({
              lastPosition: Math.floor(v.currentTime),
              percent: pct,
              completed: pct >= 95,
            }),
          ],
          { type: "application/json" }
        )
      ) ||
        fetch(`/api/video/${videoId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lastPosition: Math.floor(v.currentTime),
            percent: pct,
            completed: pct >= 95,
          }),
        });
    };
    const onEnded = () => {
      fetch(`/api/video/${videoId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastPosition: Math.floor(v.currentTime),
          percent: 100,
          completed: true,
        }),
      });
      setPercent(100);
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("ended", onEnded);
    };
  }, [videoId]);

  if (error) {
    return (
      <div className="aspect-video rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/70">
        {error}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="aspect-video rounded-xl bg-white/5 border border-white/10 animate-pulse" />
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
        <span className="text-xs text-white/50 mr-1">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`text-xs px-2.5 py-1 rounded-md border transition tabular-nums ${
              speed === s
                ? "bg-brand-500 border-brand-500 text-white"
                : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
            }`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="mt-3 h-1.5 bg-white/10 rounded">
        <div
          className="h-1.5 bg-brand-500 rounded transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-white/50 mt-1">{Math.round(percent)}% watched</p>
    </div>
  );
}
