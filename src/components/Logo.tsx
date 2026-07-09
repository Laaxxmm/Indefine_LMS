"use client";

import { useId } from "react";

export type LogoVariant = "primary" | "on-dark" | "mono" | "app-icon";

// The Indefine mark: a rounded tile with a rising-trajectory polyline ending in
// a red spark. Matches assets/logo-*.svg from the brand kit exactly.
export function LogoMark({
  variant = "primary",
  size = 40,
}: {
  variant?: LogoVariant;
  size?: number;
}) {
  const rawId = useId();
  const gid = `lg-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const gradient = variant === "primary" || variant === "app-icon";
  const rx = variant === "app-icon" ? 20 : 12;
  const tile = gradient
    ? `url(#${gid})`
    : variant === "on-dark"
      ? "rgba(255,255,255,0.16)"
      : "#15132B";
  const dot = variant === "mono" ? "#FFFFFF" : "#FF3B30";
  const sw = variant === "app-icon" ? 3.2 : 3;
  const dr = variant === "app-icon" ? 3.4 : 3.2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {gradient && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6D5BF0" />
            <stop offset="1" stopColor="#4B37D8" />
          </linearGradient>
        </defs>
      )}
      <rect width="40" height="40" rx={rx} fill={tile} />
      <path
        d="M10 27 L17.5 18.5 L23 23 L30 12"
        stroke="#ffffff"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="30" cy="12" r={dr} fill={dot} />
    </svg>
  );
}

// Full lockup: mark + "indefine" wordmark (+ optional tagline).
export function Logo({
  variant = "primary",
  size = 40,
  tagline,
  className = "",
}: {
  variant?: LogoVariant;
  size?: number;
  tagline?: string;
  className?: string;
}) {
  const onDark = variant === "on-dark";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark variant={variant} size={size} />
      <span className="flex flex-col leading-none">
        <span
          className={`font-display font-extrabold tracking-[-0.02em] ${onDark ? "text-white" : "text-ink"}`}
          style={{ fontSize: Math.round(size * 0.46) }}
        >
          indefine
        </span>
        {tagline && (
          <span
            className={`font-bold tracking-[0.16em] mt-1 ${onDark ? "text-white/60" : "text-ink-faint"}`}
            style={{ fontSize: Math.max(9, Math.round(size * 0.26)) }}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}
