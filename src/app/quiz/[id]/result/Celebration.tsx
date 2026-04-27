"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

export default function Celebration({ passed }: { passed: boolean }) {
  useEffect(() => {
    if (!passed) return;
    // Two-burst confetti from the corners.
    const fire = (originX: number) => {
      confetti({
        particleCount: 80,
        angle: originX < 0.5 ? 60 : 120,
        spread: 60,
        origin: { x: originX, y: 0.6 },
        colors: ["#3b62f6", "#8b5cf6", "#fbbf24", "#10b981", "#f43f5e"],
        scalar: 1.1,
        ticks: 200,
      });
    };
    fire(0.15);
    fire(0.85);
    const t = setTimeout(() => {
      fire(0.5);
    }, 300);
    return () => clearTimeout(t);
  }, [passed]);

  return null;
}
