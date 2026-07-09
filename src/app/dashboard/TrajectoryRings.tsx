"use client";

import { BookOpen, Dumbbell, Sprout } from "lucide-react";

interface RingProps {
  mastery: number;
  delivery: number;
  growth: number;
  size?: number;
}

// Three concentric rings — Apple Fitness style.
// Each ring stroke length is the track score 0-100.
export default function TrajectoryRings({
  mastery,
  delivery,
  growth,
  size = 160,
}: RingProps) {
  const center = size / 2;
  const stroke = size * 0.085;
  const gap = size * 0.025;

  // Outer ring — Mastery
  const r1 = center - stroke / 2 - 2;
  // Middle ring — Delivery
  const r2 = r1 - stroke - gap;
  // Inner ring — Growth
  const r3 = r2 - stroke - gap;

  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;
  const c3 = 2 * Math.PI * r3;

  const off = (pct: number, c: number) => c - (Math.min(100, Math.max(0, pct)) / 100) * c;

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="rg-mastery" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5B4BE6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="rg-delivery" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#17B978" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </linearGradient>
          <linearGradient id="rg-growth" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFB020" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>

        {/* Tracks */}
        <circle cx={center} cy={center} r={r1} fill="none" stroke="rgba(91,75,230,0.12)" strokeWidth={stroke} />
        <circle cx={center} cy={center} r={r2} fill="none" stroke="rgba(23,185,120,0.12)" strokeWidth={stroke} />
        <circle cx={center} cy={center} r={r3} fill="none" stroke="rgba(255,176,32,0.12)" strokeWidth={stroke} />

        {/* Filled */}
        <circle
          cx={center}
          cy={center}
          r={r1}
          fill="none"
          stroke="url(#rg-mastery)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c1}
          strokeDashoffset={off(mastery, c1)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <circle
          cx={center}
          cy={center}
          r={r2}
          fill="none"
          stroke="url(#rg-delivery)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c2}
          strokeDashoffset={off(delivery, c2)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <circle
          cx={center}
          cy={center}
          r={r3}
          fill="none"
          stroke="url(#rg-growth)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c3}
          strokeDashoffset={off(growth, c3)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
    </div>
  );
}

export function RingLegend({
  mastery,
  delivery,
  growth,
}: {
  mastery: number;
  delivery: number;
  growth: number;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <LegendRow icon={BookOpen} label="Mastery" pct={mastery} colorClass="text-brand-500" />
      <LegendRow icon={Dumbbell} label="Delivery" pct={delivery} colorClass="text-emerald-500" />
      <LegendRow icon={Sprout} label="Growth" pct={growth} colorClass="text-amber-500" />
    </div>
  );
}

function LegendRow({
  icon: Icon,
  label,
  pct,
  colorClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  pct: number;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${colorClass}`} />
      <span className="text-ink-soft font-medium">{label}</span>
      <span className="ml-auto tabular-nums font-semibold">{Math.round(pct)}%</span>
    </div>
  );
}
